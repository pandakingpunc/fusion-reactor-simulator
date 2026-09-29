/**
 * POPCON worker: the steady-state operating map is computed here, off the page's thread.
 * Message handling is in popconHost.ts (protocol in popconProtocol.ts); this file only wires it to the worker scope.
 */
import { createPopconHost } from './popconHost';
import type { FromPopcon, ToPopcon } from './popconProtocol';

const host = createPopconHost((m: FromPopcon, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []));

self.onmessage = (e: MessageEvent<ToPopcon>) => host.handle(e.data);
