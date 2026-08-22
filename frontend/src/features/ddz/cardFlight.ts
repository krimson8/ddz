'use client';

/**
 * Hand → table card flight.
 *
 * The shared `layoutId` on the hand and play-area cards was supposed to make
 * framer-motion fly a played card into the centre, and it never did. Three
 * things were in the way at once: the play area used `AnimatePresence
 * mode="wait"`, so the new cards did not mount until the outgoing ones had
 * finished exiting — long after the hand card had unmounted, leaving nothing to
 * animate from; both the hand fan and the table stack sit inside rotated
 * ancestors, which framer's layout projection cannot measure through; and the
 * wrapper's own entry animation moved the destination after the card had
 * committed to flying at it.
 *
 * So the flight is explicit instead. The hand records where each played card
 * was, in viewport coordinates, at the moment it was played; the play area
 * measures where those cards are about to land and animates a clone of each
 * between the two in a portal above everything. No projection, no shared
 * ancestors, and the arc, the overshoot and the squash on impact are ours to
 * shape.
 */

/** A card's position and size in viewport space, by centre so rotation is free. */
export interface FlightRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** In-plane rotation at that moment — the hand's fan angle. */
  rot: number;
}

/** Total flight, ms. */
export const FLIGHT_MS = 420;
/** Fraction of the flight spent in the air, before the card hits the table. */
export const FLIGHT_IMPACT_AT = 0.8;
/** When the card actually lands. The board shake is scheduled off this. */
export const FLIGHT_IMPACT_MS = Math.round(FLIGHT_MS * FLIGHT_IMPACT_AT);
/** Per-card delay, so a five-card run arrives as a burst and not a slab. */
export const FLIGHT_STAGGER_MS = 45;

/** How long a recorded hand position stays usable. */
const TTL_MS = 900;

let pending: { at: number; rects: Map<string, FlightRect> } | null = null;

/**
 * Called by the hand as it plays, before the cards unmount. Keyed by the same
 * card id the play area will look them up by.
 */
export function recordHandRects(rects: Map<string, FlightRect>): void {
  pending = { at: Date.now(), rects };
}

/**
 * Consume the recorded positions. Always clears, so a play the server rejects
 * cannot leak its rects into somebody else's turn, and returns null once stale.
 */
export function takeHandRects(): Map<string, FlightRect> | null {
  const p = pending;
  pending = null;
  if (!p || Date.now() - p.at > TTL_MS) return null;
  return p.rects;
}
