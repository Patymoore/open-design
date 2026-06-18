import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAmrCloudRecoveryService } from '../../src/integrations/amr-cloud-recovery.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function tempDataDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'od-amr-recovery-'));
}

function recoveryFiles(dataDir: string): unknown[] {
  const dir = path.join(dataDir, 'amr-cloud-recovery');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as unknown);
}

const HOME_KEY = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
let prevHome: string | undefined;
const tempHomes: string[] = [];

// Drive file-based AMR auth deterministically: point `os.homedir()` at a temp
// HOME containing `~/.amr/config.json` with a known user, instead of depending
// on the ambient machine's real AMR login.
function withFileAuthUser(user: { id: string; email: string }): string {
  prevHome = process.env[HOME_KEY];
  const home = mkdtempSync(path.join(tmpdir(), 'od-amr-home-'));
  tempHomes.push(home);
  process.env[HOME_KEY] = home;
  mkdirSync(path.join(home, '.amr'), { recursive: true });
  writeFileSync(
    path.join(home, '.amr', 'config.json'),
    JSON.stringify({
      profiles: { prod: { runtimeKey: 'rt-file', apiUrl: 'https://amr.example', user } },
    }),
  );
  return home;
}

function rewriteFileAuthUser(home: string, user: { id: string; email: string }): void {
  writeFileSync(
    path.join(home, '.amr', 'config.json'),
    JSON.stringify({
      profiles: { prod: { runtimeKey: 'rt-file', apiUrl: 'https://amr.example', user } },
    }),
  );
}

afterEach(() => {
  if (prevHome === undefined) delete process.env[HOME_KEY];
  else process.env[HOME_KEY] = prevHome;
  prevHome = undefined;
  while (tempHomes.length) {
    try { rmSync(tempHomes.pop()!, { recursive: true, force: true }); } catch {}
  }
});

describe('AMR Cloud Recovery service', () => {
  it('registers and pauses with minimal private context while public overlay excludes secrets', async () => {
    const dataDir = tempDataDir();
    const calls: Array<{ url: string; body?: unknown }> = [];
    const responses = [
      {
        operationId: 'op-1',
        retryToken: 'retry-secret',
        status: 'active',
        version: 1,
        userId: 'env-auth-user',
      },
      {
        operationId: 'op-1',
        status: 'waiting_payment',
        version: 2,
        recoveryUrl: 'https://open-design.ai/wallet/recovery?operation_id=op-1',
      },
    ];
    const service = createAmrCloudRecoveryService({
      dataDir,
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return jsonResponse(responses.shift());
      },
      now: () => 1_000,
    });

    const env = {
      VELA_RUNTIME_KEY: 'runtime-secret',
      VELA_API_URL: 'https://amr.example',
    } as NodeJS.ProcessEnv;
    await service.prepareRun({
      run: {
        id: 'run-1',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        assistantMessageId: 'assistant-1',
      },
      env,
      model: 'chat-model',
    });
    const overlay = await service.pauseForInsufficientBalance({ runId: 'run-1', env });

    expect(calls.map((call) => call.url)).toEqual([
      'https://amr.example/api/v1/billing/recoveries',
      'https://amr.example/api/v1/billing/recoveries/op-1/insufficient-balance',
    ]);
    expect(calls[1]?.body).toMatchObject({ retryToken: 'retry-secret', version: 1 });
    expect(overlay).toMatchObject({
      operationId: 'op-1',
      state: 'recovering_waiting_payment',
      userAction: 'open_wallet',
    });
    expect(JSON.stringify(overlay)).not.toContain('retry-secret');
    expect(JSON.stringify(overlay)).not.toContain('env-auth-user');

    const stored = recoveryFiles(dataDir)[0] as Record<string, unknown>;
    expect(stored.retryToken).toBe('retry-secret');
    expect(stored).not.toHaveProperty('message');
    expect(stored).not.toHaveProperty('cwd');
    expect(stored).not.toHaveProperty('env');
  });

  it('keeps manual top-up user initiated and preserves retry token when status reads omit it', async () => {
    const dataDir = tempDataDir();
    const responses = [
      { operationId: 'op-2', retryToken: 'retry-token', status: 'active', version: 1 },
      { operationId: 'op-2', status: 'waiting_payment', version: 2, manualTopupRequired: true },
      { operationId: 'op-2', status: 'retry_available', version: 3, manualTopupRequired: true },
      { operationId: 'op-2', status: 'resuming', version: 4 },
    ];
    const bodies: unknown[] = [];
    const service = createAmrCloudRecoveryService({
      dataDir,
      fetchImpl: async (_url, init) => {
        if (init?.body) bodies.push(JSON.parse(String(init.body)));
        return jsonResponse(responses.shift());
      },
      now: () => 2_000,
    });
    const env = { VELA_RUNTIME_KEY: 'rt', VELA_API_URL: 'https://amr.example' } as NodeJS.ProcessEnv;

    await service.prepareRun({ run: { id: 'run-2' }, env });
    const waiting = await service.pauseForInsufficientBalance({ runId: 'run-2', env });
    expect(waiting).toMatchObject({
      state: 'recovering_waiting_payment',
      mode: 'manual_topup_required',
      canResume: false,
    });

    const resuming = await service.resumeRun({ runId: 'run-2', env });
    expect(resuming).toMatchObject({ state: 'recovering_resuming' });
    expect(bodies.at(-1)).toMatchObject({ retryToken: 'retry-token', version: 3 });
  });

  it('blocks a genuinely different file-auth AMR user instead of resuming', async () => {
    const dataDir = tempDataDir();
    const home = withFileAuthUser({ id: 'user-a', email: 'a@example.com' });
    const service = createAmrCloudRecoveryService({
      dataDir,
      fetchImpl: async () => jsonResponse({
        operationId: 'op-3',
        retryToken: 'token',
        status: 'active',
        version: 1,
      }),
      now: () => 3_000,
    });

    // Registered while signed in as user-a.
    await service.prepareRun({ run: { id: 'run-3' }, env: {} as NodeJS.ProcessEnv });
    // A different real AMR user is now signed in locally.
    rewriteFileAuthUser(home, { id: 'user-b', email: 'b@example.com' });
    const overlay = await service.resumeRun({ runId: 'run-3', env: {} as NodeJS.ProcessEnv });

    expect(overlay).toMatchObject({
      state: 'recovering_blocked',
      userAction: 'switch_amr_user',
      blockReason: 'wrong_user',
    });
  });

  it('does not falsely block env-auth recovery as wrong-user (sentinel is not an identity)', async () => {
    // Env runtime-key auth carries no resolvable user identity, so the service
    // must not treat the `env-auth-user` sentinel as a mismatched account and
    // block recovery. VELA_LINK_URL forces the deterministic `user: null` path
    // so the test never reads the ambient machine's ~/.amr config.
    const dataDir = tempDataDir();
    const responses = [
      { operationId: 'op-env', retryToken: 'tok', status: 'active', version: 1, userId: 'user-a' },
      { operationId: 'op-env', status: 'retry_available', version: 2 },
      { operationId: 'op-env', status: 'resuming', version: 3 },
    ];
    const service = createAmrCloudRecoveryService({
      dataDir,
      fetchImpl: async () => jsonResponse(responses.shift()),
      now: () => 4_000,
    });
    const env = {
      VELA_RUNTIME_KEY: 'rt',
      VELA_LINK_URL: 'https://link.example',
      VELA_API_URL: 'https://amr.example',
    } as NodeJS.ProcessEnv;

    await service.prepareRun({ run: { id: 'run-env' }, env });
    const overlay = await service.resumeRun({ runId: 'run-env', env });

    expect(overlay?.blockReason).not.toBe('wrong_user');
    expect(overlay).toMatchObject({ state: 'recovering_resuming' });
  });

  it('does not claim the AMR operation is canceled when the cancel call fails', async () => {
    const dataDir = tempDataDir();
    const responses: Array<{ url: string; body: unknown }> = [];
    const service = createAmrCloudRecoveryService({
      dataDir,
      fetchImpl: async (url, init) => {
        responses.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.endsWith('/cancel')) return jsonResponse({ message: 'cloud unavailable' }, 502);
        if (url.endsWith('/insufficient-balance')) {
          return jsonResponse({ operationId: 'op-c', status: 'waiting_payment', version: 2 });
        }
        return jsonResponse({ operationId: 'op-c', retryToken: 'tok', status: 'active', version: 1 });
      },
      now: () => 5_000,
    });
    const env = { VELA_RUNTIME_KEY: 'rt', VELA_API_URL: 'https://amr.example' } as NodeJS.ProcessEnv;

    await service.prepareRun({ run: { id: 'run-c' }, env });
    await service.pauseForInsufficientBalance({ runId: 'run-c', env });
    const overlay = await service.cancelRun({ runId: 'run-c', env });

    // The cloud cancel failed (502), so the operation is NOT canceled locally.
    expect(overlay?.state).not.toBe('recovering_canceled');
    expect(overlay).toMatchObject({ state: 'recovering_waiting_payment', canCancel: true });
    const stored = recoveryFiles(dataDir)[0] as Record<string, unknown>;
    expect(stored.status).not.toBe('canceled');
  });

  it('persists restart-available guidance through the service', async () => {
    const dataDir = tempDataDir();
    const service = createAmrCloudRecoveryService({
      dataDir,
      fetchImpl: async (url) => {
        if (url.endsWith('/insufficient-balance')) {
          return jsonResponse({ operationId: 'op-r', status: 'waiting_payment', version: 2 });
        }
        return jsonResponse({ operationId: 'op-r', retryToken: 'tok', status: 'active', version: 1 });
      },
      now: () => 6_000,
    });
    const env = { VELA_RUNTIME_KEY: 'rt', VELA_API_URL: 'https://amr.example' } as NodeJS.ProcessEnv;

    await service.prepareRun({ run: { id: 'run-r' }, env });
    await service.pauseForInsufficientBalance({ runId: 'run-r', env });
    const overlay = service.markRestartAvailable({
      runId: 'run-r',
      message: 'Restart to continue.',
    });

    expect(overlay).toMatchObject({
      state: 'recovering_restart_available',
      restartAvailable: true,
      userAction: 'restart_request',
      message: 'Restart to continue.',
    });
    // The restart decision must survive a daemon restart: it is written to disk,
    // and the restart copy lives in `restartMessage`, never in `blockReason`.
    const stored = recoveryFiles(dataDir)[0] as Record<string, unknown>;
    expect(stored.restartAvailable).toBe(true);
    expect(stored.restartMessage).toBe('Restart to continue.');
    expect(stored.blockReason).not.toBe('Restart to continue.');

    // A fresh service instance (simulating a daemon restart) still sees it.
    const reloaded = createAmrCloudRecoveryService({ dataDir, now: () => 6_500 });
    expect(reloaded.getOverlayForRun('run-r')).toMatchObject({
      state: 'recovering_restart_available',
      restartAvailable: true,
    });
  });

  it('cleans invisible pre-registered operations on terminal failure', async () => {
    const dataDir = tempDataDir();
    const service = createAmrCloudRecoveryService({
      dataDir,
      fetchImpl: async () => jsonResponse({ operationId: 'op-4', retryToken: 't', status: 'active', version: 1 }),
    });
    const env = { VELA_RUNTIME_KEY: 'rt', VELA_API_URL: 'https://amr.example' } as NodeJS.ProcessEnv;

    await service.prepareRun({ run: { id: 'run-4' }, env });
    const overlay = await service.markTerminal({ runId: 'run-4', terminal: 'fail', env });

    expect(overlay).toBeNull();
    expect(service.getContextForRun('run-4')).toBeNull();
  });
});
