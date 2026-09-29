/**
 * Worker that re-runs a run from its inputs (replayCore.ts) off the main thread, so that checking an imported file
 * or opening a shared run does not freeze the page. One run per worker: the page terminates it when done or cancelled.
 */
import { handleReplayMessage, ReplayFromWorker, ReplayToWorker } from './replayCore';

self.onmessage = (e: MessageEvent<ReplayToWorker>) => handleReplayMessage(e.data, (m: ReplayFromWorker) => (self as unknown as Worker).postMessage(m));
