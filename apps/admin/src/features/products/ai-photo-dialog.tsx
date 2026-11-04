'use client';
import * as React from 'react';
import { toast } from 'sonner';
import type { AiPhotoPreviewDto, AiPhotoPreviewInput, AiPhotoStyle, ProductImageDto } from '@vyra/shared';
import { Alert, Button, Field, Spinner, Textarea, cn } from '@vyra/ui';
import { Check, ImagePlus, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/controls';

const MAX_IMAGE_MB = 10;
/** Border share that must be near-white before we call a background "white" (marketplace main image). */
const WHITE_OK = 0.9;

const STYLES: { value: AiPhotoStyle; label: string; hint: string }[] = [
  { value: 'MARKETPLACE', label: 'Marketplace (pure white)', hint: 'Main listing image: product only on pure white, filling the frame (Amazon/Flipkart style)' },
  { value: 'STUDIO', label: 'Ghost mannequin (light grey)', hint: 'Clean e-commerce cut-out on light grey' },
  { value: 'MODEL', label: 'On model', hint: 'Adult model, studio background (kids items use a ghost mannequin)' },
  { value: 'FLATLAY', label: 'Flat-lay', hint: 'Top-down on a neutral surface' },
  { value: 'LIFESTYLE', label: 'Lifestyle', hint: 'Model in an Indian city setting, natural light' },
];

type Step = 'setup' | 'generating' | 'review' | 'saving';

/**
 * "AI studio photo": the staff member uploads (or picks) a real photo of the
 * garment, Gemini restyles the presentation using that photo as the reference,
 * and the result is shown NEXT TO the original for review. Nothing is added to
 * the product until "Use this photo"; the original photo is never changed.
 */
export function AiPhotoDialog({ productId, images, colours, open, onOpenChange, onDone, live = false, initialSourceId }: {
  productId: string; images: ProductImageDto[]; colours: string[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void;
  /** ACTIVE product: AI photos must come from a real photo (CLAUDE.md rule 15). */
  live?: boolean;
  initialSourceId?: string;
}) {
  const [uploaded, setUploaded] = React.useState<ProductImageDto[]>([]);
  const realPhotos = React.useMemo(() => {
    const seen = new Set(images.map((i) => i.id));
    return [...images, ...uploaded.filter((u) => !seen.has(u.id))].filter((i) => !i.aiGenerated);
  }, [images, uploaded]);
  const [source, setSource] = React.useState('');
  const [style, setStyle] = React.useState<AiPhotoStyle>('MARKETPLACE');
  const [colour, setColour] = React.useState('');
  const [angle, setAngle] = React.useState<AiPhotoPreviewInput['angle']>('front');
  const [notes, setNotes] = React.useState('');
  const [step, setStep] = React.useState<Step>('setup');
  const [uploading, setUploading] = React.useState(false);
  const [preview, setPreview] = React.useState<AiPhotoPreviewDto | null>(null);
  const [primary, setPrimary] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const previewRef = React.useRef<AiPhotoPreviewDto | null>(null);
  previewRef.current = preview;

  React.useEffect(() => {
    if (!open) return;
    setStep('setup');
    setPreview(null);
    setError(null);
    setUploaded([]);
    setSource(initialSourceId ?? images.find((i) => !i.aiGenerated)?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when opening
  }, [open]);

  /** "Keep original": drop the server-side preview. Best effort; it also expires on its own. */
  const discard = React.useCallback((p: AiPhotoPreviewDto | null) => {
    if (p) void api.delete(`/products/${productId}/images/ai-previews/${p.previewId}`).catch(() => undefined);
  }, [productId]);

  const busy = step === 'generating' || step === 'saving' || uploading;
  const close = () => {
    if (busy) return;
    discard(previewRef.current);
    setPreview(null);
    onOpenChange(false);
  };

  const uploadOriginal = async (files: FileList | null) => {
    const f = files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    if (f.size > MAX_IMAGE_MB * 1024 * 1024) { setError(`${f.name} is larger than ${MAX_IMAGE_MB} MB`); return; }
    const form = new FormData();
    form.append('files', f);
    if (colour) form.append('color', colour);
    setUploading(true);
    setError(null);
    try {
      const [img] = await api.upload<ProductImageDto[]>(`/products/${productId}/images`, form);
      if (img) {
        setUploaded((u) => [...u, img]);
        setSource(img.id);
      }
      onDone(); // the original is a normal product photo from now on
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const generate = async () => {
    const previous = previewRef.current;
    setStep('generating');
    setError(null);
    try {
      const body: Partial<AiPhotoPreviewInput> = { style, angle, ...(source ? { sourceImageId: source } : {}), ...(colour ? { color: colour } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) };
      const p = await api.post<AiPhotoPreviewDto>(`/products/${productId}/images/ai-previews`, body);
      discard(previous); // regenerate replaces the one on screen
      setPreview(p);
      setPrimary(style === 'MARKETPLACE');
      setStep('review');
    } catch (e) {
      setError(errorMessage(e));
      setStep(previous ? 'review' : 'setup');
    }
  };

  const accept = async () => {
    if (!preview) return;
    setStep('saving');
    setError(null);
    try {
      await api.post<ProductImageDto>(`/products/${productId}/images/ai-previews/${preview.previewId}/accept`, { placement: primary ? 'PRIMARY' : 'END' });
      toast.success(primary ? 'AI photo added as the main image. The original is kept.' : 'AI photo added. The original is kept.');
      setPreview(null);
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
      setStep('review');
    }
  };

  const keepOriginal = () => {
    discard(preview);
    setPreview(null);
    toast.message('Kept the original photo. Nothing was added.');
    onOpenChange(false);
  };

  const sourceImg = realPhotos.find((i) => i.id === source);
  const footer = step === 'review' || step === 'saving' ? (
    <>
      <Button type="button" variant="ghost" onClick={keepOriginal} disabled={busy}>Keep original</Button>
      <Button type="button" variant="outline" onClick={() => void generate()} disabled={busy}><RefreshCw /> Regenerate</Button>
      <Button type="button" onClick={() => void accept()} loading={step === 'saving'}><Check /> Use this photo</Button>
    </>
  ) : (
    <>
      <Button type="button" variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
      <Button type="button" onClick={() => void generate()} loading={step === 'generating'} disabled={uploading || (live && !source)}><Sparkles /> Generate preview</Button>
    </>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title="AI studio photo"
      description={step === 'review' || step === 'saving' ? 'Compare with your original. Nothing is saved until you choose “Use this photo”.' : 'Upload a phone photo of the actual product; the AI keeps the product and improves the background, lighting and framing.'}
      size={step === 'review' || step === 'saving' ? 'xl' : 'lg'}
      modalLock
      footer={footer}
    >
      <div className="space-y-4">
        {error && <Alert tone="danger" title="Something went wrong">{error}</Alert>}

        {step === 'generating' && (
          <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-10 text-center">
            <Spinner />
            <p className="text-sm font-medium text-fg">Generating your product photo…</p>
            <p className="text-xs text-muted">Usually 10–30 seconds. The original photo is not changed.</p>
          </div>
        )}

        {(step === 'review' || step === 'saving') && preview && (
          <ReviewPanel preview={preview} sourceImg={sourceImg} primary={primary} setPrimary={setPrimary} disabled={busy} onAdjust={() => setStep('setup')} />
        )}

        {step === 'setup' && (
          <>
            <Field label="Original product photo" htmlFor="ai-source" hint="The AI reproduces exactly this product and only changes the presentation.">
              <div id="ai-source" role="radiogroup" aria-label="Original product photo" className="flex gap-2 overflow-x-auto pb-1">
                {realPhotos.map((img) => (
                  <button key={img.id} type="button" role="radio" aria-checked={source === img.id} aria-label={`Use photo: ${img.alt || 'product photo'}`} onClick={() => setSource(img.id)}
                    className={cn('relative size-20 shrink-0 overflow-hidden rounded-md border-2', source === img.id ? 'border-brand-500' : 'border-transparent')}>
                    <img src={img.thumbUrl} alt={img.alt} className="size-full object-cover" />
                  </button>
                ))}
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="flex size-20 shrink-0 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border bg-surface p-1 text-center text-[11px] text-muted hover:border-brand-500 hover:text-fg">
                  {uploading ? <Spinner /> : <ImagePlus className="size-5" aria-hidden />}
                  {uploading ? 'Uploading…' : 'Upload photo'}
                </button>
                {!live && (
                  <button type="button" role="radio" aria-checked={source === ''} onClick={() => setSource('')}
                    className={cn('flex size-20 shrink-0 items-center justify-center rounded-md border-2 bg-surface p-1 text-center text-[11px] text-muted', source === '' ? 'border-brand-500' : 'border-transparent')}>
                    From product details
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" aria-label="Upload original product photo" onChange={(e) => void uploadOriginal(e.target.files)} />
            </Field>
            {live && !source && (
              <Alert tone="info" title="Upload a real photo first">This product is live, so its AI photos must be made from a real photo of the garment.</Alert>
            )}
            {!live && !source && (
              <Alert tone="warning" title="Generating without a real photo">
                The image is invented from the product details and may not match your actual garment. Use it only for drafts; customers return items that don&apos;t look like their photos.
              </Alert>
            )}
            <Field label="Style" htmlFor="ai-style" hint={STYLES.find((s) => s.value === style)?.hint}>
              <Select id="ai-style" value={style} onChange={(e) => setStyle(e.target.value as AiPhotoStyle)}>
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
              <Field label="Shot" htmlFor="ai-angle">
                <Select id="ai-angle" value={angle} onChange={(e) => setAngle(e.target.value as AiPhotoPreviewInput['angle'])}>
                  <option value="front">Front</option>
                  <option value="detail">Close-up detail</option>
                </Select>
              </Field>
            </div>
            <Field label="Direction (optional)" htmlFor="ai-notes" hint="e.g. 'show the side slit', 'softer shadow'">
              <Textarea id="ai-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />
            </Field>
            <p className="text-xs text-muted">AI photos are labelled &quot;AI-styled photo&quot; on the storefront. Each preview is a paid generation.</p>
          </>
        )}
      </div>
    </Dialog>
  );
}

function ReviewPanel({ preview, sourceImg, primary, setPrimary, disabled, onAdjust }: {
  preview: AiPhotoPreviewDto; sourceImg: ProductImageDto | undefined; primary: boolean; setPrimary: (v: boolean) => void; disabled: boolean; onAdjust: () => void;
}) {
  const original = preview.source ?? (sourceImg ? { url: sourceImg.url, width: sourceImg.width, height: sourceImg.height } : null);
  const white = preview.edgeWhiteRatio >= WHITE_OK;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <figure className="space-y-1.5">
          <div className="aspect-[4/5] overflow-hidden rounded-md border border-border bg-surface">
            {original ? <img src={original.url} alt="Original photo" className="size-full object-contain" /> : <div className="flex size-full items-center justify-center p-4 text-center text-xs text-muted">Generated from product details (no original photo)</div>}
          </div>
          <figcaption className="text-xs text-muted">Original{original?.width ? ` · ${original.width}×${original.height}` : ''} · unchanged</figcaption>
        </figure>
        <figure className="space-y-1.5">
          <div className="aspect-[4/5] overflow-hidden rounded-md border-2 border-brand-500 bg-white">
            <img src={preview.dataUrl} alt="AI-generated preview" className="size-full object-contain" />
          </div>
          <figcaption className="text-xs text-muted">AI preview · {preview.width}×{preview.height} · {Math.round(preview.bytes / 1024)} KB WebP</figcaption>
        </figure>
      </div>
      <ul className="space-y-1 text-sm">
        <li className="flex items-center gap-2">
          {white ? <Check className="size-4 text-success" aria-hidden /> : <TriangleAlert className="size-4 text-warning" aria-hidden />}
          {white ? 'White background: suitable as a marketplace main image' : `Background is not pure white (${Math.round(preview.edgeWhiteRatio * 100)}% of the edge). Fine for gallery images; regenerate with “Marketplace” for a main image.`}
        </li>
        <li className="text-xs text-muted">Check the colour, print, neckline, buttons and length against the original before using it. Customers return items that don&apos;t match their photos.</li>
      </ul>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={primary} disabled={disabled} onChange={(e) => setPrimary(e.target.checked)} className="size-4 accent-brand-500" />
        Make it the main image (shown on product cards and search)
      </label>
      <button type="button" onClick={onAdjust} disabled={disabled} className="text-xs font-medium text-brand-600 underline-offset-2 hover:underline">Adjust style or direction</button>
    </div>
  );
}
