/**
 * Simülasyon worker'ı: fizik burada koşar, UI bloklanmaz.
 * Mesaj işleme host.ts'te (protokol v2); bu dosya yalnızca onu worker kapsamına bağlar.
 */
import { createSimHost } from './host';
import { FromWorker, ToWorker } from './protocol';

const host = createSimHost((m: FromWorker) => (self as unknown as Worker).postMessage(m));

self.onmessage = (e: MessageEvent<ToWorker>) => host.handle(e.data);
