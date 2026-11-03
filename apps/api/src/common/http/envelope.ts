import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata, StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import type { PageMeta } from '@vyra/shared';

/** Return `paginated(items, meta)` from a handler to emit `{ data: items, meta }`. */
export class Paginated<T> {
  constructor(public readonly items: T[], public readonly meta: PageMeta, public readonly extra?: Record<string, unknown>) {}
}
export function paginated<T>(items: T[], total: number, page: number, pageSize: number, extra?: Record<string, unknown>) {
  return new Paginated(items, { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }, extra);
}

export const RAW_RESPONSE = 'raw_response';
/** Skip the envelope (webhooks, files). */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [ctx.getHandler(), ctx.getClass()]);
    return next.handle().pipe(
      map((value) => {
        if (raw || value instanceof StreamableFile || Buffer.isBuffer(value)) return value;
        if (value instanceof Paginated) return { data: value.items, meta: value.meta, ...(value.extra ?? {}) };
        return { data: value ?? null };
      }),
    );
  }
}
