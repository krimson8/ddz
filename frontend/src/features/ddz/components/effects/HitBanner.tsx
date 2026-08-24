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
  /** The play's hand type. Only 火箭 gets the colliding jokers. */
  type: string;
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
  friendly: '#fb7185',
};

/** Base length of the banner, ms, before STRETCH. Music outlives this. */
export const BANNER_MS: Record<string, number> = {
  1: 620, 2: 800, 3: 980, 4: 1300, 5: 1900, 6: 2900, 7: 4300, comeback: 3200, friendly: 3600,
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
  1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 1.5, 7: 1.5, comeback: 1.5, friendly: 1,
};

/**
 * Levels that arrive whole instead of being hit onto the screen.
 *
 * Friendly fire is not a triumph — it is a mistake being named — so it borrows
 * the finale's manner: one fade in, a hold, one fade out. No wind-up, no
 * shockwaves, no second blast, and above all no shake. Their timings are
 * absolute, which is why they sit at STRETCH 1.
 */
const SERENE = new Set(['friendly']);

/**
 * The beat.
 *
 * Tier 5 and up land one glyph at a time, BEAT apart, and go off a second time
 * one beat after the last glyph lands. This is real milliseconds and is
 * deliberately *not* stretched: the gap is the thing being specified, so it has
 * to read the same on a tier that plays at 1.5x and one that plays at 2x.
 */
const BEAT = 300;
const GLYPH_IN = BEAT * 1.9;   // the entrance overlaps the next beat
const LAND = GLYPH_IN * 0.2;   // hb-glyphHit's 20% keyframe — the moment of contact
const TAIL = 1500;             // room for the second blast to play out

const num = (level: HitLevel): number =>
  level === 'comeback' ? 7 : level === 'friendly' ? 6 : level;

export type ShakeStrength = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Tier → shake strength.
 *
 * Seven steps rather than three: collapsing tiers 3-5 into one jolt and
 * 6/7/comeback into another made half the ladder feel identical, so a bomb and
 * a rocket hit the table the same way. Straight through now, with the comeback
 * one notch under the rocket — it borrows the legendary look but it is not the
 * top of the ladder — and friendly fire a notch under that again.
 *
 * Never 0: every card that lands knocks the table. The tiers only decide how
 * hard.
 */
const SHAKE_FOR: Record<string, ShakeStrength> = {
  0: 1, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, comeback: 6, friendly: 1,
};

export function shakeLevel(level: HitLevel): ShakeStrength {
  return SHAKE_FOR[String(level)] ?? 1;
}

/** One scheduled jolt: when to shake the table, and how hard. */
export interface Beat {
  at: number;
  strength: ShakeStrength;
}

export interface BannerPlan {
  key: string;
  n: number;
  stretch: number;
  accent: string;
  /** Total banner length in ms, already stretched. */
  total: number;
  /** Wind-up before the impact, already stretched. */
  charge: number;
  /** Everything after the impact. */
  body: number;
  chars: string[];
  /** Whether the word lands glyph by glyph and detonates again at the end. */
  seq: boolean;
  /** Whether the word arrives whole and still, the way the finale does. */
  serene: boolean;
  /** Every jolt the table takes, ms from the banner start. Empty when !seq. */
  beats: Beat[];
  /** When the second blast goes off, ms from the banner start. */
  detonateAt: number | null;
  jokers: boolean;
  godray: boolean;
  gold: boolean;
}

/**
 * Everything about how one banner plays, derived once.
 *
 * The banner draws it and the table shakes to it, so both read the same object
 * — the alternative is two schedules that agree until someone edits one.
 */
export function bannerPlan(level: HitLevel, word: string, type = ''): BannerPlan {
  const key = String(level);
  const n = num(level);
  const stretch = STRETCH[key] ?? 1;
  const charge = Math.round((CHARGE_MS[key] ?? 0) * stretch);
  const chars = [...word];
  const shake = shakeLevel(level);
  const serene = SERENE.has(key);
  // Tier 5 and up are centrepieces: the word is the event, not a label on one.
  const seq = !serene && n >= 5 && chars.length > 0;

  let total = Math.round((BANNER_MS[key] ?? 1000) * stretch);
  const beats: Beat[] = [];
  let detonateAt: number | null = null;

  if (seq) {
    const step = (i: number) =>
      Math.min(shake, Math.max(3, shake - (chars.length - 1 - i))) as ShakeStrength;
    // The impact sits one notch under the ladder so the whacks have somewhere
    // to climb to; the last glyph and the detonation are the only full hits.
    beats.push({ at: charge, strength: Math.max(1, shake - 1) as ShakeStrength });
    chars.forEach((_, i) => beats.push({ at: Math.round(charge + i * BEAT + LAND), strength: step(i) }));
    detonateAt = Math.round(charge + (chars.length - 1) * BEAT + LAND + BEAT);
    beats.push({ at: detonateAt, strength: shake });
    beats.push({ at: detonateAt + 900, strength: Math.ceil(shake / 2) as ShakeStrength });
    // A long word outruns the tier's stock length. Stretch the banner to fit
    // rather than cutting the word off halfway through its own sequence.
    total = Math.max(total, detonateAt + TAIL);
  }

  return {
    key,
    n,
    stretch,
    accent: ACCENT[key] ?? '#fde047',
    total,
    charge,
    body: total - charge,
    chars,
    seq,
    serene,
    beats,
    detonateAt,
    // Two 王 flying in and colliding is the rocket's own gesture — 天堂製造
    // shares its tier but is a plane, and would be claiming cards it never had.
    jokers: type === 'rocket',
    godray: level === 7 || level === 'comeback',
    gold: level === 7,
  };
}

/**
 * Shrink a word that would run off the table.
 *
 * Measured with offsetWidth rather than a rect, because the glyphs are already
 * mid-animation at scale 5 when this runs and a bounding rect would report the
 * transform instead of the layout.
 */
function fitWord(host: HTMLElement, banner: HTMLElement) {
  const word = banner.querySelector('.hb-word') as HTMLElement | null;
  if (!word) return;
  const size = parseFloat(getComputedStyle(word).fontSize);
  const room = host.clientWidth * 0.9;
  // The layout box is not the ink: the outline bleeds .15em past it on each
  // side, and both scale with the font size, so they divide out cleanly.
  const ink = word.offsetWidth + size * 0.34;
  if (!room || !size || ink <= room) return;
  word.style.fontSize = `${Math.floor(size * (room / ink))}px`;
}

/**
 * The hit banner. Rebuilds its DOM per event rather than toggling classes —
 * that is what restarts every CSS animation cleanly, and it costs nothing
 * because the layer is torn down between plays anyway.
 */
export function HitBanner({ event, onDone }: { event: HitEvent | null; onDone: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const lastId = useRef(-1);

  const plan = useMemo(
    () => (event ? bannerPlan(event.level, event.word, event.type) : null),
    [event],
  );

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

    const { n, accent, total, charge, body, stretch, chars } = plan;
    /** Scale a hand-tuned offset by this level's stretch. */
    const slow = (base: number) => Math.round(base * stretch);

    /**
     * Radial spark burst. Shared, because the rocket throws a small one off
     * every glyph and a huge one at the end — `origin` re-centres it on a
     * glyph instead of on the table.
     */
    const burst = (count: number, reach: number, heavy: boolean, origin = '') => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + (i % 3) * 0.28;
        const d = reach + ((i * 137) % (heavy ? 420 : 230));
        const s = 4 + ((i * 53) % (heavy ? 12 : 8));
        add('hb-spark', '', `${origin}width:${s}px;height:${s}px;margin:${-s / 2}px 0 0 ${-s / 2}px;` +
          `background:${i % 3 ? '#fff' : accent};box-shadow:0 0 ${s * 2}px ${accent};` +
          `--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d * 0.7 + 70).toFixed(1)}px;` +
          `animation-delay:${slow((i % 5) * 24)}ms`);
      }
    };

    if (charge) {
      add('hb-charge', '', `--dur:${charge}ms`);
      add('hb-curtain', '', `--dur:${total}ms`);
    }
    if (plan.jokers) {
      add('hb-jk l', '王', `--d:${charge + slow(120)}ms`);
      add('hb-jk r', '王', `--d:${charge + slow(120)}ms`);
    }

    const timers: ReturnType<typeof setTimeout>[] = [];

    if (plan.serene) {
      add('hb-godray', '', `animation-duration:${total}ms`);
      add('hb-wash', '', `--dur:${total}ms`);
      const banner = add('hb-banner hb-serene',
        `<span class="hb-word">` +
        `<span class="hb-stroke" aria-hidden="true">${event.word}</span>` +
        `<span class="hb-fill">${event.word}</span></span>` +
        `<span class="hb-sub">${event.sub}</span>`,
        `--od:${total}ms`);
      fitWord(host, banner);
      timers.push(setTimeout(() => {
        if (hostRef.current) hostRef.current.innerHTML = '';
        onDone();
      }, total + 60));
      return () => timers.forEach(clearTimeout);
    }

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

      if (n >= 3) burst(n === 3 ? 16 : n === 4 ? 26 : n === 5 ? 40 : n === 6 ? 60 : 84, 130, n >= 6);

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

      // ── The word ──────────────────────────────────────────────────────────
      let inner: string;
      let subDelay: number;
      if (plan.seq) {
        // One glyph per beat, each with its own chromatic split. The ghosts
        // carry the same delay as the glyph they sit under, or they play out
        // while that glyph is still invisible and the split is never seen.
        inner = chars.map((ch, i) => {
          const d = i * BEAT;
          return `<span class="g" style="--gd:${GLYPH_IN}ms;animation-delay:${d}ms">` +
            `<span class="hb-ghost r" style="animation-delay:${d}ms">${ch}</span>` +
            `<span class="hb-ghost c" style="animation-delay:${d}ms">${ch}</span>` +
            `<span class="hb-stroke" aria-hidden="true">${ch}</span>` +
            `<span class="hb-fill">${ch}</span></span>`;
        }).join('');
        subDelay = Math.round((chars.length - 1) * BEAT + LAND + 60);
      } else {
        const ghosts = n >= 4
          ? `<span class="hb-ghost r">${event.word}</span><span class="hb-ghost c">${event.word}</span>`
          : '';
        inner = ghosts +
          `<span class="hb-stroke" aria-hidden="true">${event.word}</span>` +
          `<span class="hb-fill">${event.word}</span>`;
        subDelay = 0;
      }

      const banner = add(plan.seq ? 'hb-banner outro' : 'hb-banner',
        `<span class="hb-word${plan.seq ? ' split seq' : ''}">${inner}</span>` +
        `<span class="hb-sub" style="--sd:${body - subDelay}ms;animation-delay:${subDelay}ms">${event.sub}</span>`,
        plan.seq ? `--od:${body}ms` : '');
      fitWord(host, banner);

      if (!plan.seq) return;

      /** The second blast, one beat after the last glyph lands. */
      const detonate = () => {
        if (!hostRef.current) return;
        banner.classList.add('detonate');
        add('hb-whiteout');
        add('hb-rays');
        if (plan.godray) add('hb-godray');
        add('hb-ring fat');
        add('hb-ring fat', '', `animation-delay:${slow(110)}ms`);
        add('hb-ring', '', `animation-delay:${slow(230)}ms`);
        burst(n === 5 ? 46 : n === 6 ? 70 : 110, 170, true);
        const cracks = n === 5 ? 7 : n === 6 ? 11 : 16;
        for (let i = 0; i < cracks; i++) {
          const ang = (i / cracks) * 360 + ((i * 61) % 27) - 13;
          add('hb-crack', '', `--a:${ang.toFixed(1)}deg;animation-delay:${slow((i % 4) * 40)}ms`);
        }
        if (plan.gold) {
          for (let i = 0; i < 48; i++) {
            const s = 3 + ((i * 29) % 6);
            add('hb-gold', '', `--x:${(i * 149) % 100}%;--s:${s}px;` +
              `--r:${((i * 197) % 900) + 360}deg;--d:${slow(1400 + ((i * 71) % 900))}ms;` +
              `animation-delay:${slow((i % 8) * 90)}ms`);
          }
        }
      };

      // Each glyph lands with its own shockwave and sparks, thrown from where
      // that glyph actually sits. Positions are measured against the host so
      // the table's own shake cancels out of the maths.
      const glyphs = banner.querySelectorAll<HTMLElement>('.g');
      chars.forEach((_, i) => timers.push(setTimeout(() => {
        if (!hostRef.current) return;
        const g = glyphs[i]?.getBoundingClientRect();
        const box = host.getBoundingClientRect();
        const origin = g && box.width && box.height
          ? `left:${(((g.left + g.width / 2) - box.left) / box.width * 100).toFixed(2)}%;` +
            `top:${(((g.top + g.height / 2) - box.top) / box.height * 100).toFixed(2)}%;`
          : '';
        add('hb-shock', '', `${origin}--d:${Math.round(BEAT * 1.7)}ms`);
        burst(14 + i * 6, 70, false, origin);
      }, i * BEAT + LAND)));

      timers.push(setTimeout(detonate, (plan.detonateAt ?? charge) - charge));
    }, charge));

    timers.push(setTimeout(() => {
      if (hostRef.current) hostRef.current.innerHTML = '';
      onDone();
    }, total + 60));

    return () => timers.forEach(clearTimeout);
  }, [event, plan, reduce, onDone]);

  return <div ref={hostRef} className="hb" aria-hidden="true" />;
}
