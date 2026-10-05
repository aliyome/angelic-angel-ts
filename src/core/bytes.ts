const B64URL_RE = /^[A-Za-z0-9_-]*$/;

/**
 * Decodes a URL-safe base64 string (RFC 4648 Section 5, without padding).
 * Strict: rejects invalid characters and malformed lengths.
 */
export function fromBase64Url(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '');
  if (!B64URL_RE.test(clean) || clean.length % 4 === 1) {
    throw new TypeError('invalid base64url');
  }
  const padLen = (4 - (clean.length % 4)) % 4;
  const b64 = clean.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes a Uint8Array to a URL-safe base64 string (without padding).
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Concatenates multiple Uint8Arrays into a single Uint8Array.
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Converts a 16-bit unsigned integer to a 2-byte big-endian Uint8Array.
 */
export function u16be(n: number): Uint8Array {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}

/**
 * Decodes UTF-8 bytes to string strictly. Throws TypeError on invalid UTF-8.
 */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return decoder.decode(bytes);
}

/**
 * Encodes string to UTF-8 bytes.
 */
export function encodeUtf8(s: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(s);
}

/**
 * Casts Uint8Array to BufferSource for Web Crypto API compatibility.
 */
export function toBufferSource(arr: Uint8Array): BufferSource {
  return arr as unknown as BufferSource;
}

