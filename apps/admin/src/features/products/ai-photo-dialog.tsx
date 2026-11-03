'use client';
import * as React from 'react';
import { toast } from 'sonner';
import type { AiPhotoInput, ProductImageDto } from '@vyra/shared';
import { Alert, Button, Field, Textarea, cn } from '@vyra/ui';
import { Sparkles } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/controls';

const STYLES: { value: AiPhotoInput['style']; label: string; hint: string }[] = [
  { value: 'MODEL', label: 'On model', hint: 'Adult model, studio background (kids items use a ghost mannequin)' },
  { value: 'STUDIO', label: 'Ghost mannequin', hint: 'Clean e-commerce cut-out on light grey' },
  { value: 'FLATLAY', label: 'Flat-lay', hint: 'Top-down on a neutral surface' },
  { value: 'LIFESTYLE', label: 'Lifestyle', hint: 'Model in an Indian city setting, natural light' },
];

/**
 * "AI studio photo": turns a phone photo of the REAL garment into catalogue
 * photography with Gemini. Without a source photo it generates from product
 * data, which is only appropriate for drafts (the result may not match stock).
 */
export function AiPhotoDialog({ productId, images, colours, open, onOpenChange, onDone }: {
  productId: string; images: ProductImageDto[]; colours: string[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const realPhotos = images.filter((i) => !i.aiGenerated);
  const [source, setSource] = React.useState<string>('');
  const [style, setStyle] = React.useState<AiPhotoInput['style']>('MODEL');
  const [colour, setColour] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [count, setCount] = React.useState(1);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) setSource(realPhotos[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when opening
  }, [open]);

  const generate = async () => {
    setBusy(true);
    try {
      const body: Partial<AiPhotoInput> = { style, count, ...(source ? { sourceImageId: source } : {}), ...(colour ? { color: colour } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) };
      const created = await api.post<ProductImageDto[]>(`/admin/products/${productId}/images/generate`, body);
      toast.success(`${created.length} AI photo${created.length > 1 ? 's' : ''} added. Review before publishing.`);
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title="AI studio photo"
      description="Turn a phone photo of the actual garment into catalogue photography. Takes about 10 seconds per photo."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={() => void generate()} loading={busy}><Sparkles /> Generate {count > 1 ? `${count} photos` : 'photo'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Real garment photo" htmlFor="ai-source" hint="The AI keeps this exact garment and only changes the presentation.">
          {realPhotos.length ? (
            <div id="ai-source" role="radiogroup" aria-label="Real garment photo" className="flex gap-2 overflow-x-auto pb-1">
              {realPhotos.map((img) => (
                <button key={img.id} type="button" role="radio" aria-checked={source === img.id} onClick={() => setSource(img.id)}
                  className={cn('relative size-20 shrink-0 overflow-hidden rounded-md border-2', source === img.id ? 'border-brand-500' : 'border-transparent')}>
                  <img src={img.thumbUrl} alt={img.alt} className="size-full object-cover" />
                </button>
              ))}
              <button type="button" role="radio" aria-checked={source === ''} onClick={() => setSource('')}
                className={cn('flex size-20 shrink-0 items-center justify-center rounded-md border-2 bg-surface p-1 text-center text-[11px] text-muted', source === '' ? 'border-brand-500' : 'border-transparent')}>
                From product details
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted">No real photo uploaded yet. Upload a phone photo of the garment first for an accurate result.</p>
          )}
        </Field>
        {!source && (
          <Alert tone="warning" title="Generating without a real photo">
            The image is invented from the product details and may not match your actual garment. Use it only for drafts; customers return items that don&apos;t look like their photos.
          </Alert>
        )}
        <Field label="Style" htmlFor="ai-style" hint={STYLES.find((s) => s.value === style)?.hint}>
          <Select id="ai-style" value={style} onChange={(e) => setStyle(e.target.value as AiPhotoInput['style'])}>
            {STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Colour" htmlFor="ai-colour">
            <Select id="ai-colour" value={colour} onChange={(e) => setColour(e.target.value)}>
              <option value="">From the photo / first variant</option>
              {colours.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Photos" htmlFor="ai-count">
            <Select id="ai-count" value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
              <option value="1">1 (front)</option>
              <option value="2">2 (front + detail)</option>
            </Select>
          </Field>
        </div>
        <Field label="Direction (optional)" htmlFor="ai-notes" hint="e.g. 'tucked into beige chinos', 'show the side slit'">
          <Textarea id="ai-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />
        </Field>
        <p className="text-xs text-muted">AI photos are labelled &quot;AI-styled photo&quot; on the storefront.</p>
      </div>
    </Dialog>
  );
}
