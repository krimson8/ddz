// Tier stingers for the DDZ hit banners.
// Writes tier-1..tier-7 into frontend/public/sounds/ as 16-bit mono WAV.
//
// tier-7 here is only a placeholder — the real one is a supplied music file at
// public/sounds/tier-7-rocket.mp3. The placeholder keeps tier 7 audible until
// that lands, and is skipped if the real file is present.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SR = 44100;
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const buf = (sec) => new Float32Array(Math.round(sec * SR));
const T = (i) => i / SR;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const softClip = (x) => Math.tanh(x * 1.4);

let seed = 0x9e3779b1;
function rnd() {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return (seed / 0xffffffff) * 2 - 1;
}

function ad(t, attack, decay, curve = 4) {
  if (t < attack) return t / attack;
  const x = (t - attack) / decay;
  return x >= 1 ? 0 : Math.exp(-curve * x) * (1 - x);
}

/**
 * Chamberlin SVF.
 *
 * The cutoff is clamped to SR/6, which is the topology's actual stability
 * limit: it puts the coefficient f = 2·sin(π·fc/SR) at 1.0, and above that the
 * filter diverges instead of resonating. Sweeping past it silently produces
 * NaN, which then propagates through mixing and normalisation and turns the
 * whole buffer to zero. The state clamp is a second line of defence so a
 * resonant sweep can never poison a render.
 */
function makeSVF(q = 1.0) {
  const FC_MAX = SR / 6;
  let low = 0, band = 0;
  return (x, fc) => {
    const f = 2 * Math.sin((Math.PI * Math.min(fc, FC_MAX)) / SR);
    const high = x - low - q * band;
    band += f * high;
    low += f * band;
    if (!Number.isFinite(band) || Math.abs(band) > 8) band = Math.sign(band) * 8 || 0;
    if (!Number.isFinite(low) || Math.abs(low) > 8) low = Math.sign(low) * 8 || 0;
    return { low, band, high };
  };
}

const saw = (phase) => 2 * (phase % 1) - 1;

/**
 * Detuned saw stack through a resonant lowpass whose cutoff opens on the
 * attack and closes on the decay — the classic orchestral-hit / brass-stab
 * shape, and what makes the higher tiers feel like a fanfare rather than noise.
 */
function brass(out, start, freq, dur, amp, detune = 0.012) {
  const s = Math.round(start * SR);
  const n = Math.round(dur * SR);
  const svf = makeSVF(1.6);
  const voices = [1 - detune, 1, 1 + detune, 1 + detune * 2];
  const ph = voices.map(() => 0);
  for (let i = 0; i < n && s + i < out.length; i++) {
    const t = T(i);
    const e = ad(t, 0.018, dur, 3.2);
    let v = 0;
    for (let k = 0; k < voices.length; k++) {
      ph[k] += (freq * voices[k]) / SR;
      v += saw(ph[k]);
    }
    v /= voices.length;
    const fc = lerp(freq * 10, freq * 2.2, clamp01(t / (dur * 0.55)));
    out[s + i] += svf(v, fc).low * e * amp;
  }
}

/** Chord helper — a stack of brass voices. */
function brassChord(out, start, root, ratios, dur, amp) {
  for (const r of ratios) brass(out, start, root * r, dur, amp / Math.sqrt(ratios.length));
}

/** Rising noise + tone sweep that builds tension into a hit. */
function riser(out, start, dur, amp, fromHz = 200, toHz = 3200) {
  const s = Math.round(start * SR);
  const n = Math.round(dur * SR);
  const svf = makeSVF(2.4);
  let ph = 0;
  for (let i = 0; i < n && s + i < out.length; i++) {
    const t = T(i), p = t / dur;
    const e = Math.pow(p, 1.7);
    const f = lerp(fromHz, toHz, Math.pow(p, 2.0));
    ph += (2 * Math.PI * f) / SR;
    const y = svf(rnd(), f * 1.2);
    out[s + i] += (Math.sin(ph) * 0.35 + y.band * 0.75) * e * amp;
  }
}

/** Reverse-cymbal swell — noise rising through an opening highpass. */
function reverseSwell(out, start, dur, amp) {
  const s = Math.round(start * SR);
  const n = Math.round(dur * SR);
  const svf = makeSVF(0.7);
  for (let i = 0; i < n && s + i < out.length; i++) {
    const t = T(i), p = t / dur;
    const e = Math.pow(p, 2.2);
    // Highpass output, so everything above the sweep passes — plenty bright
    // without pushing the cutoff itself near the stability ceiling.
    out[s + i] += svf(rnd(), lerp(900, 6800, p)).high * e * amp;
  }
}

/** Sub sine sweeping downward — the weight under an impact. */
function subDrop(out, start, dur, amp, from = 110, to = 28) {
  const s = Math.round(start * SR);
  const n = Math.round(dur * SR);
  let ph = 0;
  for (let i = 0; i < n && s + i < out.length; i++) {
    const t = T(i), p = t / dur;
    const f = lerp(from, to, Math.pow(p, 0.42));
    ph += (2 * Math.PI * f) / SR;
    out[s + i] += Math.sin(ph) * Math.exp(-2.1 * p) * amp;
  }
}

/** Broadband impact: transient crack over a collapsing noise body. */
function impact(out, start, dur, amp) {
  const s = Math.round(start * SR);
  const n = Math.round(dur * SR);
  const svf = makeSVF(0.75);
  const crackN = Math.round(0.07 * SR);
  for (let i = 0; i < crackN && s + i < out.length; i++) {
    const t = T(i);
    out[s + i] += rnd() * ad(t, 0.0004, 0.07, 9) * 0.55 * amp;
  }
  for (let i = 0; i < n && s + i < out.length; i++) {
    const t = T(i), p = t / dur;
    const e = Math.exp(-3.4 * p) * (1 - p);
    out[s + i] += softClip(svf(rnd(), lerp(6500, 170, Math.pow(p, 0.35))).low * 2.1 * e) * amp;
  }
}

/** Struck-metal voice for gongs. */
function gong(out, start, freq, dur, amp) {
  const partials = [1, 2.32, 3.44, 4.07, 5.31, 6.72, 8.11, 9.87];
  const s = Math.round(start * SR);
  const n = Math.round(dur * SR);
  for (let i = 0; i < n && s + i < out.length; i++) {
    const t = T(i);
    let v = 0;
    for (let p = 0; p < partials.length; p++) {
      const d = dur / (1 + p * 0.55);
      v += Math.sin(2 * Math.PI * freq * partials[p] * t + p) * ad(t, 0.001, d, 3) / (1 + p * 0.8);
    }
    if (t < 0.03) v += rnd() * (1 - t / 0.03) * 0.5;
    out[s + i] += v * amp * 0.5;
  }
}

/** Slow detuned pad, for the legendary tier's tail. */
function pad(out, start, dur, amp, freqs) {
  const s = Math.round(start * SR);
  const n = Math.round(dur * SR);
  for (let i = 0; i < n && s + i < out.length; i++) {
    const t = T(i), p = t / dur;
    const e = Math.min(1, p / 0.25) * (1 - Math.pow(p, 2.2));
    let v = 0;
    for (const f of freqs) {
      v += Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 1.004 * t + 1.1);
    }
    out[s + i] += (v / (freqs.length * 2)) * e * amp;
  }
}

function bell(out, start, freq, dur, amp, ratio = 3.0, index = 5) {
  const s = Math.round(start * SR);
  const n = Math.round(dur * SR);
  for (let i = 0; i < n && s + i < out.length; i++) {
    const t = T(i);
    const e = ad(t, 0.002, dur, 3.5);
    const mod = Math.sin(2 * Math.PI * freq * ratio * t) * index * e;
    out[s + i] += Math.sin(2 * Math.PI * freq * t + mod) * e * amp;
  }
}

function reverb(sig, mix = 0.3, decay = 0.42) {
  const combs = [1231, 1583, 1867, 2129, 2593];
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

function fade(sig) {
  const a = Math.round(0.0005 * SR), b = Math.round(0.05 * SR);
  for (let i = 0; i < a; i++) sig[i] *= i / a;
  for (let i = 0; i < b; i++) sig[sig.length - 1 - i] *= i / b;
  return sig;
}

function normalize(sig, peak = 0.89) {
  let max = 0;
  for (const v of sig) max = Math.max(max, Math.abs(v));
  if (max < 1e-9) return sig;
  for (let i = 0; i < sig.length; i++) sig[i] *= peak / max;
  return sig;
}

function writeWav(name, sig) {
  fade(sig);
  normalize(sig);
  const n = sig.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sig[i])) * 32767), 44 + i * 2);
  }
  writeFileSync(join(OUT, name), b);
  console.log('  ' + name.padEnd(16) + (b.length / 1024).toFixed(0).padStart(5) + ' KB  ' + (n / SR).toFixed(2) + 's');
}

console.log('tier stingers:');

// ── Tier 1 輕 — a light, bright tick. Should barely register. ───────────────
{
  const out = buf(0.6);
  bell(out, 0, 1174.7, 0.34, 0.6, 2.0, 2.4);
  bell(out, 0.045, 1567.98, 0.3, 0.35, 2.0, 2.0);
  impact(out, 0, 0.12, 0.22);
  writeWav('tier-1.wav', reverb(out, 0.2, 0.34));
}

// ── Tier 2 中 — a short two-step stab. ──────────────────────────────────────
{
  const out = buf(0.9);
  brass(out, 0, 293.66, 0.28, 0.5);
  brass(out, 0.1, 440, 0.5, 0.62);
  impact(out, 0.1, 0.3, 0.4);
  bell(out, 0.1, 1318.5, 0.4, 0.22);
  writeWav('tier-2.wav', reverb(out, 0.26, 0.38));
}

// ── Tier 3 大 — proper brass stab with a tail. ──────────────────────────────
{
  const out = buf(1.4);
  riser(out, 0, 0.2, 0.3, 300, 1800);
  brassChord(out, 0.19, 220, [1, 1.5, 2, 3], 0.85, 0.95);
  impact(out, 0.19, 0.5, 0.6);
  subDrop(out, 0.19, 0.6, 0.5, 90, 40);
  bell(out, 0.24, 1046.5, 0.7, 0.2);
  writeWav('tier-3.wav', reverb(out, 0.32, 0.42));
}

// ── Tier 4 猛 — riser into a bigger cluster. ────────────────────────────────
{
  const out = buf(1.9);
  riser(out, 0, 0.42, 0.5, 240, 2600);
  reverseSwell(out, 0.05, 0.4, 0.3);
  brassChord(out, 0.41, 196, [1, 1.5, 2, 2.5, 3, 4], 1.15, 1.0);
  impact(out, 0.41, 0.7, 0.85);
  subDrop(out, 0.41, 0.9, 0.75, 110, 34);
  gong(out, 0.43, 262, 0.9, 0.28);
  writeWav('tier-4.wav', reverb(out, 0.36, 0.45));
}

// ── Tier 5 爆 — 炸彈. Explosion first, fanfare second. ──────────────────────
{
  const out = buf(2.3);
  riser(out, 0, 0.36, 0.42, 200, 2200);
  impact(out, 0.35, 1.3, 1.0);
  subDrop(out, 0.35, 1.25, 0.95, 130, 30);
  brassChord(out, 0.42, 174.61, [1, 1.5, 2, 3, 4], 1.3, 0.85);
  gong(out, 0.37, 220, 1.5, 0.4);
  writeWav('tier-5.wav', reverb(out, 0.34, 0.46));
}

// ── Tier 6 霸 — AAAA+. Long charge, colossal hit, aftershock. ───────────────
{
  const out = buf(3.1);
  riser(out, 0, 0.72, 0.62, 130, 4200);
  reverseSwell(out, 0.1, 0.68, 0.5);
  subDrop(out, 0.0, 0.7, 0.25, 40, 70);          // inverted: sub rises into the hit
  impact(out, 0.72, 1.7, 1.0);
  subDrop(out, 0.72, 1.7, 1.0, 150, 26);
  brassChord(out, 0.78, 146.83, [1, 1.5, 2, 2.5, 3, 4, 6], 1.8, 0.95);
  gong(out, 0.74, 174.61, 2.1, 0.55);
  impact(out, 1.62, 0.8, 0.42);                   // aftershock
  brassChord(out, 1.68, 196, [1, 1.5, 2, 3], 1.2, 0.5);
  writeWav('tier-6.wav', reverb(out, 0.42, 0.52));
}

// ── Tier 7 神 — placeholder only. Replaced by tier-7-rocket.mp3. ────────────
if (existsSync(join(OUT, 'tier-7-rocket.mp3')) || existsSync(join(OUT, 'tier-7-rocket.wav'))) {
  console.log('  tier-7          skipped — supplied rocket track is present');
} else {
  const out = buf(4.2);
  riser(out, 0, 1.15, 0.7, 90, 5200);
  reverseSwell(out, 0.2, 1.05, 0.6);
  impact(out, 1.15, 2.1, 1.0);
  subDrop(out, 1.15, 2.2, 1.0, 170, 24);
  gong(out, 1.17, 130.81, 2.8, 0.6);
  brassChord(out, 1.22, 130.81, [1, 1.5, 2, 2.5, 3, 4, 5, 6], 2.2, 1.0);
  pad(out, 1.3, 2.7, 0.5, [261.63, 329.63, 392, 523.25]);   // C major, held
  impact(out, 2.25, 0.9, 0.4);
  brassChord(out, 2.32, 196, [1, 1.5, 2, 3, 4], 1.6, 0.6);
  bell(out, 2.35, 1046.5, 1.6, 0.28, 4.0, 3);
  writeWav('tier-7.wav', reverb(out, 0.46, 0.56));
}

console.log('done.');
