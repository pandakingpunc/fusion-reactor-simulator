/**
 * Resumable computations ("slices").
 *
 * A function that takes tens of milliseconds and that a host may want to interrupt (the Grad-Shafranov solve of the
 * 1.5D model, the step that carries it) has two forms with one body: a generator that `yield`s at the points where its
 * driver may suspend it, and the ordinary function that runs that generator to its end. The generator is the
 * `...Slices` (or `*name`) form, the ordinary function calls `runSlices()` on it, so the two cannot differ in what they
 * compute: they execute the same statements in the same order, and a yield changes nothing but who runs next.
 *
 * Rules for a generator of this kind:
 *  - a `yield` is placed where the computation holds all its state in local variables and in the objects it owns, so
 *    that whatever the driver does in between (it may run other code, or drop the generator for good with `return()`)
 *    cannot make the continuation differ;
 *  - it does not read the clock or anything else that makes the result depend on when it is resumed: whether to stop
 *    at a yield is the driver's decision (Simulation.advance, `yieldWhen`), the generator only offers the points.
 */
export type Slices<T> = Generator<void, T, void>;

/** Runs a resumable computation to its end without ever suspending it, and returns its result. */
export function runSlices<T>(g: Slices<T>): T {
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}
