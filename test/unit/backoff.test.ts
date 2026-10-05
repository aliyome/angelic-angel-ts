import { describe, it, expect } from 'vitest';
import { calcBackoff, sleep } from '../../src/core/backoff.js';

describe('backoff module', () => {
  it('should calculate exponential backoff capped at 300s', () => {
    expect(calcBackoff(0)).toBe(5);
    expect(calcBackoff(1)).toBe(5);
    expect(calcBackoff(2)).toBe(10);
    expect(calcBackoff(3)).toBe(20);
    expect(calcBackoff(4)).toBe(40);
    expect(calcBackoff(5)).toBe(80);
    expect(calcBackoff(6)).toBe(160);
    expect(calcBackoff(7)).toBe(300);
    expect(calcBackoff(8)).toBe(300);
    expect(calcBackoff(100)).toBe(300); // no overflow
  });

  it('should sleep and abort on signal', async () => {
    const controller = new AbortController();
    const sleepPromise = sleep(5000, controller.signal);
    controller.abort();
    await expect(sleepPromise).rejects.toThrow('sleep aborted');
  });
});
