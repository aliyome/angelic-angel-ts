import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerPushSubscription } from '../../src/core/twitter.js';
import { NoopLogger } from '../../src/core/logger.js';
import { TwitterApiError } from '../../src/core/errors.js';
import { FIREFOX_UA } from '../../src/core/autopush/constants.js';
import { toBase64Url } from '../../src/core/bytes.js';

describe('twitter module', () => {
  let server: ReturnType<typeof createServer>;
  let serverUrl: string;
  let receivedHeaders: Record<string, string> = {};
  let receivedBody: unknown = null;
  let mockStatus = 200;
  let mockResponseBody = '{"status": "ok"}';

  beforeEach(async () => {
    mockStatus = 200;
    mockResponseBody = '{"status": "ok"}';
    receivedHeaders = {};
    receivedBody = null;

    server = createServer((req, res) => {
      receivedHeaders = req.headers as Record<string, string>;
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        try {
          receivedBody = JSON.parse(data);
        } catch {
          receivedBody = data;
        }
        res.writeHead(mockStatus, { 'Content-Type': 'application/json' });
        res.end(mockResponseBody);
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('should send correct request to Twitter Push API (headers, body, Firefox UA)', async () => {
    const twitterConfig = {
      authToken: 'mock_auth_token_value',
      ct0: 'mock_ct0_value',
    };

    const registration = {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/test_ep',
      autopush: { uaid: 'u1', channelId: 'c1' },
      keys: {
        publicKey: new Uint8Array(65).fill(4),
        privateKey: new Uint8Array(32).fill(1),
        authSecret: new Uint8Array(16).fill(2),
      },
    };

    await registerPushSubscription(twitterConfig, registration, {
      logger: new NoopLogger(),
      apiBaseUrl: serverUrl,
    });

    // Check headers
    expect(receivedHeaders['user-agent']).toBe(FIREFOX_UA);
    expect(receivedHeaders['x-csrf-token']).toBe('mock_ct0_value');
    expect(receivedHeaders['cookie']).toBe('auth_token=mock_auth_token_value; ct0=mock_ct0_value');
    expect(receivedHeaders['authorization']).toContain('Bearer');
    expect(receivedHeaders['x-twitter-auth-type']).toBe('OAuth2Session');

    // Check body
    expect(receivedBody).toEqual({
      push_device_info: {
        os_version: 'Mac/Firefox',
        udid: 'Mac/Firefox',
        env: 3,
        locale: 'en',
        protocol_version: 1,
        token: registration.endpoint,
        encryption_key1: toBase64Url(registration.keys.publicKey),
        encryption_key2: toBase64Url(registration.keys.authSecret),
      },
    });
  });

  it('should throw TwitterApiError on non-2xx status code', async () => {
    mockStatus = 403;
    mockResponseBody = '{"error": "Forbidden"}';

    const twitterConfig = { authToken: 'a', ct0: 'b' };
    const registration = {
      endpoint: 'ep',
      autopush: { uaid: 'u', channelId: 'c' },
      keys: {
        publicKey: new Uint8Array(65),
        privateKey: new Uint8Array(32),
        authSecret: new Uint8Array(16),
      },
    };

    const promise = registerPushSubscription(twitterConfig, registration, {
      logger: new NoopLogger(),
      apiBaseUrl: serverUrl,
    });

    await expect(promise).rejects.toThrow(TwitterApiError);
  });
});
