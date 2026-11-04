import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppError } from './errors';
import { reportError } from '../monitoring/monitoring';

/** Converts every error into the `{ error: { code, message, details, requestId } }` envelope. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message = 'Something went wrong. Please try again.';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = 'RATE_LIMITED';
      message = 'Too many requests. Please slow down.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : ((body as { message?: string | string[] }).message?.toString() ?? exception.message);
      code = ({ 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'BAD_REQUEST', 415: 'BAD_REQUEST' } as Record<number, string>)[status] ?? 'INTERNAL';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'CONFLICT';
        const target = (exception.meta?.target as string[] | undefined)?.join(', ');
        message = target ? `A record with this ${target} already exists` : 'Duplicate record';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'Resource not found';
      }
    }

    if (status >= 500) {
      // Path only: query strings can carry PII (e.g. /orders/track?phone=…).
      const path = req.url.split('?')[0];
      this.logger.error({ requestId, path, err: exception instanceof Error ? exception.stack : exception });
      reportError(exception, { requestId, path, status });
    }
    res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}), requestId } });
  }
}
