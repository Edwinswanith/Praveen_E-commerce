import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorCode =
  | 'VALIDATION_FAILED' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'OUT_OF_STOCK'
  | 'RATE_LIMITED' | 'PAYMENT_FAILED' | 'BAD_REQUEST' | 'INTERNAL' | 'NOT_CONFIGURED';

/** Domain error with a stable machine-readable code. */
export class AppError extends HttpException {
  constructor(public readonly code: ErrorCode, message: string, status: HttpStatus, public readonly details?: unknown) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`, HttpStatus.NOT_FOUND);
export const badRequest = (message: string, details?: unknown) => new AppError('BAD_REQUEST', message, HttpStatus.BAD_REQUEST, details);
export const conflict = (message: string, details?: unknown) => new AppError('CONFLICT', message, HttpStatus.CONFLICT, details);
export const forbidden = (message = 'You do not have permission to do that') => new AppError('FORBIDDEN', message, HttpStatus.FORBIDDEN);
export const unauthorized = (message = 'Please sign in to continue') => new AppError('UNAUTHORIZED', message, HttpStatus.UNAUTHORIZED);
export const outOfStock = (message: string, details?: unknown) => new AppError('OUT_OF_STOCK', message, HttpStatus.CONFLICT, details);
export const notConfigured = (what: string) =>
  new AppError('NOT_CONFIGURED', `${what} is pending configuration`, HttpStatus.SERVICE_UNAVAILABLE);
