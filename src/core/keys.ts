import { fromBase64Url, toBase64Url } from './bytes.js';
import type { WebPushKeys } from './config.js';
import { DecryptionError } from './errors.js';

const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' } as const;

/**
 * Generates fresh P-256 ECDH keys and a 16-byte random authentication secret
 * using the Web Crypto API.
 */
export async function generateKeys(): Promise<WebPushKeys> {
  const keyPair = await crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveBits']);

  const rawPublic = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicKey = new Uint8Array(rawPublic);

  const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  if (!jwk.d) {
    throw new DecryptionError('failed to export private key scalar (d parameter missing)');
  }
  const privateKey = fromBase64Url(jwk.d);

  const authSecret = new Uint8Array(16);
  crypto.getRandomValues(authSecret);

  return {
    publicKey,
    privateKey,
    authSecret,
  };
}

/**
 * Imports a raw 32-byte private key scalar and 65-byte uncompressed public key
 * into a Web Crypto CryptoKey using the JWK format.
 */
export async function importPrivateKey(keys: WebPushKeys): Promise<CryptoKey> {
  if (keys.privateKey.length !== 32) {
    throw new DecryptionError(`invalid private key length: expected 32, got ${keys.privateKey.length}`);
  }
  if (keys.publicKey.length !== 65 || keys.publicKey[0] !== 0x04) {
    throw new DecryptionError(`invalid public key format: expected 65 bytes starting with 0x04`);
  }

  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: toBase64Url(keys.privateKey),
    x: toBase64Url(keys.publicKey.subarray(1, 33)),
    y: toBase64Url(keys.publicKey.subarray(33, 65)),
  };

  try {
    return await crypto.subtle.importKey('jwk', jwk, ECDH_PARAMS, false, ['deriveBits']);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DecryptionError(`failed to import private key: ${msg}`, { cause: err });
  }
}
