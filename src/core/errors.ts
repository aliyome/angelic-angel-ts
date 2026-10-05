export abstract class AngelicAngelError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export class GeneralError extends AngelicAngelError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class ConfigError extends AngelicAngelError {
  constructor(detail: string, options?: ErrorOptions) {
    super(`config error: ${detail}`, options);
  }
}

export class AutoPushError extends AngelicAngelError {
  constructor(detail: string, options?: ErrorOptions) {
    super(`AutoPush error: ${detail}`, options);
  }
}

export class BackoffError extends AutoPushError {
  constructor(detail: string = 'server requested backoff', options?: ErrorOptions) {
    super(`BACKOFF: ${detail}`, options);
  }
}

export class ReregistrationFailedError extends AutoPushError {
  constructor(detail: string = 'still failed after re-registration', options?: ErrorOptions) {
    super(detail, options);
  }
}

export class TwitterApiError extends AngelicAngelError {
  readonly status?: number;

  constructor(detail: string, status?: number, options?: ErrorOptions) {
    super(`Twitter API error: ${detail}`, options);
    this.status = status;
  }
}

export class WebSocketError extends AngelicAngelError {
  constructor(detail: string, options?: ErrorOptions) {
    super(`WebSocket error: ${detail}`, options);
  }
}

export class DecryptionError extends AngelicAngelError {
  constructor(detail: string, options?: ErrorOptions) {
    super(`decryption error: ${detail}`, options);
  }
}

export class HttpError extends AngelicAngelError {
  constructor(detail: string, options?: ErrorOptions) {
    super(`HTTP error: ${detail}`, options);
  }
}
