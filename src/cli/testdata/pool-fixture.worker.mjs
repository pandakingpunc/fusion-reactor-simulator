// Worker fixture for pool.test.ts: behaviour is chosen per task.
import { parentPort } from 'node:worker_threads';

parentPort.on('message', (task) => {
  switch (task.action) {
    case 'double': parentPort.postMessage({ id: task.id, v: task.v * 2 }); break;
    case 'throw': throw new Error(`boom in ${task.id}`);
    case 'exit': process.exit(task.code);
    default: parentPort.postMessage({ id: task.id, v: null });
  }
});
