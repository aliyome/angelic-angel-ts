import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';

const cliPath = path.resolve(__dirname, '../../dist/cli.js');

function runCli(
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code, signal) => {
      resolve({ stdout, stderr, code, signal });
    });
  });
}

describe('CLI end-to-end', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-e2e-'));
    configPath = path.join(tmpDir, 'test.toml');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should show not found status when config does not exist', async () => {
    const res = await runCli(['-c', configPath, 'status']);
    expect(res.code).toBe(0);
    expect(res.stderr).toContain('not found');
    expect(res.stderr).toContain('angelic-angel init');
  });

  it('should run init with flags, generate 0600 file, and show not registered status', async () => {
    const initRes = await runCli([
      '-c',
      configPath,
      'init',
      '--auth-token',
      'my_auth_token_123456789012345',
      '--ct0',
      'my_ct0_12345678901234567890',
    ]);
    expect(initRes.code).toBe(0);
    expect(initRes.stderr).toContain('Saved to');

    // Verify 0600 permissions
    const stat = await fs.stat(configPath);
    expect(stat.mode & 0o777).toBe(0o600);

    // Verify status output
    const statusRes = await runCli(['-c', configPath, 'status']);
    expect(statusRes.code).toBe(0);
    expect(statusRes.stderr).toContain('my_auth_token_12345');
    expect(statusRes.stderr).toContain('not registered');
    expect(statusRes.stderr).toContain('angelic-angel register');
  });

  it('should fail with exit code 1 on invalid listen (not registered)', async () => {
    // initialize first
    await runCli([
      '-c',
      configPath,
      'init',
      '--auth-token',
      'token',
      '--ct0',
      'ct0',
    ]);

    const res = await runCli(['-c', configPath, 'listen']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('No registration found');
  });

  it('should exit with code 130 on SIGINT (D3 parity)', async () => {
    const child = spawn(process.execPath, [cliPath, '-c', configPath, 'init'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let killed = false;

    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (!killed && stderr.includes('Initializing configuration')) {
        killed = true;
        child.kill('SIGINT');
      }
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
    });

    expect(exitCode).toBe(130);
    expect(stderr).toContain('Interrupted');
  });
});
