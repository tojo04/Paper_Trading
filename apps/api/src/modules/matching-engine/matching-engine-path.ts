import { existsSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findWorkspaceRoot(start = dirname(fileURLToPath(import.meta.url))): string {
  let current = resolve(start);
  const root = parse(current).root;

  while (current !== root) {
    if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    current = dirname(current);
  }

  throw new Error('Could not locate the paper trading terminal workspace root');
}

export function resolveMatchingEngineExecutable(
  configuredPath = process.env.MATCHING_ENGINE_EXECUTABLE,
): string {
  if (configuredPath !== undefined && configuredPath.trim().length > 0) {
    const resolved = resolve(configuredPath);
    if (!existsSync(resolved)) {
      throw new Error(`Configured matching engine executable does not exist: ${resolved}`);
    }
    return resolved;
  }

  const workspaceRoot = findWorkspaceRoot();
  const candidates =
    process.platform === 'win32'
      ? [
          resolve(workspaceRoot, 'build/debug/services/matching-engine/Debug/matching-engine.exe'),
          resolve(
            workspaceRoot,
            'build/release/services/matching-engine/Release/matching-engine.exe',
          ),
        ]
      : [
          resolve(workspaceRoot, 'build/debug/services/matching-engine/matching-engine'),
          resolve(workspaceRoot, 'build/release/services/matching-engine/matching-engine'),
        ];
  const executable = candidates.find((candidate) => existsSync(candidate));

  if (executable === undefined) {
    throw new Error(
      `Matching engine executable was not found. Build it first with: cmake --build --preset debug`,
    );
  }
  return executable;
}
