import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  matcherCommandSchema,
  type MatcherCommand,
  type MatcherResponse,
} from '@paper-terminal/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MatchingEngineClient,
  MatchingEngineRecoveryCoordinator,
  MatchingEngineTransportError,
} from './matching-engine-client.js';
import { findWorkspaceRoot, resolveMatchingEngineExecutable } from './matching-engine-path.js';

const clients: MatchingEngineClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.stop()));
});

async function readFixtureCommands(): Promise<MatcherCommand[]> {
  const fixturePath = resolve(
    findWorkspaceRoot(),
    'packages/contracts/fixtures/matcher-ipc/commands.jsonl',
  );
  const contents = await readFile(fixturePath, 'utf8');
  return contents
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => matcherCommandSchema.parse(JSON.parse(line)));
}

async function waitForState(client: MatchingEngineClient, expected: 'UNAVAILABLE'): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (client.state !== expected && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  expect(client.state).toBe(expected);
}

function collectLines(child: ChildProcessWithoutNullStreams, count: number): Promise<string[]> {
  return new Promise((resolveLines, rejectLines) => {
    const lines: string[] = [];
    let buffer = '';
    const timeout = setTimeout(
      () => rejectLines(new Error('Timed out waiting for matcher output')),
      5_000,
    );

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) {
          lines.push(line);
        }
        if (lines.length === count) {
          clearTimeout(timeout);
          resolveLines(lines);
          return;
        }
        newline = buffer.indexOf('\n');
      }
    });
    child.once('error', rejectLines);
    child.once('exit', (code) => {
      if (lines.length < count) {
        rejectLines(new Error(`Matcher exited before producing responses (code=${String(code)})`));
      }
    });
  });
}

describe('real matching engine process', () => {
  it('uses the shared fixture, serializes commands, and does not double-apply duplicates', async () => {
    const logs: string[] = [];
    const client = new MatchingEngineClient({
      logger: (event) => logs.push(event.message),
    });
    clients.push(client);
    await client.start();

    const commands = await readFixtureCommands();
    const responses: MatcherResponse[] = await Promise.all(
      commands.map(async (command) => client.send(command)),
    );

    expect(responses).toHaveLength(7);
    expect(responses[3]).toEqual(responses[5]);
    const finalSnapshot = responses[6];
    expect(finalSnapshot?.accepted).toBe(true);
    if (finalSnapshot?.accepted && finalSnapshot.type === 'SNAPSHOT_BOOK') {
      expect(finalSnapshot.result.snapshot.asks[0]?.totalQuantity).toBe('6');
    }
    expect(logs.some((message) => message.includes('ADD_ORDER accepted'))).toBe(true);
    expect(client.state).toBe('READY');
  });

  it('keeps stdout parseable after a malformed line', async () => {
    const child = spawn(resolveMatchingEngineExecutable(), [], {
      cwd: findWorkspaceRoot(),
      shell: false,
      stdio: 'pipe',
      windowsHide: true,
    });
    const responsesPromise = collectLines(child, 2);
    child.stdin.write('{not-json\n');
    child.stdin.write(
      `${JSON.stringify({
        protocolVersion: 1,
        commandId: '00000000-0000-4000-8000-000000000099',
        type: 'PING',
        payload: {},
      })}\n`,
    );

    const responses = (await responsesPromise).map((line) => JSON.parse(line) as unknown);
    child.kill();

    expect(responses).toMatchObject([
      { accepted: false, rejection: { code: 'MALFORMED_MESSAGE' } },
      { accepted: true, type: 'PING', result: { ready: true } },
    ]);
  });

  it('becomes unavailable after a crash and restarts only through recovery coordination', async () => {
    const client = new MatchingEngineClient();
    clients.push(client);
    await client.start();
    const processId = client.processId;
    expect(processId).toBeDefined();
    process.kill(processId as number);
    await waitForState(client, 'UNAVAILABLE');

    await expect(
      client.send({
        protocolVersion: 1,
        commandId: '00000000-0000-4000-8000-000000000090',
        type: 'PING',
        payload: {},
      }),
    ).rejects.toMatchObject<Partial<MatchingEngineTransportError>>({
      code: 'MATCHER_UNAVAILABLE',
    });
    await expect(client.start()).rejects.toMatchObject<Partial<MatchingEngineTransportError>>({
      code: 'MATCHER_NOT_STARTED',
    });

    await new MatchingEngineRecoveryCoordinator().restart(client);
    expect(client.state).toBe('READY');
  });
});
