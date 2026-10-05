import { describe, it, expect } from 'vitest';
import { generateKeys, importPrivateKey } from '../../src/core/keys.js';
import { DecryptionError } from '../../src/core/errors.js';

describe('keys module', () => {
  it('should generate valid WebPushKeys', async () => {
    const keys = await generateKeys();

    expect(keys.publicKey.length).toBe(65);
    expect(keys.publicKey[0]).toBe(0x04);
    expect(keys.privateKey.length).toBe(32);
    expect(keys.authSecret.length).toBe(16);

    // Should be able to import the generated keys
    const cryptoKey = await importPrivateKey(keys);
    expect(cryptoKey).toBeDefined();
    expect(cryptoKey.type).toBe('private');
    expect(cryptoKey.algorithm.name).toBe('ECDH');
  });

  it('should reject invalid private key length', async () => {
    const keys = await generateKeys();
    const badKeys = { ...keys, privateKey: keys.privateKey.subarray(0, 31) };
    await expect(importPrivateKey(badKeys)).rejects.toThrow(DecryptionError);
  });

  it('should reject invalid public key format', async () => {
    const keys = await generateKeys();
    const badPub = new Uint8Array(keys.publicKey);
    badPub[0] = 0x02; // compressed format
    await expect(importPrivateKey({ ...keys, publicKey: badPub })).rejects.toThrow(DecryptionError);
  });
});
