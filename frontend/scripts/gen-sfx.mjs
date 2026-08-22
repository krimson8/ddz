// Procedural SFX generator for the DDZ frontend.
// Writes 16-bit mono PCM WAVs straight into frontend/public/sounds/.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SR = 44100;
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

// ── DSP toolkit ──────────────────────────────────────────────────────────────
const buf = (sec) => new Float32Array(Math.round(sec * SR));
const T = (i) => i / SR;

// Deterministic PRNG so regenerating gives byte-identical files.
let seed = 0x2f6e2b1;
function rnd() {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return (seed / 0xffffffff) * 2 - 1;
}

/** Exponential decay envelope with a short linear attack. */
function ad(t, attack, decay, curve = 4) {
  if (t < attack) return t / attack;
  const x = (t - attack) / decay;
  return x >= 1 ? 0 : Math.exp(-curve * x) * (1 - x);
}

/** Chamberlin state-variable filter — stable under fast cutoff modulation. */
function makeSVF(q = 1.0) {
  let low = 0, band = 0;
  return (x, fc) => {
    const f = 2 * Math.sin((Math.PI * Math.min(fc, SR * 0.22)) / SR);
    const high = x - low - q * band;
    band += f * high;
    low += f * band;
    return { low, band, high };
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const softClip = (x) => Math.tanh(x * 1.5);

/** FM bell voice: sine carrier, sine modulator, index decays with the envelope. */
function bell(out, start, freq, dur, amp, ratio = 3.5, index = 6) {
  const s = Math.round(start * SR);
  const n = Math.round(dur * SR);
  for (let i = 0; i < n && s + i < out.length; i++) {
    const t = T(i);
    const e = ad(t, 0.002, dur, 3.5);
    const mod = Math.sin(2 * Math.PI * freq * ratio * t) * index * e;
    out[s + i] += Math.sin(2 * Math.PI * freq * t + mod) * e * amp;
  }
}

/** Inharmonic struck-metal voice (gong / cymbal). */
function gong(out, start, freq, dur, amp) {
  const partials = [1, 2.32, 3.44, 4.07, 5.31, 6.72, 8.11, 9.87];
  const s = Math.round(start * SR);
  const n = Math.round(dur * SR);
  for (let i = 0; i < n && s + i < out.length; i++) {
    const t = T(i);
    let v = 0;
    for (let p = 0; p < partials.length; p++) {
      const f = freq * partials[p];
      // Higher partials die away faster, which is what makes metal sound like metal.
      const d = dur / (1 + p * 0.55);
      const e = ad(t, 0.001, d, 3);
      v += Math.sin(2 * Math.PI * f * t + p) * e / (1 + p * 0.8);
    }
    // Strike transient: a sliver of noise at the very start.
    if (t < 0.03) v += rnd() * (1 - t / 0.03) * 0.5;
    out[s + i] += v * amp * 0.5;
  }
}

/** One card flicking off the deck: bandpassed noise burst. */
function flick(out, start, amp, bright = 1) {
  const s = Math.round(start * SR);
  const dur = 0.055;
  const n = Math.round(dur * SR);
  const svf = makeSVF(0.9);
  for (let i = 0; i < n && s + i < out.length; i++) {
    const t = T(i);
    const e = ad(t, 0.0008, dur, 7);
    const fc = lerp(5200 * bright, 1400 * bright, t / dur);
    const y = svf(rnd(), fc);
    out[s + i] += (y.band * 1.4 + y.high * 0.3) * e * amp;
  }
}

/** Noise-based explosion body with a cutoff that collapses downward. */
function boom(out, start, dur, amp, subFrom = 95, subTo = 32) {
  const s = Math.round(start * SR);
  const n = Math.round(dur * SR);
  const svf = makeSVF(0.7);
  let subPhase = 0;
  for (let i = 0; i < n && s + i < out.length; i++) {
    const t = T(i);
    const p = t / dur;
    const e = Math.exp(-3.2 * p) * (1 - p);
    const fc = lerp(7000, 180, Math.pow(p, 0.35));
    const y = svf(rnd(), fc);
    const subF = lerp(subFrom, subTo, Math.pow(p, 0.5));
    subPhase += (2 * Math.PI * subF) / SR;
    const sub = Math.sin(subPhase) * Math.exp(-2.4 * p);
    out[s + i] += softClip(y.low * 2.2 * e + sub * 0.9) * amp;
  }
}

/** Cheap Schroeder-ish tail so stings do not sound bone dry. */
function reverb(sig, mix = 0.3, decay = 0.42) {
  const combs = [1231, 1583, 1867, 2129];
  const out = Float32Array.from(sig);
  for (const d of combs) {
    const line = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < out.length; i++) {
      const wet = line[idx];
      line[idx] = sig[i] + wet * decay;
      idx = (idx + 1) % d;
      out[i] += wet * (mix / combs.length);
    }
  }
  return out;
}

function normalize(sig, peak = 0.89) {
  let max = 0;
  for (const v of sig) max = Math.max(max, Math.abs(v));
  if (max < 1e-9) return sig;
  const g = peak / max;
  for (let i = 0; i < sig.length; i++) sig[i] *= g;
  return sig;
}

/** Half a millisecond in, 12ms out. The in-ramp has to stay this short or it
 *  swallows the attack transient that gives percussive hits their impact. */
function fade(sig) {
  const a = Math.round(0.0005 * SR), b = Math.round(0.012 * SR);
  for (let i = 0; i < a; i++) sig[i] *= i / a;
  for (let i = 0; i < b; i++) sig[sig.length - 1 - i] *= i / b;
  return sig;
}

function writeWav(name, sig) {
  // Fade first, normalize second — otherwise the ramps pull the peak back down.
  fade(sig);
  normalize(sig);
  const n = sig.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);   // PCM
  b.writeUInt16LE(1, 22);   // mono
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, sig[i]));
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(join(OUT, name), b);
  console.log('  ' + name + '  ' + (b.length / 1024).toFixed(0) + ' KB  ' + (n / SR).toFixed(2) + 's');
}

console.log('generating:');

// ── deal — a riffle of cards flicking off the deck ───────────────────────────
{
  const out = buf(1.05);
  let t = 0.01;
  for (let i = 0; i < 17; i++) {
    // Spacing tightens through the middle of the riffle, then eases out.
    const p = i / 16;
    const gap = lerp(0.075, 0.032, Math.sin(p * Math.PI));
    flick(out, t, 0.55 + Math.abs(rnd()) * 0.35, 0.85 + Math.abs(rnd()) * 0.4);
    t += gap;
  }
  writeWav('deal.wav', out);
}

// ── pass — a soft downward whoosh for 不出 ────────────────────────────────────
{
  const out = buf(0.4);
  const dur = 0.28;
  const svf = makeSVF(1.3);
  let ph = 0;
  for (let i = 0; i < Math.round(dur * SR); i++) {
    const t = T(i), p = t / dur;
    const e = Math.sin(Math.PI * Math.pow(p, 0.7)) * (1 - p * 0.3);
    const fc = lerp(1900, 380, Math.pow(p, 0.6));
    const y = svf(rnd(), fc);
    ph += (2 * Math.PI * lerp(230, 120, p)) / SR;
    out[i] = y.band * 1.5 * e + Math.sin(ph) * e * 0.22;
  }
  writeWav('pass.wav', out);
}

// ── landlord — gong + rising fanfare for the 地主 reveal ──────────────────────
{
  const out = buf(2.2);
  gong(out, 0, 196, 1.9, 0.85);
  bell(out, 0.10, 392, 0.9, 0.30, 2.0, 3);
  bell(out, 0.22, 523.25, 0.9, 0.30, 2.0, 3);
  bell(out, 0.34, 659.25, 1.3, 0.34, 2.0, 3.5);
  writeWav('landlord.wav', reverb(out, 0.35, 0.45));
}

// ── win — ascending bell arpeggio ────────────────────────────────────────────
{
  const out = buf(2.0);
  const notes = [523.25, 659.25, 783.99, 1046.5];  // C5 E5 G5 C6
  notes.forEach((f, i) => bell(out, i * 0.105, f, 1.0 + i * 0.25, 0.55, 3.0, 5));
  bell(out, 0.42, 1567.98, 1.1, 0.22, 4.5, 3);     // sparkle on top
  writeWav('win.wav', reverb(out, 0.42, 0.5));
}

// ── lose — descending detuned minor, ending on a dull thud ───────────────────
{
  const out = buf(1.8);
  const notes = [440, 349.23, 261.63];             // A4 F4 C4
  notes.forEach((f, i) => {
    const s = i * 0.16, dur = 0.85 + i * 0.3;
    const n0 = Math.round(s * SR), n = Math.round(dur * SR);
    const svf = makeSVF(1.1);
    for (let k = 0; k < n && n0 + k < out.length; k++) {
      const t = T(k);
      const e = ad(t, 0.012, dur, 3);
      // Two saws a few cents apart — the beating is what makes it sound sour.
      const saw = (ff) => 2 * ((ff * t) % 1) - 1;
      const raw = saw(f) * 0.5 + saw(f * 1.006) * 0.5;
      out[n0 + k] += svf(raw, lerp(1500, 420, t / dur)).low * e * 0.5;
    }
  });
  boom(out, 0.55, 0.9, 0.32, 70, 28);
  writeWav('lose.wav', reverb(out, 0.25, 0.4));
}

// ── bomb — 炸彈 ──────────────────────────────────────────────────────────────
{
  const out = buf(1.5);
  // Crack first, then the body, so it reads as an impact rather than a rumble.
  const svf = makeSVF(0.8);
  for (let i = 0; i < Math.round(0.09 * SR); i++) {
    const t = T(i);
    out[i] += svf(rnd(), lerp(9000, 2500, t / 0.09)).high * ad(t, 0.0004, 0.09, 8) * 0.7;
  }
  boom(out, 0.004, 1.25, 1.0, 110, 30);
  writeWav('bomb.wav', reverb(out, 0.22, 0.4));
}

// ── rocket — 火箭: a rising whistle into a detonation ─────────────────────────
{
  const out = buf(2.1);
  const rise = 0.62;
  const svf = makeSVF(2.6);
  let ph = 0;
  for (let i = 0; i < Math.round(rise * SR); i++) {
    const t = T(i), p = t / rise;
    const e = Math.pow(p, 1.4) * 0.85;
    const f = lerp(420, 3400, Math.pow(p, 1.9));
    ph += (2 * Math.PI * f) / SR;
    out[i] += Math.sin(ph) * e * 0.42 + svf(rnd(), f * 1.15).band * e * 0.55;
  }
  boom(out, rise, 1.35, 1.0, 130, 34);
  gong(out, rise + 0.02, 320, 1.1, 0.25);
  writeWav('rocket.wav', reverb(out, 0.28, 0.44));
}

// ── warning — 報單 alert (opponent down to 1-2 cards) ─────────────────────────
{
  const out = buf(0.55);
  [[0, 880], [0.145, 1174.66]].forEach(([s, f]) => {
    const n0 = Math.round(s * SR), n = Math.round(0.12 * SR);
    for (let k = 0; k < n; k++) {
      const t = T(k);
      const e = ad(t, 0.006, 0.12, 3);
      out[n0 + k] += (Math.sin(2 * Math.PI * f * t) * 0.8 + Math.sin(4 * Math.PI * f * t) * 0.2) * e * 0.7;
    }
  });
  writeWav('warning.wav', out);
}

// ── tick — turn-timer blip for the last few seconds ──────────────────────────
{
  const out = buf(0.09);
  for (let i = 0; i < out.length; i++) {
    const t = T(i);
    const e = ad(t, 0.0006, 0.055, 9);
    out[i] = (Math.sin(2 * Math.PI * 1320 * t) * 0.75 + rnd() * 0.2) * e;
  }
  writeWav('tick.wav', out);
}

// ── select / deselect — picking a card up off the fan ─────────────────────────
for (const [name, f, bright] of [['select.wav', 2600, 1.0], ['deselect.wav', 1700, 0.7]]) {
  const out = buf(0.07);
  const svf = makeSVF(1.4);
  for (let i = 0; i < out.length; i++) {
    const t = T(i);
    const e = ad(t, 0.0005, 0.042, 10);
    out[i] = (svf(rnd(), lerp(f, f * 0.4, t / 0.042)).band * 1.2 + Math.sin(2 * Math.PI * f * 0.5 * t) * 0.25) * e * bright;
  }
  writeWav(name, out);
}

console.log('done.');
