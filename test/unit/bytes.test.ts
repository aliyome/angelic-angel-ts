import { describe, it, expect } from 'vitest';
import { fromBase64Url, toBase64Url, concatBytes, u16be, decodeUtf8Strict, encodeUtf8 } from '../../src/core/bytes.js';

describe('bytes utility', () => {
  it('should round-trip base64url encode and decode', () => {
    const raw = new Uint8Array([0, 1, 2, 250, 255, 62, 63, 100]);
    const encoded = toBase64Url(raw);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');

    const decoded = fromBase64Url(encoded);
    expect(decoded).toEqual(raw);
  });

  it('should reject invalid base64url characters', () => {
    expect(() => fromBase64Url('abc+def')).toThrow(TypeError);
    expect(() => fromBase64Url('abc/def')).toThrow(TypeError);
    expect(() => fromBase64Url('abc=')).toThrow(TypeError);
  });

  it('should reject malformed base64url length (% 4 === 1)', () => {
    expect(() => fromBase64Url('a')).toThrow(TypeError);
    expect(() => fromBase64Url('abcde')).toThrow(TypeError);
  });

  it('should concatenate multiple Uint8Arrays', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4, 5]);
    const c = new Uint8Array([6]);
    expect(concatBytes(a, b, c)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it('should format u16be correctly', () => {
    expect(u16be(0)).toEqual(new Uint8Array([0, 0]));
    expect(u16be(65)).toEqual(new Uint8Array([0, 65]));
    expect(u16be(4096)).toEqual(new Uint8Array([16, 0]));
    expect(u16be(0xffff)).toEqual(new Uint8Array([255, 255]));
  });

  it('should encode and strictly decode UTF-8', () => {
    const text = 'こんにちは、世界！🌟';
    const encoded = encodeUtf8(text);
    expect(decodeUtf8Strict(encoded)).toBe(text);

    // invalid UTF-8
    const invalid = new Uint8Array([0xff, 0xff]);
    expect(() => decodeUtf8Strict(invalid)).toThrow(TypeError);
  });
});
