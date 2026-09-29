/**
 * Timers for the worker scripts, independent of `self` (the hosts of the simulation and of the POPCON worker use it,
 * tests inject their own).
 */

/** run `fn` after `delayMs` and return a canceller */
export type Schedule = (fn: () => void, delayMs: number) => () => void;

/**
 * Timer for a worker's loop (the simulation's playback slices, the stages of a POPCON job). A zero delay is a message-channel task, not setTimeout(0): a timer chain nested
 * more than five deep is clamped to 4 ms, which would idle the worker for a quarter of every slice at full speed.
 * A message from the page that is already queued is handled before the task, so a request that arrived first supersedes the work this one would start.
 */
export function defaultSchedule(fn: () => void, delayMs: number): () => void {
  if (delayMs > 0 || typeof MessageChannel !== 'function') {
    const h = setTimeout(fn, Math.max(0, delayMs));
    return () => clearTimeout(h);
  }
  const ch = new MessageChannel();
  let live = true;
  ch.port1.onmessage = () => { ch.port1.close(); if (live) { live = false; fn(); } };
  ch.port2.postMessage(0);
  return () => { live = false; };
}
