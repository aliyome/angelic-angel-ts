import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseConfig, stringifyConfig } from '../../src/core/config.js';
import { FileConfigStore } from '../../src/node/config-store.js';
import { ConfigError } from '../../src/core/errors.js';

describe('config module', () => {
  const fixturePath = path.resolve(__dirname, '../fixtures/sample-config.toml');

  it('should parse Rust-compatible TOML config file', async () => {
    const content = await fs.readFile(fixturePath, 'utf-8');
    const config = parseConfig(content);

    expect(config.twitter.authToken).toBe('test_auth_token_value_123456789012345');
    expect(config.twitter.ct0).toBe('test_auth_token_value_12345678901234567890'.replace('auth_token', 'ct0'));
    expect(config.registration).toBeDefined();
    expect(config.registration?.endpoint).toBe(
      'https://updates.push.services.mozilla.com/wpush/v2/test_endpoint_token'
    );
    expect(config.registration?.autopush.uaid).toBe('test-uaid-uuid-v4-string');
    expect(config.registration?.autopush.channelId).toBe('test-channel-id-uuid-v4-string');
    expect(config.registration?.keys.publicKey.length).toBe(65);
    expect(config.registration?.keys.privateKey.length).toBe(32);
    expect(config.registration?.keys.authSecret.length).toBe(16);
  });

  it('should parse config without registration section', () => {
    const toml = `
[twitter]
auth_token = "my_token"
ct0 = "my_ct0"
`;
    const config = parseConfig(toml);
    expect(config.twitter.authToken).toBe('my_token');
    expect(config.twitter.ct0).toBe('my_ct0');
    expect(config.registration).toBeUndefined();
  });

  it('should reject invalid keys (wrong lengths)', () => {
    const toml = `
[twitter]
auth_token = "my_token"
ct0 = "my_ct0"

[registration]
endpoint = "https://example.com"
[registration.autopush]
uaid = "u"
channel_id = "c"
[registration.keys]
public_key = [1, 2, 3] # wrong length
private_key = [1]
auth_secret = [1]
`;
    expect(() => parseConfig(toml)).toThrow(ConfigError);
  });

  it('should round-trip config via stringifyConfig and parseConfig', async () => {
    const content = await fs.readFile(fixturePath, 'utf-8');
    const original = parseConfig(content);
    const serialized = stringifyConfig(original);
    const roundTripped = parseConfig(serialized);

    expect(roundTripped.twitter).toEqual(original.twitter);
    expect(roundTripped.registration?.endpoint).toBe(original.registration?.endpoint);
    expect(roundTripped.registration?.autopush).toEqual(original.registration?.autopush);
    expect(roundTripped.registration?.keys.publicKey).toEqual(original.registration?.keys.publicKey);
    expect(roundTripped.registration?.keys.privateKey).toEqual(original.registration?.keys.privateKey);
    expect(roundTripped.registration?.keys.authSecret).toEqual(original.registration?.keys.authSecret);
  });

  it('should save and load config atomically via FileConfigStore with 0600 mode', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'angelic-test-'));
    const testFile = path.join(tmpDir, 'test.toml');

    try {
      const store = new FileConfigStore(testFile);
      const original = parseConfig(await fs.readFile(fixturePath, 'utf-8'));

      await store.save(original);
      const loaded = await store.load();

      expect(loaded.twitter).toEqual(original.twitter);
      expect(loaded.registration?.endpoint).toBe(original.registration?.endpoint);

      // Verify file permissions (0600)
      const stat = await fs.stat(testFile);
      // On POSIX systems, mask with 0o777
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
