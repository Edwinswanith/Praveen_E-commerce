'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@vyra/ui';

export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<typeof Input>, 'type'>
>((props, ref) => {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={show ? 'text' : 'password'} className="pr-10" {...props} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted hover:text-fg"
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
      >
        {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';
