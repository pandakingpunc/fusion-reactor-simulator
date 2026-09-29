import { ComponentType, ReactElement, createElement } from 'react';

/**
 * A component in a chunk of its own, loaded on first use. Unlike `React.lazy` it renders synchronously once the chunk has
 * arrived (a second mount, or a caller that awaited `preload()` first, never suspends), and a failed load is thrown as an
 * error at the next render, where the nearest error boundary shows it, instead of being retried in a loop.
 *
 * The screens that are not on the first paint (the run screen, the report) use it, so that the main chunk keeps only what the
 * setup screen needs; `preload()` fetches the chunk ahead of the click.
 */
export interface LazyChunk<P> {
  (props: P): ReactElement;
  /** start loading (idempotent); resolves when the component can render, also when the load failed (the error is thrown on render) */
  preload(): Promise<void>;
}

export function lazyChunk<M, P extends object>(load: () => Promise<M>, pick: (m: M) => ComponentType<P>): LazyChunk<P> {
  let component: ComponentType<P> | null = null;
  let failure: unknown = null;
  let pending: Promise<void> | null = null;
  const preload = (): Promise<void> => (pending ??= load().then(
    (m) => { component = pick(m); },
    (e: unknown) => { failure = e ?? new Error('chunk failed to load'); },
  ));
  const Lazy = ((props: P) => {
    if (component) return createElement(component, props);
    if (failure) throw failure;
    throw preload(); // Suspense waits for it and renders again
  }) as unknown as LazyChunk<P>;
  Lazy.preload = preload;
  return Lazy;
}
