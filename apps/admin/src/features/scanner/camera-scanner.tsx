'use client';
import * as React from 'react';
import type { IScannerControls } from '@zxing/browser';
import { Button, Spinner, cn } from '@vyra/ui';
import { Camera, CameraOff, Flashlight, FlashlightOff, SwitchCamera } from 'lucide-react';
import { Select } from '@/components/ui/controls';
import { createDuplicateFilter } from './hid-buffer';

type CamState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running' }
  | { kind: 'error'; reason: 'permission' | 'no-camera' | 'insecure' | 'in-use' | 'unknown'; message: string };

const ERROR_COPY: Record<'permission' | 'no-camera' | 'insecure' | 'in-use' | 'unknown', { title: string; body: string }> = {
  permission: { title: 'Camera permission denied', body: 'Allow camera access for this site in your browser settings, then try again. You can still use a USB/Bluetooth scanner or type the code.' },
  'no-camera': { title: 'No camera found', body: 'This device has no usable camera. Use a USB/Bluetooth scanner or enter the code manually.' },
  insecure: { title: 'Camera needs HTTPS', body: 'Browsers only allow camera access on secure (https://) pages or localhost.' },
  'in-use': { title: 'Camera is busy', body: 'Another app or tab is using the camera. Close it and try again.' },
  unknown: { title: 'Could not start the camera', body: 'Try again, or use a scanner / manual entry.' },
};

function classify(err: unknown): CamState {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);
  if (name === 'NotAllowedError' || name === 'SecurityError') return { kind: 'error', reason: 'permission', message };
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return { kind: 'error', reason: 'no-camera', message };
  if (name === 'NotReadableError' || name === 'TrackStartError') return { kind: 'error', reason: 'in-use', message };
  return { kind: 'error', reason: 'unknown', message };
}

/**
 * Live camera barcode reader using @zxing/browser BrowserMultiFormatReader.
 * Prefers the rear (environment) camera; exposes torch when the track supports it;
 * suppresses duplicate reads of the same code for 2 seconds.
 */
export function CameraScanner({ onDecode, paused }: { onDecode: (code: string) => void; paused?: boolean }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const controlsRef = React.useRef<IScannerControls | null>(null);
  const [state, setState] = React.useState<CamState>({ kind: 'idle' });
  const [torchOn, setTorchOn] = React.useState(false);
  const [torchAvailable, setTorchAvailable] = React.useState(false);
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = React.useState<string>('');
  const onDecodeRef = React.useRef(onDecode);
  onDecodeRef.current = onDecode;
  const pausedRef = React.useRef(paused);
  pausedRef.current = paused;
  const accept = React.useMemo(() => createDuplicateFilter(2000), []);

  const stop = React.useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setTorchOn(false);
    setTorchAvailable(false);
  }, []);

  const start = React.useCallback(async (preferredDeviceId?: string) => {
    stop();
    if (typeof window !== 'undefined' && !window.isSecureContext) { setState({ kind: 'error', reason: 'insecure', message: '' }); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setState({ kind: 'error', reason: 'no-camera', message: 'mediaDevices unavailable' }); return; }
    setState({ kind: 'starting' });
    try {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
      const hints = new Map<import('@zxing/library').DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 400 });
      const video: MediaTrackConstraints = preferredDeviceId
        ? { deviceId: { exact: preferredDeviceId } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
      const el = videoRef.current;
      if (!el) return;
      const controls = await reader.decodeFromConstraints({ audio: false, video }, el, (result) => {
        if (!result || pausedRef.current) return;
        const text = result.getText();
        if (accept(text, Date.now())) onDecodeRef.current(text);
      });
      controlsRef.current = controls;
      setTorchAvailable(typeof controls.switchTorch === 'function');
      setState({ kind: 'running' });
      try {
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        setDevices(list);
        const track = (el.srcObject as MediaStream | null)?.getVideoTracks()[0];
        const activeId = track?.getSettings().deviceId;
        if (activeId) setDeviceId(activeId);
      } catch {
        /* device list optional */
      }
    } catch (err) {
      stop();
      setState(classify(err));
    }
  }, [accept, stop]);

  React.useEffect(() => () => stop(), [stop]);

  const toggleTorch = async () => {
    const c = controlsRef.current;
    if (!c?.switchTorch) return;
    try {
      await c.switchTorch(!torchOn);
      setTorchOn(!torchOn);
    } catch {
      setTorchAvailable(false);
    }
  };

  const running = state.kind === 'running';
  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-neutral-900 sm:aspect-video" style={{ ['--scan-h' as string]: '100%' }}>
        <video ref={videoRef} className={cn('size-full object-cover', !running && 'invisible')} muted playsInline autoPlay aria-label="Camera preview" />
        {running && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className={cn('relative h-2/5 w-4/5 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]', paused && 'border-white/30')}>
              {!paused && <div className="animate-scan-line absolute inset-x-2 top-0 h-0.5 bg-brand-400 shadow-[0_0_8px_rgb(255_63_108)]" style={{ ['--scan-h' as string]: '100%' }} />}
            </div>
          </div>
        )}
        {running && paused && <p className="absolute inset-x-0 bottom-3 text-center text-xs font-medium text-white/80">Paused — confirm or dismiss the current item</p>}
        {state.kind === 'idle' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-white">
            <Camera className="size-8 text-white/70" aria-hidden />
            <Button variant="primary" onClick={() => void start()}>Start camera</Button>
            <p className="max-w-xs text-xs text-white/60">Point the rear camera at a barcode or QR code.</p>
          </div>
        )}
        {state.kind === 'starting' && <div className="absolute inset-0 flex items-center justify-center text-white"><Spinner className="size-6" /></div>}
        {state.kind === 'error' && (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-5 text-center text-white">
            <CameraOff className="size-7 text-white/70" aria-hidden />
            <p className="font-semibold">{ERROR_COPY[state.reason].title}</p>
            <p className="max-w-sm text-xs text-white/70">{ERROR_COPY[state.reason].body}</p>
            {state.reason !== 'insecure' && state.reason !== 'no-camera' && <Button size="sm" variant="outline" className="mt-2" onClick={() => void start(deviceId || undefined)}>Try again</Button>}
          </div>
        )}
      </div>
      {running && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => { stop(); setState({ kind: 'idle' }); }}><CameraOff /> Stop</Button>
          {torchAvailable && <Button size="sm" variant="outline" onClick={() => void toggleTorch()} aria-pressed={torchOn}>{torchOn ? <FlashlightOff /> : <Flashlight />} Torch</Button>}
          {devices.length > 1 && (
            <div className="flex items-center gap-1.5">
              <SwitchCamera className="size-4 text-muted" aria-hidden />
              <Select aria-label="Camera" value={deviceId} onChange={(e) => { setDeviceId(e.target.value); void start(e.target.value); }} className="w-48">
                {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
              </Select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
