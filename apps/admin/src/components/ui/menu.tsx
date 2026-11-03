'use client';
import * as React from 'react';
import * as M from '@radix-ui/react-dropdown-menu';
import { cn } from '@vyra/ui';

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ className, align = 'end', ...props }: M.DropdownMenuContentProps) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-44 rounded-md border border-border bg-bg p-1 shadow-pop', className)}
        {...props}
      />
    </M.Portal>
  );
}

export function MenuItem({ className, destructive, ...props }: M.DropdownMenuItemProps & { destructive?: boolean }) {
  return (
    <M.Item
      className={cn(
        'flex cursor-default select-none items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted',
        destructive && 'text-danger [&_svg]:text-danger',
        className,
      )}
      {...props}
    />
  );
}

export function MenuLabel({ className, ...props }: M.DropdownMenuLabelProps) {
  return <M.Label className={cn('px-2.5 py-1.5 text-xs text-muted', className)} {...props} />;
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-border" />;
}
