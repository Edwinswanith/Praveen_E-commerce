/** Audible + haptic feedback for scans (WebAudio; no asset files). */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, startOffset: number, duration: number, type: OscillatorType = 'sine', gain = 0.12) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ac.currentTime + startOffset;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export function scanFeedback(kind: 'ok' | 'warn' | 'error', enabled = true) {
  if (!enabled) return;
  try {
    if (kind === 'ok') tone(1760, 0, 0.09, 'square', 0.06);
    else if (kind === 'warn') { tone(880, 0, 0.12, 'triangle'); tone(660, 0.14, 0.14, 'triangle'); }
    else { tone(220, 0, 0.18, 'sawtooth', 0.1); tone(180, 0.22, 0.28, 'sawtooth', 0.1); }
  } catch {
    /* audio unavailable */
  }
  try {
    navigator.vibrate?.(kind === 'ok' ? 40 : kind === 'warn' ? [60, 60, 60] : [200, 80, 200, 80, 200]);
  } catch {
    /* vibration unavailable */
  }
}

/** Must be called from a user gesture once so iOS/Safari allows later beeps. */
export function unlockAudio() {
  audio();
}
