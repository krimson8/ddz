'use client';

import { KURO_VIDEO } from '@/features/ddz/kuroFinale';
import { VERGIL_VIDEO } from '@/features/ddz/vergilFinale';

/**
 * Pull the finale clips into the media cache while there is time to spare.
 *
 * Both finales start on the winning play with nothing ahead of them, and
 * between them they are about six megabytes. 黑棺 gets away with it because it
 * spends 4.4s on a spoken line first and warms itself in that gap; 閻魔刀 has no
 * line at all — the clip IS the piece — so the first frame is wanted the
 * instant the round ends. Fetching then is exactly the wrong moment.
 *
 * So this runs at the start of the round instead, where minutes of play sit
 * between the request and any possible need for it. Cost is paid once per
 * session rather than once per round: the flag below stops a second round
 * asking again, and the browser's cache covers a reload.
 *
 * A detached <video> rather than fetch(), which matters more than it looks. A
 * real <video> pulls its source in byte ranges, and a whole-file fetch() does
 * not populate the cache those ranges read from — the download would happen
 * twice and warm nothing. This is the same trick kuroFinale.ts uses for its own
 * clip mid-sequence.
 */

const CLIPS = [VERGIL_VIDEO, KURO_VIDEO];

let warmed = false;
/**
 * Kept alive on purpose. A <video> that goes out of scope can be collected
 * mid-download, and a collected element takes its transfer with it.
 */
const held: HTMLVideoElement[] = [];

export function warmFinaleClips(): void {
  if (warmed || typeof window === 'undefined') return;
  warmed = true;

  // Data Saver is a person saying "not on my connection", and six megabytes of
  // video they may never see is precisely what they mean. The finales still
  // play — 黑棺 warms itself behind its line, and 閻魔刀 buffers as it goes.
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;

  for (const src of CLIPS) {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;                 // never played; muted keeps policy out of it
    v.src = src;
    v.load();
    held.push(v);
  }
}
