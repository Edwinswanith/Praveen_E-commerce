'use client';

import * as React from 'react';
import * as RD from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@vyra/ui';

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** Visually hide the title (still announced to screen readers). */
  hideTitle?: boolean;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
}

const overlay = (
  <RD.Overlay asChild forceMount>
    <motion.div
      className="fixed inset-0 z-50 bg-black/50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    />
  </RD.Overlay>
);

function Header({
  title,
  hideTitle,
  description,
}: Pick<BaseProps, 'title' | 'hideTitle' | 'description'>) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-border px-5 py-4',
        hideTitle && 'sr-only',
      )}
    >
      <div className="min-w-0">
        <RD.Title className="font-display text-base font-bold text-fg">{title}</RD.Title>
        {description && (
          <RD.Description className="mt-0.5 text-sm text-muted">{description}</RD.Description>
        )}
      </div>
      <RD.Close
        className="-m-1 rounded-full p-1 text-muted hover:bg-surface-2 hover:text-fg"
        aria-label="Close"
      >
        <X className="size-5" aria-hidden />
      </RD.Close>
    </div>
  );
}

/** Centered modal dialog (Radix for a11y/focus trap, framer-motion for the enter/exit). */
export function Modal({
  open,
  onOpenChange,
  title,
  hideTitle,
  description,
  children,
  className,
  footer,
  size = 'md',
}: BaseProps & { size?: 'sm' | 'md' | 'lg' | 'full' }) {
  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-3xl',
    full: 'max-w-none h-full rounded-none',
  } as const;
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RD.Portal forceMount>
            {overlay}
            <RD.Content
              asChild
              forceMount
              {...(description ? {} : { 'aria-describedby': undefined })}
            >
              <motion.div
                className={cn(
                  'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg bg-bg shadow-pop focus:outline-none',
                  widths[size],
                  size === 'full' && 'max-h-none w-screen',
                  className,
                )}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <Header title={title} hideTitle={hideTitle} description={description} />
                <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
                {footer && <div className="border-t border-border px-5 py-4">{footer}</div>}
              </motion.div>
            </RD.Content>
          </RD.Portal>
        )}
      </AnimatePresence>
    </RD.Root>
  );
}

/** Edge sheet: left/right drawer or mobile bottom sheet. */
export function Sheet({
  open,
  onOpenChange,
  title,
  hideTitle,
  description,
  children,
  className,
  footer,
  side = 'right',
}: BaseProps & { side?: 'left' | 'right' | 'bottom' }) {
  const pos = {
    left: 'inset-y-0 left-0 h-full w-[min(88vw,360px)]',
    right: 'inset-y-0 right-0 h-full w-[min(92vw,420px)]',
    bottom: 'inset-x-0 bottom-0 max-h-[88dvh] w-full rounded-t-xl',
  }[side];
  const offscreen =
    side === 'left' ? { x: '-100%' } : side === 'right' ? { x: '100%' } : { y: '100%' };
  const onscreen = side === 'bottom' ? { y: 0 } : { x: 0 };
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RD.Portal forceMount>
            {overlay}
            <RD.Content
              asChild
              forceMount
              {...(description ? {} : { 'aria-describedby': undefined })}
            >
              <motion.div
                className={cn(
                  'fixed z-50 flex flex-col bg-bg shadow-pop focus:outline-none',
                  pos,
                  className,
                )}
                initial={offscreen}
                animate={onscreen}
                exit={offscreen}
                transition={{ type: 'tween', duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              >
                {side === 'bottom' && (
                  <div
                    aria-hidden
                    className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong"
                  />
                )}
                <Header title={title} hideTitle={hideTitle} description={description} />
                <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
                {footer && (
                  <div className="border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    {footer}
                  </div>
                )}
              </motion.div>
            </RD.Content>
          </RD.Portal>
        )}
      </AnimatePresence>
    </RD.Root>
  );
}
