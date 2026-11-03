import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, apiEnvelope } from './api';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('unwraps data and keeps meta', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { data: [{ id: 1 }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }),
    );
    const env = await apiEnvelope<{ id: number }[]>('/orders', { query: { page: 1, empty: '' } });
    expect(env.data).toEqual([{ id: 1 }]);
    expect(env.meta?.total).toBe(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/orders?page=1');
    expect(init?.credentials).toBe('include');
    expect((init?.headers as Record<string, string>)['X-Requested-With']).toBeUndefined();
  });

  it('sends X-Requested-With and JSON on mutations', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: { ok: true } }));
    await expect(
      api('/newsletter', { method: 'POST', body: { email: 'a@b.co' } }),
    ).resolves.toEqual({ ok: true });
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('vyra');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.co' }));
  });

  it('throws ApiError with code, message, status and field errors', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid input',
          details: { fieldErrors: { pincode: ['Enter a valid 6-digit PIN code'] }, formErrors: [] },
          requestId: 'r1',
        },
      }),
    );
    const err = await api('/users/me/addresses', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.message).toBe('Invalid input');
    expect(e.status).toBe(400);
    expect(e.fieldErrors).toEqual({ pincode: ['Enter a valid 6-digit PIN code'] });
  });

  it('refreshes once on 401 and retries the request', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'Expired' } }))
      .mockResolvedValueOnce(json(200, { data: { id: 'u1' } })) // POST /auth/refresh
      .mockResolvedValueOnce(json(200, { data: [{ id: 'o1' }] }));
    await expect(api('/orders')).resolves.toEqual([{ id: 'o1' }]);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/v1/orders',
      '/api/v1/auth/refresh',
      '/api/v1/orders',
    ]);
    expect(fetchMock.mock.calls[1]![1]!.method).toBe('POST');
  });

  it('gives up with UNAUTHORIZED when refresh fails (no loop)', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'Expired' } }))
      .mockResolvedValueOnce(json(401, { error: { code: 'UNAUTHORIZED', message: 'No session' } }));
    const err = (await api('/auth/me').catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not try to refresh for the login endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } }),
    );
    await expect(api('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Invalid credentials',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps non-JSON errors and network failures', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' }),
    );
    await expect(api('/home')).rejects.toMatchObject({ code: 'INTERNAL', status: 502 });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api('/home')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });
});
