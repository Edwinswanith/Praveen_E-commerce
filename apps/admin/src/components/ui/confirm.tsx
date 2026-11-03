'use client';
import * as React from 'react';
import { Button } from '@vyra/ui';
import { Dialog } from './dialog';

interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = React.createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = React.useCallback<ConfirmFn>((opts) => new Promise<boolean>((resolve) => setState({ ...opts, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={!!state}
        onOpenChange={(o) => { if (!o) close(false); }}
        title={state?.title ?? ''}
        description={state?.description}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => close(false)}>Cancel</Button>
            <Button variant={state?.destructive ? 'danger' : 'secondary'} size="sm" onClick={() => close(true)} autoFocus>
              {state?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{state?.destructive ? 'This action may not be reversible.' : 'Please confirm to continue.'}</p>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
