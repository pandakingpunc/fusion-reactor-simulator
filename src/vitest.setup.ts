// Vitest setup file (vite.config.ts test.setupFiles): keep the worker's RPC channel drained around every test.
//
// ROOT CAUSE of `[vitest-worker]: Timeout calling "onTaskUpdate"` (unhandled error, exit code 1 with every test
// green, seen under `npm run coverage`). A Vitest worker reports progress to the main process with RPC calls whose
// replies must arrive within 60 s (birpc's default; Vitest 3 exposes no option). The runner sends one when a test
// starts and one when it ends. The reply travels over the worker's IPC channel and is read only when the worker's
// event loop turns; the 60 s timer is an ordinary timer of the same loop. A test that computes synchronously for
// longer than that (the 'cgm' smoke test of transport.test.ts: 64 s under coverage) keeps the loop blocked with the
// start-of-test call still unanswered, so at the first turn after the test the timer, which is served before I/O,
// fires before the reply is read. Reproduced with a single 70 s busy-loop test: it fails without this file's
// pre-test wait and passes with it.
//
// FIX. Wait a few real milliseconds before every test body: the update sent when the test started (and the one of
// the test before it) is answered and read by then, so no call is pending while the body runs, however long it
// blocks the loop. The end-of-test call is answered during the next test's wait. A turn of the event loop after
// every test (setImmediate) keeps the gap between two waits short in files of many tests. The cost is about 15 ms
// per test (Windows timers tick at 15.6 ms), 10-15 s of idle time over the whole suite.
//
// It does not shorten anything: a test that blocks for minutes still blocks its worker for minutes (and one that
// yields is still bound by its test timeout, see the `coverage` script), it just no longer fails the run.
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach } from 'vitest';

/** real-time wait before each test body [ms]: longer than the main process needs to answer a task update */
const DRAIN_MS = 20;

// Captured when the setup file loads, before any test can install fake timers (vi.useFakeTimers); the node:timers
// promise API is not touched by them either.
const yieldToEventLoop: (resolve: () => void) => void =
  typeof setImmediate === 'function' ? setImmediate : (resolve) => setTimeout(resolve, 0);

beforeEach(() => delay(DRAIN_MS));
afterEach(() => new Promise<void>((resolve) => yieldToEventLoop(resolve)));
