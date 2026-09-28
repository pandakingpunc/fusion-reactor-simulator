/** Chooses between a BUG(ws2a) pin and a plain test from a switch in ./knownBugs.ts. */
import { it } from 'vitest';

/** `it` where the fix is present (a regression test), `it.fails` where the bug is still expected */
export function pinUntil(fixed: boolean): typeof it {
  return (fixed ? it : it.fails) as typeof it;
}
