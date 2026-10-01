// Worker fixture for pool.test.ts: behaviour is chosen per task.
//   echo    replies with the task itself          double  replies { id, v: 2v }
//   slow    replies { id, v } after task.ms       hang    never replies (idle event loop)
//   spin    never replies (busy loop)             throw   uncaught exception
//   crash   process.exit(task.code ?? 1)          exit    same as crash (v3 name)
//   twice   replies { id, v: 2v }, then once more { id, v: -1 } (a worker that breaks the one-reply contract)
//   throwString   uncaught exception whose value is a string, not an Error object
import { parentPort } from 'node:worker_threads';

parentPort.on('message', (task) => {
  switch (task.action) {
    case 'echo': parentPort.postMessage(task); break;
    case 'double': parentPort.postMessage({ id: task.id, v: task.v * 2 }); break;
    case 'slow': setTimeout(() => parentPort.postMessage({ id: task.id, v: task.v }), task.ms); break;
    case 'hang': break;
    case 'twice': parentPort.postMessage({ id: task.id, v: task.v * 2 }); parentPort.postMessage({ id: task.id, v: -1 }); break;
    case 'throwString': throw `plain string thrown in ${task.id}`;
    case 'spin': for (;;) { /* busy: only terminate() stops it */ }
    case 'throw': throw new Error(`boom in ${task.id}`);
    case 'crash':
    case 'exit': process.exit(task.code ?? 1);
    default: parentPort.postMessage({ id: task.id, v: null });
  }
});
