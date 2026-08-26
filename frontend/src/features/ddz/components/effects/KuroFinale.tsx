'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { GodBubble } from './GodBubble';
import {
  KURO_TARGET_MS,
  KURO_UNMUTE_AT_MS,
  KURO_VIDEO,
  KYOKA_LINE,
  SHUTTER,
  type KuroState,
} from '@/features/ddz/kuroFinale';
import type { PlayOrigin } from '@/features/ddz/components/PlayArea';

/**
 * 黑棺 — the line, the clip, the blackout.
 *
 * Rendered at page level beside the result screen rather than inside the board,
 * because the server resets the room — and unmounts the board — while this is
 * still running.
 *
 * The clip is a video plate, not a CSS build: the calligraphy is baked into
 * kuro_hitsugi.mp4 and all this contributes is the key that drops its black
 * field. See globals.css.
 */
export function KuroFinale({ state, seatOf, onPlateEnd, plateMaxMs }: {
  state: KuroState;
  /** Maps a seat index to where that player sits on this screen. */
  seatOf: (playerIndex: number) => PlayOrigin;
  /** The clip is over — close the leaves. */
  onPlateEnd: () => void;
  /** Ceiling for a clip that never reports itself finished. */
  plateMaxMs: number;
}) {
  return (
    <>
      <AnimatePresence>
        {state.phase === 'bubble' && (
          <GodBubble
            key="kuro-bubble"
            origin={seatOf(state.playerIndex)}
            text={KYOKA_LINE}
            half={215}
          />
        )}
      </AnimatePresence>

      {state.phase === 'plate' && <KuroPlate onEnd={onPlateEnd} maxMs={plateMaxMs} />}

      {state.phase === 'shutter' && (
        <div
          className="kuro-shutter"
          aria-hidden="true"
          style={{
            ['--close' as string]: `${SHUTTER.close}ms`,
            ['--hold' as string]: `${SHUTTER.hold}ms`,
            ['--open' as string]: `${SHUTTER.open}ms`,
          }}
        >
          <div className="kuro-leaf l" />
          <div className="kuro-leaf r" />
        </div>
      )}
    </>
  );
}

/**
 * The clip.
 *
 * Starts muted and compressed, hands itself over to real time with sound at the
 * mark, and reports back when it finishes. Muted is not only an audio choice:
 * a muted video is exempt from autoplay policy, so the head can always start.
 */
function KuroPlate({ onEnd, maxMs }: { onEnd: () => void; maxMs: number }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    done.current = false;

    /** Fires once, whichever of the three routes gets here first. */
    const finish = () => {
      if (done.current) return;
      done.current = true;
      onEnd();
    };

    /**
     * Hand the clip over to real time at the mark.
     *
     * Two independent ways of hitting it, because each covers the other's blind
     * spot. requestVideoFrameCallback reports the mediaTime of every presented
     * frame, so on a visible tab the switch lands on the first frame at or past
     * the mark — as exact as the source's 30fps allows. It is silent on a tab
     * that is not compositing, which is why a self-correcting timer chain runs
     * alongside: each tick converts the remaining SOURCE time into wall time at
     * the current rate, sleeps just short of it, then closes in ~0ms hops.
     * Recomputing from currentTime every tick is what keeps a slow decode from
     * accumulating drift.
     */
    let flipped = false;
    let hop: ReturnType<typeof setTimeout> | null = null;

    const flip = () => {
      if (flipped) return;
      flipped = true;
      v.playbackRate = 1;
      v.muted = false;
      // Chrome pauses a video unmuted without user activation. Playing a hand
      // of cards is activation, so this is belt and braces — and if the audio
      // really is refused, carry on silent rather than freeze on the mark.
      if (v.paused) {
        v.play().catch(() => {
          v.muted = true;
          v.play().catch(() => {});
        });
      }
    };

    const tick = () => {
      if (flipped || !ref.current) return;
      // Chrome pauses muted video-only playback on a backgrounded tab, and the
      // closing hops are ~0ms apart. Idle instead of spinning through a stall —
      // currentTime is not moving, so there is nothing to converge on.
      if (v.paused) { hop = setTimeout(tick, 100); return; }
      const leftMs = KURO_UNMUTE_AT_MS - v.currentTime * 1000;
      if (leftMs <= 0) { flip(); return; }
      const wall = leftMs / (v.playbackRate || 1);
      hop = setTimeout(tick, wall > 30 ? wall - 20 : 0);
    };

    const onMeta = () => {
      if (!isFinite(v.duration) || v.duration <= 0) return;
      // Time-stretched rather than cut, so the whole piece still reads.
      v.playbackRate = (v.duration * 1000) / KURO_TARGET_MS;
      if ('requestVideoFrameCallback' in v) {
        const onFrame = (_now: number, meta: { mediaTime: number }) => {
          if (flipped || !ref.current) return;
          if (meta.mediaTime * 1000 >= KURO_UNMUTE_AT_MS) { flip(); return; }
          v.requestVideoFrameCallback(onFrame);
        };
        v.requestVideoFrameCallback(onFrame);
      }
      tick();
    };

    v.addEventListener('loadedmetadata', onMeta, { once: true });
    v.addEventListener('ended', finish, { once: true });
    // A clip that cannot play at all still has to hand the round back.
    v.addEventListener('error', finish, { once: true });
    const ceiling = setTimeout(finish, maxMs);
    v.play().catch(() => {});

    return () => {
      clearTimeout(ceiling);
      if (hop) clearTimeout(hop);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('ended', finish);
      v.removeEventListener('error', finish);
      // A detached <video> keeps playing its audio.
      v.pause();
    };
  }, [onEnd, maxMs]);

  return (
    <div className="kuro-plate" aria-hidden="true">
      {/*
        Alpha from brightness: the clip's black field goes transparent and the
        calligraphy keeps its weight. The last row is what writes alpha —
        0.5R + 0.8G + 0.5B, clamped — rather than true luma (.30/.60/.10),
        which measures right but leaves the violet ghost strokes at a third of
        their opacity and reads washed out. Raise the row for heavier strokes,
        lower it if the compression floor starts to haze.

        sRGB, not the linearRGB default: the clip was authored in sRGB and the
        default would shift every colour on the way through.
      */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <filter id="kuro-luma" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    0.5 0.8 0.5 0 0"
          />
        </filter>
      </svg>
      <video ref={ref} src={KURO_VIDEO} muted playsInline preload="auto" />
    </div>
  );
}
