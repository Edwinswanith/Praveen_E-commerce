import { Sparkles } from 'lucide-react';
import type { SearchResponse } from '@vyra/shared';
import { cn } from '@vyra/ui';
import { describeInterpretation, isAiMode } from '@/lib/search';

export function Interpretation({
  interpretation,
  className,
}: {
  interpretation: SearchResponse['interpretation'] | null;
  className?: string;
}) {
  const text = describeInterpretation(interpretation);
  if (!text || !interpretation) return null;
  const ai = isAiMode(interpretation.mode);
  return (
    <p
      className={cn(
        'mb-3 flex items-start gap-2 rounded-md px-3 py-2 text-sm',
        ai ? 'bg-violet-500/10 text-violet-600' : 'bg-surface-2 text-muted',
        className,
      )}
    >
      {ai && <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <span>{text}</span>
    </p>
  );
}
