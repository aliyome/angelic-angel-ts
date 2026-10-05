export type TransportEvent =
  | { type: 'text'; data: string }
  | { type: 'binary'; data: Uint8Array }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'close'; code: number; reason: string }
  | { type: 'error'; error: Error };

export interface Transport {
  /**
   * Waits for and returns the next transport event.
   * If timeoutMs elapses before an event arrives, returns `{ type: 'timeout' }`.
   * After the connection is closed or ends, returns `{ type: 'end' }`.
   */
  next(
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<TransportEvent | { type: 'timeout' } | { type: 'end' }>;

  /** Sends a text frame. */
  sendText(text: string): Promise<void>;

  /** Sends a WebSocket Ping frame (RFC 6455 Section 5.5.2). */
  ping(): Promise<void>;

  /** Closes the transport. */
  close(code?: number): Promise<void>;
}

export type TransportFactory = (url: string, signal?: AbortSignal) => Promise<Transport>;
