'use client';
import * as React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { SessionUser } from '@vyra/shared';
import { STAFF_ROLES } from '@vyra/shared';
import { VyraLogo, Spinner, Button, Alert } from '@vyra/ui';
import { ApiError, request, errorMessage } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';

interface AuthContextValue {
  user: SessionUser;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

type State = { status: 'loading' } | { status: 'ready'; user: SessionUser } | { status: 'error'; error: unknown };

/** Loads GET /admin/auth/me; redirects to /login when there is no staff session. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = React.useState<State>({ status: 'loading' });

  const load = React.useCallback(async () => {
    try {
      const { data } = await request<SessionUser>('/auth/me', { noRedirect: true });
      if (!STAFF_ROLES.includes(data.role)) throw new ApiError('FORBIDDEN', 'This account is not a staff account.', 403);
      setState({ status: 'ready', user: data });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        router.replace(`/login?next=${encodeURIComponent(pathname || '/')}`);
        return;
      }
      setState({ status: 'error', error: err });
    }
  }, [router, pathname]);

  React.useEffect(() => {
    void load();
    // Only on mount; pathname changes don't require re-auth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = React.useCallback(async () => {
    try {
      await request('/auth/logout', { method: 'POST', body: {}, noRedirect: true });
    } catch {
      /* session may already be gone */
    }
    window.location.assign('/login');
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface">
        <VyraLogo className="text-2xl" />
        <Spinner className="size-5 text-muted" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface p-4">
        <div className="w-full max-w-md space-y-4">
          <VyraLogo className="text-2xl" />
          <Alert tone="danger" title="Could not verify your session">{errorMessage(state.error)}</Alert>
          <Button onClick={() => { setState({ status: 'loading' }); void load(); }}>Try again</Button>
        </div>
      </div>
    );
  }

  const value: AuthContextValue = {
    user: state.user,
    can: (p) => hasPermission(state.user, p),
    refresh: load,
    logout,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthGate');
  return ctx;
}

/** Renders children only when the current staff user has the permission. */
export function Can({ perm, children, fallback = null }: { perm: string; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { can } = useAuth();
  return <>{can(perm) ? children : fallback}</>;
}
