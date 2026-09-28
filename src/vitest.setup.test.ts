/**
 * The pre-test wait of src/vitest.setup.ts: it keeps the worker's RPC channel drained while a test body runs
 * (root cause and reproduction: the header of the setup file). Measured through the gap between the last
 * afterEach hook of one test (a file-level afterEach runs before the setup file's) and the first beforeEach hook
 * of the next test (a file-level beforeEach runs after the setup file's).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('vitest setup: a real-time wait before every test', () => {
  let leftPrevious = NaN;
  let gap = NaN;
  beforeEach(() => { gap = performance.now() - leftPrevious; });
  afterEach(() => { leftPrevious = performance.now(); });

  it('first test (records when it ends)', () => { expect(true).toBe(true); });

  it('the next test starts at least one timer tick (15 ms) later', () => {
    expect(Number.isFinite(gap)).toBe(true);
    expect(gap).toBeGreaterThanOrEqual(15);
  });
});

describe('vitest setup: fake timers left installed by a test do not stall the next one', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterAll(() => { vi.useRealTimers(); });

  // the setup file waits with real timers captured before any fake ones; with the global fake setTimeout the
  // next test would never start (and time out)
  it('a test that leaves fake timers on', () => { expect(vi.isFakeTimers()).toBe(true); });
  it('the following test still runs', () => { expect(vi.isFakeTimers()).toBe(true); });
});
