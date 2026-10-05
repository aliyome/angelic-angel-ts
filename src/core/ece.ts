import { concatBytes, fromBase64Url, u16be, encodeUtf8, toBufferSource } from './bytes.js';
import type { WebPushKeys } from './config.js';
import { DecryptionError } from './errors.js';
import { importPrivateKey } from './keys.js';

const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' } as const;

/**
 * Extracts a named parameter from a semicolon-delimited header value.
 * Example: given "dh=abc123;p256ecdsa=xyz" and param "dh", returns "abc123".
 */
export function parseHeaderParam(headerValue: string | undefined, paramName: string): string {
  if (!headerValue) {
    throw new DecryptionError(`missing required header for param '${paramName}'`);
  }

  const prefix = `${paramName}=`;
  for (const part of headerValue.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }

  throw new DecryptionError(`param '${paramName}' not found in header: ${headerValue}`);
}

async function computeEcdhSecret(privateKey: CryptoKey, peerPublicKeyRaw: Uint8Array): Promise<Uint8Array> {
  if (peerPublicKeyRaw.length !== 65 || peerPublicKeyRaw[0] !== 0x04) {
    throw new DecryptionError('invalid peer public key format: expected 65 bytes starting with 0x04');
  }

  let peerPublicKey: CryptoKey;
  try {
    // importKey with raw format automatically verifies that the point is on the curve P-256
    peerPublicKey = await crypto.subtle.importKey(
      'raw',
      toBufferSource(peerPublicKeyRaw),
      ECDH_PARAMS,
      false,
      []
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DecryptionError(`invalid peer public key on curve P-256: ${msg}`, { cause: err });
  }

  try {
    const derived = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: peerPublicKey },
      privateKey,
      256
    );
    return new Uint8Array(derived);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DecryptionError(`ECDH derivation failed: ${msg}`, { cause: err });
  }
}

async function hkdfDerive(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  lengthBytes: number
): Promise<Uint8Array> {
  try {
    const key = await crypto.subtle.importKey('raw', toBufferSource(ikm), 'HKDF', false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: toBufferSource(salt),
        info: toBufferSource(info),
      },
      key,
      lengthBytes * 8
    );
    return new Uint8Array(derived);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DecryptionError(`HKDF derivation failed: ${msg}`, { cause: err });
  }
}

async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  data: Uint8Array
): Promise<Uint8Array> {
  try {
    const key = await crypto.subtle.importKey('raw', toBufferSource(keyBytes), 'AES-GCM', false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBufferSource(nonce), tagLength: 128 },
      key,
      toBufferSource(data)
    );
    return new Uint8Array(decrypted);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DecryptionError(`AES-GCM decryption failed: ${msg}`, { cause: err });
  }
}

function calculateNonce(baseNonce: Uint8Array, seq: number): Uint8Array {
  const nonce = new Uint8Array(baseNonce);
  // XOR the 48-bit sequence number into the last 6 bytes of the nonce
  for (let i = 0; i < 6; i++) {
    nonce[11 - i] ^= Math.floor(seq / 2 ** (8 * i)) & 0xff;
  }
  return nonce;
}

/**
 * Decrypts Web Push payload encrypted with RFC 8291 / RFC 8188 (aes128gcm).
 */
async function decryptAes128gcm(body: Uint8Array, keys: WebPushKeys): Promise<Uint8Array> {
  // Header: salt (16) + rs (4) + idlen (1) + keyid (idlen)
  if (body.length < 21) {
    throw new DecryptionError(`aes128gcm body too short: ${body.length} bytes`);
  }

  const salt = body.subarray(0, 16);
  const dataView = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const rs = dataView.getUint32(16, false); // big-endian
  const idlen = body[20];

  if (rs < 18) {
    throw new DecryptionError(`invalid rs (record size): ${rs}`);
  }
  if (idlen !== 65) {
    throw new DecryptionError(`unsupported keyid length: ${idlen} (expected 65)`);
  }
  if (body.length < 21 + idlen) {
    throw new DecryptionError(`body too short for sender public key: ${body.length}`);
  }

  const senderPublicKey = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);

  const privateKey = await importPrivateKey(keys);
  const ecdhSecret = await computeEcdhSecret(privateKey, senderPublicKey);

  const keyInfo = concatBytes(encodeUtf8('WebPush: info\0'), keys.publicKey, senderPublicKey);
  const ikm = await hkdfDerive(keys.authSecret, ecdhSecret, keyInfo, 32);

  const cek = await hkdfDerive(salt, ikm, encodeUtf8('Content-Encoding: aes128gcm\0'), 16);
  const baseNonce = await hkdfDerive(salt, ikm, encodeUtf8('Content-Encoding: nonce\0'), 12);

  const decryptedRecords: Uint8Array[] = [];
  let seq = 0;

  for (let offset = 0; offset < ciphertext.length; offset += rs, seq++) {
    const record = ciphertext.subarray(offset, Math.min(offset + rs, ciphertext.length));
    const isLast = offset + rs >= ciphertext.length;

    const plaintextWithPadding = await aesGcmDecrypt(
      cek,
      calculateNonce(baseNonce, seq),
      record
    );

    // Padding delimiter: find last non-zero byte
    let i = plaintextWithPadding.length - 1;
    while (i >= 0 && plaintextWithPadding[i] === 0) {
      i--;
    }
    if (i < 0) {
      throw new DecryptionError('no padding delimiter found');
    }

    const delimiter = plaintextWithPadding[i];
    const expectedDelimiter = isLast ? 2 : 1;
    if (delimiter !== expectedDelimiter) {
      throw new DecryptionError(
        `invalid padding delimiter: got ${delimiter}, expected ${expectedDelimiter}`
      );
    }

    decryptedRecords.push(plaintextWithPadding.subarray(0, i));
  }

  return concatBytes(...decryptedRecords);
}

/**
 * Decrypts Web Push payload encrypted with draft-ietf-webpush-encryption-04 (aesgcm).
 */
async function decryptAesgcm(
  body: Uint8Array,
  headers: Record<string, string> | undefined,
  keys: WebPushKeys
): Promise<Uint8Array> {
  if (!headers) {
    throw new DecryptionError('aesgcm encoding requires headers but none were provided');
  }

  const dhB64 = parseHeaderParam(headers['crypto_key'] || headers['Crypto-Key'], 'dh');
  let senderPublicKey: Uint8Array;
  try {
    senderPublicKey = fromBase64Url(dhB64);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DecryptionError(`failed to base64-decode sender public key: ${msg}`, { cause: err });
  }

  const saltB64 = parseHeaderParam(headers['encryption'] || headers['Encryption'], 'salt');
  let salt: Uint8Array;
  try {
    salt = fromBase64Url(saltB64);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DecryptionError(`failed to base64-decode salt: ${msg}`, { cause: err });
  }

  const rs = 4096;
  const privateKey = await importPrivateKey(keys);
  const ecdhSecret = await computeEcdhSecret(privateKey, senderPublicKey);

  const ikm = await hkdfDerive(keys.authSecret, ecdhSecret, encodeUtf8('Content-Encoding: auth\0'), 32);

  const context = concatBytes(
    encodeUtf8('P-256\0'),
    u16be(65),
    keys.publicKey,
    u16be(65),
    senderPublicKey
  );

  const cek = await hkdfDerive(
    salt,
    ikm,
    concatBytes(encodeUtf8('Content-Encoding: aesgcm\0'), context),
    16
  );
  const baseNonce = await hkdfDerive(
    salt,
    ikm,
    concatBytes(encodeUtf8('Content-Encoding: nonce\0'), context),
    12
  );

  const recordSize = rs + 16;
  const decryptedRecords: Uint8Array[] = [];
  let seq = 0;

  for (let offset = 0; offset < body.length; offset += recordSize, seq++) {
    const record = body.subarray(offset, Math.min(offset + recordSize, body.length));
    const plaintext = await aesGcmDecrypt(cek, calculateNonce(baseNonce, seq), record);

    if (plaintext.length < 2) {
      throw new DecryptionError('plaintext too short to contain padding length');
    }

    const padLen = (plaintext[0] << 8) | plaintext[1];
    if (2 + padLen > plaintext.length) {
      throw new DecryptionError(`padding length exceeds plaintext length: ${padLen}`);
    }

    for (let p = 2; p < 2 + padLen; p++) {
      if (plaintext[p] !== 0) {
        throw new DecryptionError('non-zero byte in padding');
      }
    }

    decryptedRecords.push(plaintext.subarray(2 + padLen));
  }

  return concatBytes(...decryptedRecords);
}

/**
 * Decrypts an encrypted Web Push notification payload.
 */
export async function decryptPayload(
  body: Uint8Array,
  headers: Record<string, string> | undefined,
  keys: WebPushKeys
): Promise<Uint8Array> {
  const encoding = headers?.['encoding'] || headers?.['Content-Encoding'];

  switch (encoding) {
    case 'aes128gcm':
    case undefined:
      return decryptAes128gcm(body, keys);
    case 'aesgcm':
      return decryptAesgcm(body, headers, keys);
    default:
      throw new DecryptionError(`unsupported encoding: ${encoding}`);
  }
}
