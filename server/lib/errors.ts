/**
 * Erros tipados — facilitam mapping para status HTTP.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'INTERNAL_ERROR',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} não encontrado`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export class TimeoutError extends AppError {
  constructor(message = 'operação excedeu o tempo limite') {
    super(message, 504, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
