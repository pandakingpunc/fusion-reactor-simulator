/// <reference types="node" />
/**
 * Worker thread for bench/pause-latency.ts: the real protocol host (createSimHost) behind a message port, the
 * way sim.worker.ts wires it to a browser Worker. Written against the host's public API only (createSimHost(post)),
 * so the bench can be pointed at a checkout of an older commit to measure "before".
 */
import { parentPort } from 'node:worker_threads';
import { createSimHost } from '../src/worker/host';
import type { FromWorker, ToWorker } from '../src/worker/protocol';

const host = createSimHost((m: FromWorker) => parentPort!.postMessage(m));
parentPort!.on('message', (m: ToWorker) => host.handle(m));
