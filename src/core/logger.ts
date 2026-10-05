export interface Logger {
  debug(obj: Record<string, unknown> | string, msg?: string): void;
  info(obj: Record<string, unknown> | string, msg?: string): void;
  warn(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
}

export class NoopLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
