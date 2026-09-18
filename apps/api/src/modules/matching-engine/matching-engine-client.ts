import { randomUUID } from 'node:crypto';
import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';

import {
  matcherCommandSchema,
  matcherResponseSchema,
  type MatcherCommand,
  type MatcherResponse,
} from '@paper-terminal/contracts';

import { findWorkspaceRoot, resolveMatchingEngineExecutable } from './matching-engine-path.js';

export type MatchingEngineClientState = 'STOPPED' | 'STARTING' | 'READY' | 'UNAVAILABLE';

export type MatchingEngineLogEvent = {
  message: string;
  stream: 'stderr';
};

export type MatchingEngineClientOptions = {
  commandTimeoutMs?: number;
  executablePath?: string;
  logger?: (event: MatchingEngineLogEvent) => void;
  maximumResponseLineBytes?: number;
};

type PendingCommand = {
  command: MatcherCommand;
  reject: (error: Error) => void;
  resolve: (response: MatcherResponse) => void;
  timeout?: NodeJS.Timeout;
};

const recoveryAuthorization = Symbol('matching-engine-recovery');
const defaultMaximumResponseLineBytes = 4 * 1024 * 1024;

export class MatchingEngineTransportError extends Error {
  public constructor(
    public readonly code:
      | 'MATCHER_NOT_STARTED'
      | 'MATCHER_NOT_READY'
      | 'MATCHER_UNAVAILABLE'
      | 'MATCHER_TIMEOUT'
      | 'MATCHER_PROTOCOL_ERROR'
      | 'MATCHER_STOPPED',
    message: string,
  ) {
    super(message);
    this.name = 'MatchingEngineTransportError';
  }
}

export class MatchingEngineClient {
  private readonly commandTimeoutMs: number;
  private readonly executablePath: string;
  private readonly logger: (event: MatchingEngineLogEvent) => void;
  private readonly maximumResponseLineBytes: number;
  private child?: ChildProcessWithoutNullStreams;
  private hasStarted = false;
  private inFlight?: PendingCommand;
  private readonly queue: PendingCommand[] = [];
  private responseBuffer = '';
  private stateValue: MatchingEngineClientState = 'STOPPED';

  public constructor(options: MatchingEngineClientOptions = {}) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? 2_000;
    this.executablePath = resolveMatchingEngineExecutable(options.executablePath);
    this.logger = options.logger ?? (() => undefined);
    this.maximumResponseLineBytes =
      options.maximumResponseLineBytes ?? defaultMaximumResponseLineBytes;
  }

  public get state(): MatchingEngineClientState {
    return this.stateValue;
  }

  public get processId(): number | undefined {
    return this.child?.pid;
  }

  public async start(): Promise<void> {
    if (this.hasStarted) {
      throw new MatchingEngineTransportError(
        'MATCHER_NOT_STARTED',
        'A stopped or failed matcher can only restart through the recovery coordinator',
      );
    }
    this.hasStarted = true;
    await this.launch();
  }

  public async send(command: MatcherCommand): Promise<MatcherResponse> {
    const validatedCommand = matcherCommandSchema.parse(command);
    if (this.stateValue !== 'READY') {
      throw new MatchingEngineTransportError(
        this.stateValue === 'UNAVAILABLE' ? 'MATCHER_UNAVAILABLE' : 'MATCHER_NOT_READY',
        `Matching engine is ${this.stateValue.toLowerCase()}`,
      );
    }
    return this.enqueue(validatedCommand);
  }

  public async stop(): Promise<void> {
    await this.stopProcess(
      new MatchingEngineTransportError('MATCHER_STOPPED', 'Matching engine client stopped'),
    );
  }

  public async restartForRecovery(authorization: symbol): Promise<void> {
    if (authorization !== recoveryAuthorization) {
      throw new MatchingEngineTransportError(
        'MATCHER_NOT_STARTED',
        'Matching engine restart requires the recovery coordinator',
      );
    }
    await this.stopProcess(
      new MatchingEngineTransportError(
        'MATCHER_UNAVAILABLE',
        'Matching engine is restarting for recovery',
      ),
    );
    await this.launch();
  }

  private async launch(): Promise<void> {
    this.stateValue = 'STARTING';
    this.responseBuffer = '';
    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd: findWorkspaceRoot(),
      shell: false,
      windowsHide: true,
    };
    const child = spawn(this.executablePath, [], {
      ...spawnOptions,
      stdio: 'pipe',
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.receiveStdout(child, chunk));
    child.stderr.on('data', (chunk: string) => {
      for (const message of chunk.split(/\r?\n/).filter((line) => line.length > 0)) {
        this.logger({ stream: 'stderr', message });
      }
    });
    child.on('error', (error) => {
      if (this.child === child) {
        this.markUnavailable(
          new MatchingEngineTransportError(
            'MATCHER_UNAVAILABLE',
            `Matching engine process error: ${error.message}`,
          ),
        );
      }
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) {
        this.markUnavailable(
          new MatchingEngineTransportError(
            'MATCHER_UNAVAILABLE',
            `Matching engine exited unexpectedly (code=${String(code)}, signal=${String(signal)})`,
          ),
        );
      }
    });

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });

    const handshake = await this.enqueue({
      protocolVersion: 1,
      commandId: randomUUID(),
      type: 'PING',
      payload: {},
    });
    if (!handshake.accepted || handshake.type !== 'PING' || !handshake.result.ready) {
      const error = new MatchingEngineTransportError(
        'MATCHER_PROTOCOL_ERROR',
        'Matching engine failed its readiness handshake',
      );
      this.markUnavailable(error);
      throw error;
    }
    this.stateValue = 'READY';
  }

  private enqueue(command: MatcherCommand): Promise<MatcherResponse> {
    return new Promise<MatcherResponse>((resolve, reject) => {
      this.queue.push({ command, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.inFlight !== undefined || this.queue.length === 0) {
      return;
    }
    const child = this.child;
    if (child === undefined || !child.stdin.writable) {
      this.markUnavailable(
        new MatchingEngineTransportError(
          'MATCHER_UNAVAILABLE',
          'Matching engine stdin is not writable',
        ),
      );
      return;
    }

    const pending = this.queue.shift();
    if (pending === undefined) {
      return;
    }
    this.inFlight = pending;
    pending.timeout = setTimeout(() => {
      this.markUnavailable(
        new MatchingEngineTransportError(
          'MATCHER_TIMEOUT',
          `Matching engine timed out for command ${pending.command.commandId}`,
        ),
      );
    }, this.commandTimeoutMs);

    child.stdin.write(`${JSON.stringify(pending.command)}\n`, (error) => {
      if (error !== null && error !== undefined) {
        this.markUnavailable(
          new MatchingEngineTransportError(
            'MATCHER_UNAVAILABLE',
            `Could not write matcher command: ${error.message}`,
          ),
        );
      }
    });
  }

  private receiveStdout(child: ChildProcessWithoutNullStreams, chunk: string): void {
    if (this.child !== child) {
      return;
    }
    this.responseBuffer += chunk;
    if (Buffer.byteLength(this.responseBuffer, 'utf8') > this.maximumResponseLineBytes) {
      this.markUnavailable(
        new MatchingEngineTransportError(
          'MATCHER_PROTOCOL_ERROR',
          'Matching engine response exceeded the configured line limit',
        ),
      );
      return;
    }

    let newlineIndex = this.responseBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.responseBuffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.responseBuffer = this.responseBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.receiveLine(line);
      }
      newlineIndex = this.responseBuffer.indexOf('\n');
    }
  }

  private receiveLine(line: string): void {
    const pending = this.inFlight;
    if (pending === undefined) {
      this.markUnavailable(
        new MatchingEngineTransportError(
          'MATCHER_PROTOCOL_ERROR',
          'Matching engine emitted an unsolicited response',
        ),
      );
      return;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      this.markUnavailable(
        new MatchingEngineTransportError(
          'MATCHER_PROTOCOL_ERROR',
          'Matching engine emitted invalid JSON',
        ),
      );
      return;
    }
    const parsed = matcherResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      this.markUnavailable(
        new MatchingEngineTransportError(
          'MATCHER_PROTOCOL_ERROR',
          'Matching engine emitted a response that violates protocol version 1',
        ),
      );
      return;
    }
    if (
      parsed.data.commandId !== pending.command.commandId ||
      parsed.data.type !== pending.command.type
    ) {
      this.markUnavailable(
        new MatchingEngineTransportError(
          'MATCHER_PROTOCOL_ERROR',
          'Matching engine response does not match the in-flight command',
        ),
      );
      return;
    }

    if (pending.timeout !== undefined) {
      clearTimeout(pending.timeout);
    }
    this.inFlight = undefined;
    pending.resolve(parsed.data);
    this.pump();
  }

  private rejectPending(error: Error): void {
    if (this.inFlight !== undefined) {
      if (this.inFlight.timeout !== undefined) {
        clearTimeout(this.inFlight.timeout);
      }
      this.inFlight.reject(error);
      this.inFlight = undefined;
    }
    for (const pending of this.queue.splice(0)) {
      pending.reject(error);
    }
  }

  private markUnavailable(error: MatchingEngineTransportError): void {
    if (this.stateValue === 'UNAVAILABLE') {
      return;
    }
    const child = this.child;
    this.child = undefined;
    this.stateValue = 'UNAVAILABLE';
    this.rejectPending(error);
    if (child !== undefined && !child.killed) {
      child.kill();
    }
  }

  private async stopProcess(reason: MatchingEngineTransportError): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.rejectPending(reason);
    this.responseBuffer = '';
    this.stateValue = 'STOPPED';
    if (child === undefined || child.exitCode !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      child.once('close', () => resolve());
      if (!child.kill()) {
        resolve();
      }
    });
  }
}

export class MatchingEngineRecoveryCoordinator {
  public async restart(client: MatchingEngineClient): Promise<void> {
    await client.restartForRecovery(recoveryAuthorization);
  }
}

