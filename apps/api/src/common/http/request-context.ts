import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { WEBHOOK_PATHS } from '@vyra/shared';
import { AppError } from './errors';

/** Request id + structured access log. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Request');
  use(req: Request & { id?: string }, res: Response, next: NextFunction) {
    const incoming = req.header('x-request-id');
    req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', req.id);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (process.env.NODE_ENV === 'test') return;
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      this.logger.log(JSON.stringify({ id: req.id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms) }));
    });
    next();
  }
}

/**
 * CSRF defence for cookie-authenticated requests: state-changing requests must
 * carry `X-Requested-With: vyra` (a custom header cannot be sent cross-site
 * without a CORS preflight, which our CORS allowlist rejects). Webhooks are exempt.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const safe = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    // Exact match on the full URL (req.path is relative to the middleware mount point).
    const exempt = (WEBHOOK_PATHS as readonly string[]).includes(req.originalUrl.split('?')[0]!);
    const bearer = req.header('authorization')?.startsWith('Bearer ');
    if (!safe && !exempt && !bearer && req.header('x-requested-with') !== 'vyra') {
      return next(new AppError('FORBIDDEN', 'Missing CSRF header', 403));
    }
    next();
  }
}
