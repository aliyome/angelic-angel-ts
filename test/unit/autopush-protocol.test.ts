import { describe, it, expect } from 'vitest';
import { isPong, parseServerMessage } from '../../src/core/autopush/protocol.js';
import { RecentIdSet } from '../../src/core/autopush/dedupe.js';
import { AutoPushError } from '../../src/core/errors.js';

describe('autopush protocol & dedupe', () => {
  describe('isPong', () => {
    it('should return true for empty object or object without messageType', () => {
      expect(isPong('{}')).toBe(true);
      expect(isPong('{"status": 200}')).toBe(true);
      expect(isPong('{"foo": "bar"}')).toBe(true);
    });

    it('should return false for messages with messageType', () => {
      expect(isPong('{"messageType": "hello"}')).toBe(false);
      expect(isPong('{"messageType": "notification"}')).toBe(false);
    });

    it('should return false for non-objects or invalid JSON', () => {
      expect(isPong('[]')).toBe(false);
      expect(isPong('"hello"')).toBe(false);
      expect(isPong('123')).toBe(false);
      expect(isPong('not-json')).toBe(false);
    });
  });

  describe('parseServerMessage', () => {
    it('should parse hello message', () => {
      const json = '{"messageType":"hello","status":200,"uaid":"test-uaid-123","use_webpush":true}';
      const msg = parseServerMessage(json);
      expect(msg.messageType).toBe('hello');
      if (msg.messageType === 'hello') {
        expect(msg.status).toBe(200);
        expect(msg.uaid).toBe('test-uaid-123');
        expect(msg.use_webpush).toBe(true);
      }
    });

    it('should parse register message', () => {
      const json = '{"messageType":"register","status":200,"pushEndpoint":"https://push.example.com/123","channelID":"ch-1"}';
      const msg = parseServerMessage(json);
      expect(msg.messageType).toBe('register');
      if (msg.messageType === 'register') {
        expect(msg.status).toBe(200);
        expect(msg.pushEndpoint).toBe('https://push.example.com/123');
        expect(msg.channelID).toBe('ch-1');
      }
    });

    it('should parse notification message', () => {
      const json = '{"messageType":"notification","channelID":"ch-1","version":"v1","data":"b64data","headers":{"encoding":"aes128gcm"}}';
      const msg = parseServerMessage(json);
      expect(msg.messageType).toBe('notification');
      if (msg.messageType === 'notification') {
        expect(msg.channelID).toBe('ch-1');
        expect(msg.version).toBe('v1');
        expect(msg.data).toBe('b64data');
        expect(msg.headers?.['encoding']).toBe('aes128gcm');
      }
    });

    it('should return unknown for unexpected messageType (Q2 parity)', () => {
      const json = '{"messageType":"broadcast","broadcasts":{"x":"y"}}';
      const msg = parseServerMessage(json);
      expect(msg.messageType).toBe('unknown');
    });

    it('should throw AutoPushError on invalid JSON or missing fields', () => {
      expect(() => parseServerMessage('{invalid')).toThrow(AutoPushError);
      expect(() => parseServerMessage('{"messageType":"hello"}')).toThrow(AutoPushError);
    });
  });

  describe('RecentIdSet', () => {
    it('should detect duplicate IDs and evict oldest when exceeding max', () => {
      const dedupe = new RecentIdSet(3);

      dedupe.add('msg-1');
      dedupe.add('msg-2');
      dedupe.add('msg-3');

      expect(dedupe.has('msg-1')).toBe(true);
      expect(dedupe.has('msg-2')).toBe(true);
      expect(dedupe.has('msg-3')).toBe(true);
      expect(dedupe.size).toBe(3);

      // Add 4th item -> msg-1 should be evicted
      dedupe.add('msg-4');
      expect(dedupe.has('msg-1')).toBe(false);
      expect(dedupe.has('msg-2')).toBe(true);
      expect(dedupe.has('msg-3')).toBe(true);
      expect(dedupe.has('msg-4')).toBe(true);
      expect(dedupe.size).toBe(3);
    });
  });
});
