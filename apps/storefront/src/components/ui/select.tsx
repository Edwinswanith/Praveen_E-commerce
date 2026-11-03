import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@vyra/ui';

/** Native select styled to match Input (native = best mobile UX + accessibility). */
export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(({ className, invalid, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full appearance-none rounded-md border border-border-strong bg-bg pl-3 pr-9 text-sm text-fg focus:border-fg focus:outline-none',
        invalid && 'border-danger',
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
      aria-hidden
    />
  </div>
));
NativeSelect.displayName = 'NativeSelect';
