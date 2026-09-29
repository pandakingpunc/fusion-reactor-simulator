/// <reference types="node" />
/**
 * Responsiveness of the simulation worker's playback loop:
 *   node node_modules/tsx/dist/cli.mjs bench/pause-latency.ts [--mode thread|tasks|both] [--presets DEMO15,ITER15] [--speeds 1,30,100] [--seconds 4]
 *
 * The worker is one thread: a `pause`, `control` or `rewind` message posted to it is handled when the task that is
 * running ends, so the time a request waits is the longest uninterrupted stretch of computation. Two measurements:
 *
 *  - thread: the real protocol host (createSimHost, real physics) in a worker thread (bench/pause-latency.worker.ts)
 *    in autoplay at each speed. At random moments the main thread posts a request and times the reply. The protocol
 *    has no reply to `pause`, so the request is `rewind` to the last frame: the host handles it exactly like a pause
 *    (stops the loop) and answers `rewound`, and the playback is resumed with `play` afterwards. The wait is the
 *    latency of a pause, including the thread hop (about 0.1 ms).
 *  - tasks: the same host in this thread, with chained setImmediate probes standing in for a message from the page:
 *    the loop never sleeps, so the gap between two consecutive probes is the length of the task the host ran in
 *    between, and a message arriving at the start of that task would have waited that long. Gaps below 1 ms are the
 *    spinner itself and are not counted. Finally a real `pause` is issued and the host must post nothing after it.
 *
 * Timings depend on the machine and its load (on a shared machine the tail is noisy), so compare the numbers of two
 * runs made back to back on the same machine, e.g. this file against a checkout of an older commit (copy the two
 * bench/pause-latency*.ts files there: they use only the host's createSimHost(post)). The spinner of the tasks mode
 * keeps one core busy while it runs. Not part of ci:local.
 */
import { Worker } from 'node:worker_threads';
import { defineCli, parseArgsOrExit } from '../src/cli/args';
import { PRESETS } from '../src/physics/presets';
import { createSimHost } from '../src/worker/host';
import { FromWorker, PROTOCOL_VERSION, ToWorker } from '../src/worker/protocol';

const CLI = defineCli({
  name: 'bench/pause-latency.ts',
  summary: 'How long a message to the simulation worker can wait behind the playback loop, per preset and speed.',
  flags: {
    mode: { type: 'string', default: 'both', choices: ['thread', 'tasks', 'both'], help: 'thread: request latency in a worker thread; tasks: task lengths of the loop in this thread' },
    presets: { type: 'list', default: ['DEMO15', 'ITER15'], metavar: 'ID,…', help: 'preset ids (JET15 is left out: its Grad-Shafranov update at t = 0.68 s is one 1.3 s step, which no host can slice)' },
    speeds: { type: 'list', default: ['1', '30', '100'], metavar: 'X,…', help: 'playback speeds' },
    seconds: { type: 'number', default: 4, min: 0.5, max: 120, metavar: 'S', help: 'wall time of each measurement' },
  },
});

const pct = (sorted: number[], f: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : NaN);
const preset = (id: string) => {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown preset ${id}`);
  return p;
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** request latency of a pause in a real worker thread */
async function measureThread(id: string, speed: number, seconds: number) {
  const worker = new Worker(new URL('./pause-latency.worker.ts', import.meta.url));
  let waiting: ((m: FromWorker) => boolean) | null = null;
  let onReply: (() => void) | null = null;
  let frames = 0, done = false, failed = '';
  worker.on('message', (m: FromWorker) => {
    if (m.type === 'frames') frames += m.frames.length;
    else if (m.type === 'done') done = true;
    else if (m.type === 'error') failed = m.msg;
    if (waiting?.(m)) { waiting = null; onReply?.(); }
  });
  worker.on('error', (e) => { failed = String(e); onReply?.(); });
  const post = (m: ToWorker) => worker.postMessage(m);
  const wait = (match: (m: FromWorker) => boolean) => new Promise<void>((resolve) => { waiting = match; onReply = resolve; });

  const ready = wait((m) => m.type === 'ready');
  post({ type: 'init', protocolVersion: PROTOCOL_VERSION, id: 1, cfg: preset(id).cfg, autoPlay: true, speed });
  await ready;

  const lat: number[] = [];
  let branch = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < seconds * 1000 && !done && !failed) {
    await sleep(40 + Math.random() * 160); // the worker computes meanwhile
    if (done || failed) break;
    const b = ++branch;
    const reply = wait((m) => m.type === 'rewound' && m.branchId === b);
    const t1 = performance.now();
    post({ type: 'rewind', index: 1e9, branchId: b });
    await reply;
    lat.push(performance.now() - t1);
    post({ type: 'play', speed });
  }
  await worker.terminate();
  lat.sort((a, b) => a - b);
  return { id, speed, requests: lat.length, frames, p50: pct(lat, 0.5), p95: pct(lat, 0.95), p99: pct(lat, 0.99), max: lat[lat.length - 1] ?? NaN, done, failed };
}

/** task lengths of the playback loop, in this thread */
async function measureTasks(id: string, speed: number, seconds: number) {
  let frames = 0, messages = 0, done = false, failed = '';
  const host = createSimHost((m: FromWorker) => {
    messages++;
    if (m.type === 'frames') frames += m.frames.length;
    else if (m.type === 'done') done = true;
    else if (m.type === 'error') failed = m.msg;
  });
  const tInit0 = performance.now();
  host.handle({ type: 'init', protocolVersion: PROTOCOL_VERSION, id: 1, cfg: preset(id).cfg, autoPlay: true, speed });
  const initMs = performance.now() - tInit0;

  const gaps: number[] = [];
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    let last = performance.now();
    const probe = () => {
      const now = performance.now();
      if (now - last >= 1) gaps.push(now - last);
      last = now;
      if (now - t0 >= seconds * 1000 || done || failed) return resolve();
      setImmediate(probe);
    };
    setImmediate(probe);
  });

  // a real pause: once the host has handled it (it posts the frames it still holds back, synchronously), nothing more may come
  host.handle({ type: 'pause' });
  const before = messages;
  await sleep(120);
  const afterPause = messages - before;
  host.dispose();

  gaps.push(0);
  gaps.sort((a, b) => a - b);
  return { id, speed, initMs, frames, messages, tasks: gaps.length - 1, p50: pct(gaps, 0.5), p95: pct(gaps, 0.95), p99: pct(gaps, 0.99), max: gaps[gaps.length - 1], afterPause, done, failed };
}

async function main() {
  const args = parseArgsOrExit(CLI);
  const note = (r: { done: boolean; failed: string }) => `${r.done ? ' (run ended)' : ''}${r.failed ? ` ERROR ${r.failed.slice(0, 60)}` : ''}`;
  if (args.mode !== 'tasks') {
    console.log(`pause latency of the simulation worker (request to reply in a worker thread), ${args.seconds} s per row, Node ${process.version}`);
    console.log('| preset | speed | requests | frames | wait p50 [ms] | p95 | p99 | max |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const id of args.presets) {
      for (const s of args.speeds) {
        const r = await measureThread(id, Number(s), args.seconds);
        console.log(`| ${r.id} | ${r.speed}x | ${r.requests} | ${r.frames} | ${r.p50.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.p99.toFixed(1)} | ${r.max.toFixed(1)} |${note(r)}`);
      }
    }
  }
  if (args.mode !== 'thread') {
    if (args.mode === 'both') console.log('');
    console.log(`task lengths (>= 1 ms) of the playback loop in this thread, ${args.seconds} s per row, Node ${process.version}`);
    console.log('| preset | speed | init [ms] | frames | tasks | task p50 | p95 | p99 | max [ms] | msgs after pause |');
    console.log('|---|---|---|---|---|---|---|---|---|---|');
    for (const id of args.presets) {
      for (const s of args.speeds) {
        const r = await measureTasks(id, Number(s), args.seconds);
        console.log(`| ${r.id} | ${r.speed}x | ${r.initMs.toFixed(0)} | ${r.frames} | ${r.tasks} | ${r.p50.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.p99.toFixed(1)} | ${r.max.toFixed(1)} | ${r.afterPause}${note(r)} |`);
      }
    }
  }
}

main();
