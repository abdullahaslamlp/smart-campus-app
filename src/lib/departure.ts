// Automatic pickup detection.
//
// After a parent or driver checks in, the app re-checks their GPS position every
// 30 seconds. When they have clearly left the pickup zone, pickup is confirmed for
// them, so a forgotten "I have my children" tap doesn't leave children showing as
// still waiting.
//
// One noisy GPS fix near the edge of the zone must not confirm a pickup, so a
// departure needs several clear readings in a row.

/** Seconds between location checks while a pickup is in progress. */
export const POLL_SECONDS = 30;

/** Consecutive "clearly outside" readings needed before pickup is confirmed. */
export const DEPARTURE_READINGS = 2;

/** A fix less accurate than this (metres) says too little to act on. */
export const MAX_USABLE_ACCURACY_M = 150;

export type FixVerdict = 'outside' | 'inside' | 'unreliable';

/** Great-circle distance in metres. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Is this GPS fix clearly outside the pickup zone?
 * The fix's own accuracy is subtracted, so a reading is "outside" only when even its
 * most generous interpretation is beyond the radius.
 */
export function judgeFix(distanceMeters: number, accuracyMeters: number | null | undefined, radiusMeters: number): FixVerdict {
  const accuracy = accuracyMeters ?? 0;
  if (accuracy > MAX_USABLE_ACCURACY_M) return 'unreliable';
  return distanceMeters - accuracy > radiusMeters ? 'outside' : 'inside';
}

/** Update the running count of consecutive outside readings. */
export function nextStreak(streak: number, verdict: FixVerdict): number {
  if (verdict === 'outside') return streak + 1;
  if (verdict === 'inside') return 0;
  return streak; // an unreliable fix neither confirms nor cancels a departure
}

export const departureConfirmed = (streak: number) => streak >= DEPARTURE_READINGS;

/**
 * Tracks one person's readings during a pickup.
 *
 * A departure only counts once the person has really been inside the pickup zone;
 * otherwise a child sent to the gate by the school while the parent is still on the
 * way would look like "already left" and be confirmed by mistake.
 */
export class DepartureTracker {
  private streak = 0;
  private seenInside = false;

  /** The person is known to have been inside the zone (e.g. they just checked in there). */
  noteInside() { this.seenInside = true; }

  reset() { this.streak = 0; this.seenInside = false; }

  /** Feed one GPS verdict; returns true when pickup should now be confirmed. */
  feed(verdict: FixVerdict): boolean {
    if (verdict === 'inside') this.seenInside = true;
    this.streak = nextStreak(this.streak, verdict);
    return this.seenInside && departureConfirmed(this.streak);
  }
}
