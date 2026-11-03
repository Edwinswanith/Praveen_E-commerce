'use client';

import * as React from 'react';
import useSWR, { useSWRConfig } from 'swr';
import type { LoginInput, RegisterInput, SessionUser } from '@vyra/shared';
import { api, ApiError } from '@/lib/api';

interface AuthContextValue {
  user: SessionUser | null;
  /** True until GET /auth/me has resolved at least once. */
  loading: boolean;
  login: (input: LoginInput) => Promise<SessionUser>;
  register: (input: RegisterInput) => Promise<SessionUser>;
  logout: () => Promise<void>;
  setUser: (u: SessionUser) => void;
  refresh: () => Promise<unknown>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export const ME_KEY = '/auth/me';

/** GET /auth/me, resolving to null (not an error) when anonymous. */
async function fetchMe(): Promise<SessionUser | null> {
  try {
    return await api<SessionUser>(ME_KEY);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
    throw e;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { mutate: globalMutate } = useSWRConfig();
  const { data, isLoading, mutate } = useSWR<SessionUser | null>(ME_KEY, fetchMe, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const afterSessionChange = React.useCallback(async () => {
    // Guest cart is merged server-side on login; refresh dependent data.
    await Promise.all([
      globalMutate('/cart'),
      globalMutate('/wishlist/ids'),
      globalMutate('/wishlist'),
    ]);
  }, [globalMutate]);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user: data ?? null,
      loading: isLoading && data === undefined,
      async login(input) {
        const u = await api<SessionUser>('/auth/login', { method: 'POST', body: input });
        await mutate(u, { revalidate: false });
        await afterSessionChange();
        return u;
      },
      async register(input) {
        const u = await api<SessionUser>('/auth/register', { method: 'POST', body: input });
        await mutate(u, { revalidate: false });
        await afterSessionChange();
        return u;
      },
      async logout() {
        try {
          await api('/auth/logout', { method: 'POST' });
        } finally {
          await mutate(null, { revalidate: false });
          await globalMutate(
            (key) =>
              typeof key === 'string' &&
              (key.startsWith('/orders') ||
                key.startsWith('/users') ||
                key.startsWith('/returns') ||
                key.startsWith('/wishlist')),
            undefined,
            { revalidate: false },
          );
          await globalMutate('/cart');
        }
      },
      setUser(u) {
        void mutate(u, { revalidate: false });
      },
      refresh: () => mutate(),
    }),
    [data, isLoading, mutate, afterSessionChange, globalMutate],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
