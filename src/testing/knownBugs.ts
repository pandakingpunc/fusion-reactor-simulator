/**
 * Switches for BUG(ws2a) pins whose state differs between code versions.
 *
 * A pin is an `it.fails` test: it passes while the bug is present and turns red once the bug is fixed,
 * so the fixer flips it to `it` and the test becomes a regression test. When the fix lands on another
 * lane's branch first, this lane's tests must pass on both sides of the merge; pinUntil(fixed)
 * (./pinUntil.ts) picks `it` or `it.fails` from a switch below, which is decided WITHOUT running the
 * pinned reproduction (keying the pin on its own reproduction would make it pass whatever the code does).
 * This module does not import vitest, so the wizard case generator can use it outside the test runner.
 */
import { DormandPrince } from '../physics/integrator';

/**
 * Both integrator findings (a NaN error norm gives a NaN step size and a NaN state is accepted;
 * `nonNegative: number[]` never clamps) are fixed by ws5 in dafd2bf "fix(integrator): clamp array
 * nonNegative, reject non-finite states, snapshot/restore" — on v4/integration, not on this lane's base
 * 3d04e96. That commit also added DormandPrince.snapshot(), which tells the two versions apart. Once
 * v4/integration contains this lane, the switch can be dropped in favour of plain `it`.
 */
export const INTEGRATOR_FIXED = typeof (DormandPrince.prototype as unknown as Record<string, unknown>).snapshot === 'function';
