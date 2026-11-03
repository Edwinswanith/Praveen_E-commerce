'use client';
import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, ChevronDown, Minus } from 'lucide-react';
import { cn } from '@vyra/ui';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  ({ className, invalid, children, ...props }, ref) => (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-10 w-full appearance-none rounded-md border border-border-strong bg-bg pl-3 pr-8 text-sm text-fg focus:border-fg focus:outline-none disabled:bg-surface',
          invalid && 'border-danger',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
    </div>
  ),
);
Select.displayName = 'Select';

export function Switch({ checked, onCheckedChange, id, disabled, label }: {
  checked: boolean; onCheckedChange: (v: boolean) => void; id?: string; disabled?: boolean; label?: string;
}) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-border-strong transition-colors data-[state=checked]:bg-fg disabled:opacity-50"
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ checked, onCheckedChange, label, disabled, id }: {
  checked: boolean | 'indeterminate'; onCheckedChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string;
}) {
  return (
    <CheckboxPrimitive.Root
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong bg-bg data-[state=checked]:border-fg data-[state=checked]:bg-fg data-[state=indeterminate]:border-fg data-[state=indeterminate]:bg-fg text-white"
    >
      <CheckboxPrimitive.Indicator>
        {checked === 'indeterminate' ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children, side = 'right', disabled }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'right' | 'bottom' | 'left'; disabled?: boolean }) {
  if (disabled) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={8} className="z-50 rounded-sm bg-fg px-2 py-1 text-xs font-medium text-white shadow-pop">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** Segmented pill control (used for small filter sets). */
export function Segmented<T extends string>({ value, onChange, options, label, size = 'md' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; label: string; size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-border bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-[7px] font-medium text-muted transition-colors hover:text-fg',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === o.value && 'bg-bg text-fg shadow-sm ring-1 ring-border',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
