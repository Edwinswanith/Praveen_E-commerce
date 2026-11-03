'use client';
import useSWR, { type SWRConfiguration } from 'swr';
import type { PageMeta } from '@vyra/shared';
import { request, adminPath, type Query, type ApiEnvelope } from './api';

/** SWR key = admin path incl. query string. */
export const envelopeFetcher = <T,>(key: string) => request<T>(key);

/**
 * Reads an admin endpoint. Pass `null` as path to skip (e.g. missing permission).
 * Returns the unwrapped data plus pagination meta and extra envelope fields.
 */
export function useApi<T>(path: string | null, query?: Query, config?: SWRConfiguration<ApiEnvelope<T>>) {
  const key = path ? adminPath(path, query) : null;
  const swr = useSWR<ApiEnvelope<T>>(key, envelopeFetcher<T>, { keepPreviousData: true, ...config });
  return {
    data: swr.data?.data,
    meta: swr.data?.meta as PageMeta | undefined,
    extra: swr.data?.extra,
    error: swr.error as unknown,
    isLoading: swr.isLoading,
    isValidating: swr.isValidating,
    mutate: swr.mutate,
    key,
  };
}
