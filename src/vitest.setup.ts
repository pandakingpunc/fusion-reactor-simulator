// Vitest setup file (vite.config.ts test.setupFiles): let the test worker's event loop turn once
// after every test.
//
// A Vitest worker reports progress to the main process over an RPC channel whose calls time out
// after 60 s (birpc's default, not configurable in Vitest 3). Between synchronous tests the runner
// continues on microtasks only, so the reply to a task update is not read until the worker's event
// loop turns again. A file of synchronous tests that runs for more than 60 s in total therefore
// fails with 'Timeout calling "onTaskUpdate"' as an unhandled error although every test passed; the
// run-replay suites in src/physics/kernel/determinism*.test.ts take 40-75 s under `npm run coverage`
// or on a loaded machine. One macrotask turn after each test bounds the gap by the longest single
// test and costs well under a millisecond per test.
import { afterEach } from 'vitest';

// Captured when the setup file loads, before any test can install fake timers (vi.useFakeTimers).
const yieldToEventLoop: (resolve: () => void) => void =
  typeof setImmediate === 'function' ? setImmediate : (resolve) => setTimeout(resolve, 0);

afterEach(() => new Promise<void>((resolve) => yieldToEventLoop(resolve)));
