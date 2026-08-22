'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { HitLevel } from '@/features/ddz/hitTier';

/** One banner firing. `id` is monotonic so the same level can retrigger. */
export interface HitEvent {
  id: number;
  level: HitLevel;
  word: string;
  sub: string;
}

const ACCENT: Record<string, string> = {
  1: '#4ade80',
  2: '#38bdf8',
  3: '#a78bfa',
  4: '#f472b6',
  5: '#fb923c',
  6: '#ef4444',
  7: '#fde047',
  comeback: '#22d3ee',
};

/** Base length of the banner, ms, before STRETCH. Music outlives this. */
export const BANNER_MS: Record<string, number> = {
  1: 620, 2: 800, 3: 980, 4: 1300, 5: 1900, 6: 2900, 7: 4300, comeback: 3200,
};

/** Wind-up before the impact, ms, before STRETCH. Only heavy tiers charge up. */
const CHARGE_MS: Record<string, number> = { 5: 340, 6: 700, 7: 1150, comeback: 620 };

/**
 * How much to slow each level down. Applied to every duration at once — the CSS
 * keyframes read it through --sp, and the JS-computed durations and delays
 * multiply by it — so a level stretches as a whole instead of drifting out of
 * sync with itself.
 */
const STRETCH: Record<string, number> = {
  1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 1.5, 7: 1.5, comeback: 1.5,
};

const num = (level: HitLevel) => (level === 'comeback' ? 7 : level);

/**
 * The hit banner. Rebuilds its DOM per event rather than toggling classes —
 * that is what restarts every CSS animation cleanly, and it costs nothing
 * because the layer is torn down between plays anyway.
 */
export function HitBanner({ event, onDone }: { event: HitEvent | null; onDone: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const lastId = useRef(-1);

  // Comebacks get the legendary treatment with a cyan palette of their own.
  const plan = useMemo(() => {
    if (!event) return null;
    const lvl = event.level;
    const key = String(lvl);
    const n = num(lvl);
    const stretch = STRETCH[key] ?? 1;
    return {
      key,
      n,
      stretch,
      accent: ACCENT[key] ?? '#fde047',
      total: Math.round((BANNER_MS[key] ?? 1000) * stretch),
      charge: Math.round((CHARGE_MS[key] ?? 0) * stretch),
      // Tier 6, 7 and comeback are centrepieces: the word lands glyph by glyph.
      split: n >= 6,
      jokers: lvl === 7,
      godray: lvl === 7 || lvl === 'comeback',
      gold: lvl === 7,
    };
  }, [event]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !event || !plan) return;
    if (event.id === lastId.current) return;
    lastId.current = event.id;

    if (reduce) {
      host.innerHTML = '';
      const t = setTimeout(onDone, 400);
      return () => clearTimeout(t);
    }

    host.innerHTML = '';
    host.dataset.tier = plan.key;
    host.style.setProperty('--hb', plan.accent);
    host.style.setProperty('--sp', String(plan.stretch));

    const add = (cls: string, html = '', style = '') => {
      const el = document.createElement('div');
      el.className = cls;
      if (style) el.setAttribute('style', style);
      if (html) el.innerHTML = html;
      host.appendChild(el);
      return el;
    };

    const { n, accent, total, charge, stretch } = plan;
    const body = total - charge;
    /** Scale a hand-tuned offset by this level's stretch. */
    const slow = (base: number) => Math.round(base * stretch);

    if (charge) {
      add('hb-charge', '', `--dur:${charge}ms`);
      add('hb-curtain', '', `--dur:${total}ms`);
    }
    if (plan.jokers) {
      add('hb-jk l', '王', `--d:${charge + slow(120)}ms`);
      add('hb-jk r', '王', `--d:${charge + slow(120)}ms`);
    }

    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(setTimeout(() => {
      if (!hostRef.current) return;
      add(n >= 6 ? 'hb-whiteout' : 'hb-flash');
      if (n >= 2) add('hb-beam', '<i></i><u></u>');
      if (n >= 3) add('hb-rays');
      if (plan.godray) add('hb-godray');
      if (n >= 4) { add('hb-ring'); add('hb-ring', '', `animation-delay:${slow(90)}ms`); }
      if (n >= 5) add('hb-ring fat', '', `animation-delay:${slow(180)}ms`);
      if (n >= 6) add('hb-ring fat', '', `animation-delay:${slow(300)}ms`);

      if (n >= 4) {
        const h = n >= 6 ? '13%' : '9%';
        const anim = `animation:hb-bar ${total}ms cubic-bezier(.2,.9,.25,1) both`;
        add('hb-bar top', '', `height:${h};${anim}`);
        add('hb-bar bottom', '', `height:${h};${anim}`);
      }
      if (n >= 5) add('hb-wash', '', `--dur:${body}ms`);

      if (n >= 3) {
        const count = n === 3 ? 16 : n === 4 ? 26 : n === 5 ? 40 : n === 6 ? 60 : 84;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + (i % 3) * 0.28;
          const d = 130 + ((i * 137) % (n >= 6 ? 420 : 230));
          const s = 4 + ((i * 53) % (n >= 6 ? 12 : 8));
          add('hb-spark', '', `width:${s}px;height:${s}px;margin:${-s / 2}px 0 0 ${-s / 2}px;` +
            `background:${i % 3 ? '#fff' : accent};box-shadow:0 0 ${s * 2}px ${accent};` +
            `--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d * 0.7 + 70).toFixed(1)}px;` +
            `animation-delay:${slow((i % 5) * 24)}ms`);
        }
      }

      if (n >= 5) {
        const cracks = n === 5 ? 5 : n === 6 ? 9 : 13;
        for (let i = 0; i < cracks; i++) {
          const ang = (i / cracks) * 360 + ((i * 47) % 23) - 11;
          add('hb-crack', '', `--a:${ang.toFixed(1)}deg;animation-delay:${slow((i % 3) * 40)}ms`);
        }
        const embers = n === 5 ? 14 : n === 6 ? 26 : 34;
        for (let i = 0; i < embers; i++) {
          const s = 3 + ((i * 31) % 6);
          add('hb-ember', '', `--x:${(i * 137) % 100}%;--s:${s}px;` +
            `--dx:${((i * 53) % 60) - 30}px;--d:${slow(1300 + ((i * 91) % 900))}ms;` +
            `animation-delay:${slow((i % 7) * 90)}ms`);
        }
      }

      if (plan.gold) {
        for (let i = 0; i < 60; i++) {
          const s = 3 + ((i * 29) % 5);
          add('hb-gold', '', `--x:${(i * 167) % 100}%;--s:${s}px;` +
            `--r:${((i * 211) % 900) + 360}deg;--d:${slow(1500 + ((i * 83) % 1100))}ms;` +
            `animation-delay:${slow((i % 9) * 110)}ms`);
        }
      }

      const ghosts = n >= 4
        ? `<span class="hb-ghost r">${event.word}</span><span class="hb-ghost c">${event.word}</span>`
        : '';
      let inner: string;
      if (plan.split) {
        const per = Math.round(body * 0.86);
        inner = [...event.word].map((ch, i) =>
          `<span class="g" style="--gd:${per}ms;animation-delay:${slow(i * 110)}ms">` +
          `<span class="hb-stroke" aria-hidden="true">${ch}</span>` +
          `<span class="hb-fill">${ch}</span></span>`).join('');
      } else {
        inner = `<span class="hb-stroke" aria-hidden="true">${event.word}</span>` +
                `<span class="hb-fill">${event.word}</span>`;
      }
      add('hb-banner',
        `<span class="hb-word${plan.split ? ' split' : ''}">${ghosts}${inner}</span>` +
        `<span class="hb-sub" style="--sd:${body}ms;animation-delay:${slow(plan.split ? 260 : 0)}ms">${event.sub}</span>`);
    }, charge));

    timers.push(setTimeout(() => {
      if (hostRef.current) hostRef.current.innerHTML = '';
      onDone();
    }, total + 60));

    return () => timers.forEach(clearTimeout);
  }, [event, plan, reduce, onDone]);

  return <div ref={hostRef} className="hb" aria-hidden="true" />;
}

/** Shake strength a level should apply to the board. */
export function shakeLevel(level: HitLevel): 0 | 1 | 2 | 3 {
  const n = num(level);
  if (n >= 6) return 3;
  if (n >= 4) return 2;
  if (n >= 3) return 1;
  return 0;
}
