'use client';

import { useEffect, useRef, useState } from 'react';
import { sfx } from '@/features/ddz/sfx';
import {
  VERGIL_KEY_MS,
  VERGIL_VIDEO,
  VERGIL_WEIGHT,
  type VergilState,
} from '@/features/ddz/vergilFinale';

/**
 * 閻魔刀 — one clip, no ceremony.
 *
 * The bluntest of the finales: no line, no bubble, no banner of its own. The
 * clip is the whole piece and carries its own audio, and the only thing this
 * contributes is the key over its first three seconds.
 *
 * Rendered at page level beside the result screen rather than inside the board,
 * because the server resets the room — and unmounts the board — twelve seconds
 * into a clip that runs for thirty.
 *
 * It does not get out of the way when that happens. The room going back to a
 * lobby is not the player being done with the round: the clip stays up over the
 * top of it, and the first thing they actually see of the lobby is whatever is
 * there after they dismiss the result screen. The button is the ending, not the
 * server's timer.
 */
export function VergilFinale({ state, onEnd, plateMaxMs }: {
  state: VergilState;
  /** The clip is done with — finished, stopped, or given up on. */
  onEnd: () => void;
  /** Ceiling for a clip that never reports itself finished. */
  plateMaxMs: number;
}) {
  if (state.phase !== 'plate') return null;
  return <VergilPlate onEnd={onEnd} maxMs={plateMaxMs} />;
}

/**
 * The clip.
 *
 * Plays out loud from the first frame — unlike 黑棺, which runs its head silent
 * under a spoken line. Autoplay policy is satisfied because a round of cards is
 * user activation, and the catch below covers the case where it is not.
 */
function VergilPlate({ onEnd, maxMs }: {
  onEnd: () => void;
  maxMs: number;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const done = useRef(false);
  /** True while the green screen is on screen — see the key below. */
  const [keyed, setKeyed] = useState(true);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    done.current = false;
    setKeyed(true);

    /** Fires once, whichever of the four routes gets here first. */
    const finish = () => {
      if (done.current) return;
      done.current = true;
      onEnd();
    };

    // The master volume reaches the clip through here — without it the settings
    // slider moves every sound in the game except this one. The slot adoption
    // is what makes the end screen's dismiss button stop the clip: that button
    // calls stopMusic(), and the clip's own track is now what stopMusic() holds.
    const detach = sfx.attachMedia(v);
    sfx.adoptMedia(v, VERGIL_WEIGHT);

    /**
     * Take the key off at the mark.
     *
     * Two independent ways of hitting it, because each covers the other's blind
     * spot. requestVideoFrameCallback reports the mediaTime of every presented
     * frame, so on a visible tab the switch lands on the first frame at or past
     * the mark — as exact as the source's 30fps allows. It is silent on a tab
     * that is not compositing, which is why a self-correcting timer chain runs
     * alongside: each tick recomputes from currentTime rather than counting
     * down from one reading, so a slow decode cannot accumulate drift.
     *
     * The two halves are one file, so this is the only thing separating them:
     * before the mark the green is keyed to nothing and the winner stands on
     * the table; after it the footage plays untouched, full frame.
     */
    let flipped = false;
    let hop: ReturnType<typeof setTimeout> | null = null;

    const unkey = () => {
      if (flipped) return;
      flipped = true;
      setKeyed(false);
    };

    const tick = () => {
      if (flipped || !ref.current) return;
      if (v.paused) { hop = setTimeout(tick, 100); return; }   // stalled; nothing to converge on
      const leftMs = VERGIL_KEY_MS - v.currentTime * 1000;
      if (leftMs <= 0) { unkey(); return; }
      hop = setTimeout(tick, leftMs > 30 ? leftMs - 20 : 0);
    };

    if ('requestVideoFrameCallback' in v) {
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        if (flipped || !ref.current) return;
        if (meta.mediaTime * 1000 >= VERGIL_KEY_MS) { unkey(); return; }
        v.requestVideoFrameCallback(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
    }
    tick();

    /**
     * Stopped from the outside.
     *
     * The end screen's button calls stopMusic(), which pauses whatever holds
     * the slot — this clip. A pause that is not the clip finishing is therefore
     * the signal to take the plate down. Buffering does not come through here;
     * it raises 'waiting', not 'pause'.
     */
    const onPause = () => {
      if (!v.ended && v.currentTime > 0) finish();
    };

    v.addEventListener('ended', finish, { once: true });
    // A clip that cannot play at all still has to let go.
    v.addEventListener('error', finish, { once: true });
    v.addEventListener('pause', onPause);
    const ceiling = setTimeout(finish, maxMs);
    // An earlier run of this effect may have dropped to muted below; a fresh
    // start is a fresh chance at sound.
    v.muted = false;
    v.play().catch((err: DOMException) => {
      // Only NotAllowedError means autoplay policy refused SOUND. Everything
      // else that rejects a play() is a play that got interrupted — above all
      // AbortError, which is what our own cleanup's pause() raises, and which
      // React fires on every mount in development because StrictMode mounts,
      // unmounts and mounts again. Muting on that silenced the clip for the
      // whole round: the second run played an element the first run had gagged.
      if (err?.name !== 'NotAllowedError') return;
      // Sound really was refused. Better a silent finale than a frozen frame.
      v.muted = true;
      v.play().catch(() => {});
    });

    return () => {
      clearTimeout(ceiling);
      if (hop) clearTimeout(hop);
      v.removeEventListener('ended', finish);
      v.removeEventListener('error', finish);
      // Off before the pause below, or unmounting would report itself as a stop.
      v.removeEventListener('pause', onPause);
      detach();
      // A detached <video> keeps playing its audio.
      v.pause();
    };
  }, [onEnd, maxMs]);

  return (
    <div className={`vergil-plate${keyed ? ' keyed' : ''}`} aria-hidden="true">
      {/*
        Green screen → transparent. The other keys in this game measure
        brightness; this one measures GREEN DOMINANCE, which is what actually
        separates a backdrop from a subject: alpha = 1 + 0.7R − 1.4G + 0.7B, so
        a pixel only disappears when green outruns both other channels. The
        backdrop is a flat (0,205,3) — every pixel of the first frame identical,
        a rendered green rather than a lit one — which lands at −0.12 and clamps
        to nothing, while a blue coat, white hair and black leather all sit at
        or above 1. A luma key could not tell any of that apart.

        The green ROW is the despill: G is pulled back to 0.85 and the missing
        0.15 made up from R and B, which kills the green rim a matte leaves on
        hair and shoulders. It tints the whole frame slightly, which costs
        nothing on a palette with no green in it.

        The table then firms the matte up. Its middle stops are the edge: raise
        them for a harder cut, lower them for a softer one. Mirrored in
        public/fx-lab.html, which is where to dial it.
      */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <filter id="vergil-green-key" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0
                    0.075 0.85 0.075 0 0
                    0 0 1 0 0
                    0.7 -1.4 0.7 0 1"
          />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.05 0.3 0.7 0.95 1 1 1 1" />
          </feComponentTransfer>
        </filter>
      </svg>
      <video ref={ref} src={VERGIL_VIDEO} playsInline preload="auto" />
    </div>
  );
}
