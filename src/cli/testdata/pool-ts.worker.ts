// TypeScript worker fixture for pool.test.ts: a type annotation and an extensionless relative import, as in the
// real *.worker.ts files. Native type stripping cannot resolve './pool-ts-dep', so this loads only through tsx.
import { parentPort } from 'node:worker_threads';
import { triple } from './pool-ts-dep';

interface Task { id: string; v: number }

parentPort!.on('message', (task: Task) => parentPort!.postMessage({ id: task.id, v: triple(task.v) }));
