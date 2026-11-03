'use client';
import * as React from 'react';
import Link from 'next/link';
import * as Tabs from '@radix-ui/react-tabs';
import { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import type { ScanMode, ScanResultDto } from '@vyra/shared';
import { normalizeScan } from '@vyra/shared';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, cn } from '@vyra/ui';
import { Camera, CameraOff, Keyboard, ScanLine, Volume2, VolumeX, ExternalLink, PackageSearch, PackagePlus, SlidersHorizontal, Truck, Undo2, CircleX, CircleCheck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/swr';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { formatINR, formatNumber, formatTime, formatDateTime, humanize } from '@/lib/format';
import type { ScanHistoryRow } from '@/lib/types';
import { PageHeader } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/controls';
import { DataTable } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { MovementForm, type ManualMovementType } from '@/features/inventory/movement-form';
import { HidScanBuffer } from './hid-buffer';
import { useGlobalHidScanner } from './use-hid-scanner';
import { CameraScanner } from './camera-scanner';
import { scanFeedback, unlockAudio } from './feedback';
import { DispatchPanel, OrderLookup } from './dispatch-panel';

type Device = 'CAMERA' | 'USB' | 'BLUETOOTH' | 'MANUAL';
type HidDevice = 'USB' | 'BLUETOOTH';

const MODES: { value: ScanMode; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { value: 'IDENTIFY', label: 'Identify', icon: PackageSearch, hint: 'Look up any item. Nothing is changed.' },
  { value: 'RECEIVE', label: 'Receive', icon: PackagePlus, hint: 'Scan received goods, then confirm quantity and reason to stock in.' },
  { value: 'ADJUST', label: 'Adjust', icon: SlidersHorizontal, hint: 'Correct stock after a count or damage. Confirm each change.' },
  { value: 'DISPATCH', label: 'Dispatch', icon: Truck, hint: 'Verify every item of an order before packing.' },
  { value: 'RETURN', label: 'Return', icon: Undo2, hint: 'Restock items returned by customers.' },
];

const MOVEMENT_FOR: Partial<Record<ScanMode, { types: ManualMovementType[]; defaultType: ManualMovementType; reason: string }>> = {
  RECEIVE: { types: ['STOCK_IN'], defaultType: 'STOCK_IN', reason: 'Goods received from supplier' },
  ADJUST: { types: ['ADJUSTMENT', 'STOCK_OUT'], defaultType: 'ADJUSTMENT', reason: '' },
  RETURN: { types: ['STOCK_IN'], defaultType: 'STOCK_IN', reason: 'Customer return restock' },
};

interface SessionEntry {
  id: string; at: string; code: string; mode: ScanMode; device: Device; found: boolean; label: string;
  status: 'ok' | 'not-found' | 'mismatch' | 'error'; detail?: string;
}

type Variant = NonNullable<ScanResultDto['variant']>;
interface Pending { scanId: string; variant: Variant; quantity: number; mode: ScanMode }

const HID_KEY = 'vyra.scanner.hidDevice';
const SOUND_KEY = 'vyra.scanner.sound';

export function ScannerScreen() {
  const { can } = useAuth();
  const { mutate: globalMutate } = useSWRConfig();
  const [mode, setMode] = React.useState<ScanMode>('IDENTIFY');
  const [cameraOn, setCameraOn] = React.useState(false);
  const [hidDevice, setHidDevice] = React.useState<HidDevice>('USB');
  const [sound, setSound] = React.useState(true);
  const [current, setCurrent] = React.useState<ScanResultDto | null>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [manualMove, setManualMove] = React.useState(false);
  const [session, setSession] = React.useState<SessionEntry[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [orderId, setOrderId] = React.useState<string | null>(null);
  const [mismatch, setMismatch] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'session' | 'server'>('session');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const queue = React.useRef<Promise<void>>(Promise.resolve());
  const inputBuffer = React.useRef(new HidScanBuffer());
  const stateRef = React.useRef({ mode, orderId, pending, sound, hidDevice });
  stateRef.current = { mode, orderId, pending, sound, hidDevice };
  const canWriteInventory = can(PERM.inventoryWrite);

  React.useEffect(() => {
    try {
      const d = localStorage.getItem(HID_KEY);
      if (d === 'USB' || d === 'BLUETOOTH') setHidDevice(d);
      setSound(localStorage.getItem(SOUND_KEY) !== '0');
    } catch { /* storage unavailable */ }
  }, []);

  const finePointer = React.useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches, []);
  const focusInput = React.useCallback(() => {
    // Avoid popping the on-screen keyboard on phones; HID scanners are still caught globally.
    if (finePointer) inputRef.current?.focus({ preventScroll: true });
  }, [finePointer]);
  React.useEffect(() => { focusInput(); }, [mode, focusInput]);

  const pushSession = (e: Omit<SessionEntry, 'id' | 'at'>) =>
    setSession((s) => [{ ...e, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString() }, ...s].slice(0, 200));

  const process = React.useCallback(async (raw: string, device: Device) => {
    const code = normalizeScan(raw);
    if (!code) return;
    const { mode: m, orderId: oid, pending: p, sound: snd } = stateRef.current;
    if (m === 'DISPATCH' && !oid) {
      scanFeedback('warn', snd);
      toast.warning('Load an order before scanning items for dispatch');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<ScanResultDto>('/scans', { code, mode: m, device, ...(m === 'DISPATCH' && oid ? { orderId: oid } : {}) });
      setCurrent(result);
      setManualMove(false);
      if (!result.found || !result.variant) {
        scanFeedback('error', snd);
        pushSession({ code, mode: m, device, found: false, label: 'Unknown code', status: 'not-found' });
        return;
      }
      const v = result.variant;
      const label = `${v.productName} · ${v.color}/${v.size}`;
      if (m === 'DISPATCH') {
        const d = result.dispatch;
        const ok = !!d?.matches && d.scanned <= d.expected;
        if (ok) {
          setMismatch(null);
          scanFeedback('ok', snd);
        } else {
          const msg = !d?.matches ? `${v.sku} (${label}) is not part of this order.` : `${v.sku} already scanned ${d.scanned} of ${d.expected}.`;
          setMismatch(msg);
          scanFeedback('error', snd);
        }
        pushSession({ code, mode: m, device, found: true, label, status: ok ? 'ok' : 'mismatch', detail: d ? `${d.scanned}/${d.expected}` : undefined });
        if (oid) void globalMutate(`/orders/${oid}`);
        return;
      }
      scanFeedback('ok', snd);
      pushSession({ code, mode: m, device, found: true, label, status: 'ok' });
      if (MOVEMENT_FOR[m]) {
        if (p && p.variant.id === v.id && p.mode === m && m !== 'ADJUST') {
          setPending({ ...p, quantity: p.quantity + 1, variant: v });
          toast.message(`${v.sku}: quantity ${p.quantity + 1}`, { duration: 1200 });
        } else {
          if (p) toast.message(`Previous unconfirmed scan (${p.variant.sku}) was discarded`);
          setPending({ scanId: result.scanId, variant: v, quantity: 1, mode: m });
        }
      } else {
        setPending(null);
      }
    } catch (err) {
      scanFeedback('error', snd);
      pushSession({ code, mode: m, device, found: false, label: errorMessage(err), status: 'error' });
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [globalMutate]);

  /** Serialises scans so rapid reads are processed in order. */
  const enqueue = React.useCallback((code: string, device: Device) => {
    queue.current = queue.current.then(() => process(code, device)).catch(() => undefined);
  }, [process]);

  useGlobalHidScanner((code) => enqueue(code, stateRef.current.hidDevice));

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const code = inputBuffer.current.push(e.key, performance.now());
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = (code ?? e.currentTarget.value).trim();
      e.currentTarget.value = '';
      if (value) enqueue(value, code ? stateRef.current.hidDevice : 'MANUAL');
    }
  };

  const changeMode = (m: ScanMode) => {
    setMode(m);
    setPending(null);
    setCurrent(null);
    setMismatch(null);
    setManualMove(false);
  };

  const modeInfo = MODES.find((x) => x.value === mode)!;
  const movement = MOVEMENT_FOR[mode];
  const v = current?.variant ?? null;

  return (
    <div onPointerDown={unlockAudio}>
      <PageHeader
        title="Scanner"
        description="Camera, USB/Bluetooth scanner or manual entry. Scans never change stock on their own."
        actions={
          <div className="flex items-center gap-2">
            <Segmented size="sm" label="HID scanner type" value={hidDevice} onChange={(d) => { setHidDevice(d); try { localStorage.setItem(HID_KEY, d); } catch { /* ignore */ } }}
              options={[{ value: 'USB', label: 'USB' }, { value: 'BLUETOOTH', label: 'Bluetooth' }]} />
            <Button variant="ghost" size="sm" aria-pressed={sound} onClick={() => { const s = !sound; setSound(s); try { localStorage.setItem(SOUND_KEY, s ? '1' : '0'); } catch { /* ignore */ } }} aria-label={sound ? 'Mute scan sounds' : 'Unmute scan sounds'}>
              {sound ? <Volume2 /> : <VolumeX />}
            </Button>
          </div>
        }
      />

      <Tabs.Root value={mode} onValueChange={(m) => changeMode(m as ScanMode)}>
        <Tabs.List aria-label="Scan mode" className="-mx-3 mb-4 flex gap-1 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
          {MODES.map((m) => (
            <Tabs.Trigger key={m.value} value={m.value}
              className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-bg px-3.5 py-2.5 text-sm font-semibold text-muted transition-colors hover:text-fg data-[state=active]:border-fg data-[state=active]:bg-fg data-[state=active]:text-white">
              <m.icon className="size-4" /> {m.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm text-muted">{modeInfo.hint}</p>
              {mode === 'DISPATCH' && !orderId && <OrderLookup onSelect={(id) => { setOrderId(id); setMismatch(null); }} autoFocus={finePointer} />}
              {(mode !== 'DISPATCH' || orderId) && (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <ScanLine aria-hidden className={cn('pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2', busy ? 'animate-pulse text-brand-500' : 'text-subtle')} />
                    <input
                      ref={inputRef}
                      aria-label="Scan or type a barcode / SKU, then press Enter"
                      placeholder="Scan or type barcode / SKU"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      enterKeyHint="search"
                      onKeyDown={onInputKeyDown}
                      onBlur={(e) => {
                        // Keep the HID input focused unless the user moved to another control.
                        if (!e.relatedTarget) setTimeout(focusInput, 150);
                      }}
                      className="h-12 w-full rounded-md border-2 border-border-strong bg-bg pl-11 pr-3 font-mono text-base tracking-wide placeholder:font-sans placeholder:tracking-normal placeholder:text-subtle focus:border-fg focus:outline-none"
                    />
                  </div>
                  <Button variant={cameraOn ? 'secondary' : 'outline'} className="h-12" onClick={() => setCameraOn((c) => !c)} aria-pressed={cameraOn} aria-label={cameraOn ? 'Hide camera' : 'Use camera'}>
                    {cameraOn ? <CameraOff /> : <Camera />}<span className="hidden sm:inline">{cameraOn ? 'Hide camera' : 'Camera'}</span>
                  </Button>
                </div>
              )}
              <p className="flex items-center gap-1.5 text-xs text-muted"><Keyboard className="size-3.5" /> USB/Bluetooth scanners work anywhere on this page. Manual entry: type and press Enter.</p>
              {cameraOn && (mode !== 'DISPATCH' || orderId) && <CameraScanner onDecode={(c) => enqueue(c, 'CAMERA')} paused={busy || (!!pending && mode === 'ADJUST')} />}
            </CardContent>
          </Card>

          {mode === 'DISPATCH' && orderId && (
            <DispatchPanel orderId={orderId} canPack={can(PERM.ordersWrite)} mismatch={mismatch} onClear={() => { setOrderId(null); setMismatch(null); setCurrent(null); }} />
          )}
        </div>

        <div className="space-y-4">
          {current && !current.found && (
            <Alert tone="danger" title="Code not recognised">
              <span className="font-mono">{current.code}</span> doesn&apos;t match any SKU or barcode. Check the label or try manual entry.
            </Alert>
          )}
          {v && (
            <VariantCard variant={v} symbology={current?.symbology ?? null} />
          )}
          {v && pending && movement && pending.variant.id === v.id && (
            canWriteInventory ? (
              <Card>
                <CardHeader><CardTitle>Confirm {mode === 'RECEIVE' ? 'stock in' : mode === 'RETURN' ? 'return restock' : 'adjustment'}</CardTitle><Badge tone="warning">Not saved yet</Badge></CardHeader>
                <CardContent>
                  <MovementForm
                    key={pending.scanId}
                    compact
                    variant={{ variantId: v.id, sku: v.sku, onHand: v.onHand, reserved: v.reserved, available: v.available }}
                    types={movement.types}
                    defaultType={movement.defaultType}
                    defaultReason={movement.reason}
                    defaultQuantity={pending.quantity}
                    scanId={pending.scanId}
                    onCancel={() => { setPending(null); focusInput(); }}
                    onDone={(row) => {
                      setCurrent((c) => (c?.variant ? { ...c, variant: { ...c.variant, onHand: row.onHand, reserved: row.reserved, available: row.available } } : c));
                      setPending(null);
                      scanFeedback('ok', sound);
                      focusInput();
                    }}
                  />
                </CardContent>
              </Card>
            ) : (
              <Alert tone="warning">Your role can look up items but not change stock.</Alert>
            )
          )}
          {v && mode === 'IDENTIFY' && canWriteInventory && (
            manualMove ? (
              <Card>
                <CardHeader><CardTitle>Record movement</CardTitle></CardHeader>
                <CardContent>
                  <MovementForm key={current?.scanId} compact scanId={current?.scanId}
                    variant={{ variantId: v.id, sku: v.sku, onHand: v.onHand, reserved: v.reserved, available: v.available }}
                    onCancel={() => setManualMove(false)}
                    onDone={(row) => { setCurrent((c) => (c?.variant ? { ...c, variant: { ...c.variant, onHand: row.onHand, reserved: row.reserved, available: row.available } } : c)); setManualMove(false); }} />
                </CardContent>
              </Card>
            ) : <Button variant="outline" onClick={() => setManualMove(true)}>Record a movement for this item</Button>
          )}
          {!current && (
            <Card className="flex flex-col items-center justify-center px-6 py-14 text-center">
              <ScanLine className="mb-3 size-8 text-subtle" aria-hidden />
              <p className="text-sm font-semibold">Ready to scan</p>
              <p className="mt-1 max-w-xs text-xs text-muted">Results appear here with on-hand, reserved and available stock.</p>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
              <Segmented size="sm" label="History source" value={view} onChange={setView} options={[{ value: 'session', label: `This session (${session.length})` }, { value: 'server', label: 'All scans' }]} />
            </CardHeader>
            {view === 'session' ? <SessionHistory entries={session} /> : <ServerHistory />}
          </Card>
        </div>
      </div>
    </div>
  );
}

function VariantCard({ variant: v, symbology }: { variant: Variant; symbology: string | null }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex gap-4 p-4">
        <span className="size-24 shrink-0 overflow-hidden rounded-md bg-surface-2 ring-1 ring-border sm:size-28">
          {v.imageUrl && <img src={v.imageUrl} alt="" className="size-full object-cover" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-snug">{v.productName}</p>
          <p className="mt-0.5 text-sm text-muted">{v.color} · Size <span className="font-semibold text-fg">{v.size}</span></p>
          <p className="mt-1 font-mono text-xs text-muted">{v.sku}{symbology ? ` · ${symbology}` : ''}</p>
          <p className="tabular mt-1 text-sm"><span className="font-semibold">{formatINR(v.price)}</span>{v.mrp > v.price && <span className="ml-1.5 text-xs text-muted line-through">{formatINR(v.mrp)}</span>}</p>
          <Link href={`/products/${v.productId}`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-fg">Open product <ExternalLink className="size-3" /></Link>
        </div>
      </div>
      <div className="grid grid-cols-3 border-t border-border text-center">
        {([['On hand', v.onHand, ''], ['Reserved', v.reserved, 'text-muted'], ['Available', v.available, v.available <= 0 ? 'text-danger' : 'text-success']] as const).map(([l, n, cls]) => (
          <div key={l} className="border-r border-border px-2 py-3 last:border-0">
            <p className="text-xs text-muted">{l}</p>
            <p className={cn('tabular text-2xl font-bold', cls)}>{formatNumber(n)}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SessionHistory({ entries }: { entries: SessionEntry[] }) {
  if (!entries.length) return <p className="px-5 py-6 text-center text-sm text-muted">No scans yet in this session.</p>;
  return (
    <ul className="max-h-96 divide-y divide-border overflow-y-auto">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
          {e.status === 'ok' ? <CircleCheck className="size-4 shrink-0 text-success" aria-label="OK" /> : <CircleX className="size-4 shrink-0 text-danger" aria-label={humanize(e.status)} />}
          <span className="min-w-0 flex-1">
            <span className="block truncate">{e.label}</span>
            <span className="block truncate font-mono text-xs text-muted">{e.code}</span>
          </span>
          <span className="shrink-0 text-right text-xs text-muted">
            <span className="block">{humanize(e.mode)}{e.detail ? ` · ${e.detail}` : ''}{e.status === 'mismatch' ? ' · mismatch' : ''}</span>
            <span className="tabular block">{formatTime(e.at)} · {humanize(e.device)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const serverCols: ColumnDef<ScanHistoryRow, unknown>[] = [
  { header: 'When', accessorKey: 'createdAt', cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted">{formatDateTime(row.original.createdAt)}</span> },
  { header: 'Code', accessorKey: 'code', cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span> },
  {
    header: 'Item', id: 'item',
    cell: ({ row: { original: r } }) => {
      const sku = r.sku ?? r.variant?.sku;
      const name = r.productName ?? r.variant?.productName;
      return r.found ? <span className="block max-w-48 truncate text-xs">{name ?? ''} <span className="font-mono text-muted">{sku ?? ''}</span></span> : <Badge tone="danger">Not found</Badge>;
    },
  },
  { header: 'Mode', accessorKey: 'mode', cell: ({ row }) => <span className="text-xs">{humanize(row.original.mode)}</span> },
  { header: 'By', accessorKey: 'actorName', cell: ({ row }) => <span className="text-xs text-muted">{row.original.actorName ?? '—'}</span> },
];

function ServerHistory() {
  const [page, setPage] = React.useState(1);
  const { data, meta, error, isLoading, mutate } = useApi<ScanHistoryRow[]>('/scans', { page, pageSize: 20 });
  return (
    <DataTable className="rounded-none border-0" columns={serverCols} data={data} isLoading={isLoading} error={error} onRetry={() => void mutate()} getRowId={(r) => r.id} dense
      empty={{ title: 'No scans recorded yet' }} footer={<Pagination meta={meta} onPageChange={setPage} />} />
  );
}
