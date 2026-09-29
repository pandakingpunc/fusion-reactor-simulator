/**
 * The persistence UI's contact with the outside world, in one object that tests replace: the browser archive, the
 * re-simulation, the clipboard, the page address and file download. The defaults are the browser's.
 */
import { createContext, useContext } from 'react';
import { ArchiveError, RunArchive } from './archive';
import { replayInWorker, ReplayFn } from './replay';

export interface PersistDeps {
  /** the browser archive, opened once and reused; rejects with ArchiveError when the browser has none */
  archive(): Promise<RunArchive>;
  replay: ReplayFn;
  /** put text on the clipboard; rejects when the browser refuses */
  copy(text: string): Promise<void>;
  /** the address of this page without any fragment: what share links are built on */
  baseUrl(): string;
  /** offer a text file for download */
  download(name: string, text: string, mime: string): void;
}

function downloadText(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

export function createPersistDeps(over: Partial<PersistDeps> = {}): PersistDeps {
  let archive: Promise<RunArchive> | null = null;
  return {
    archive() {
      // a failed open is not remembered: the next call tries again (a blocking tab may have closed)
      archive ??= RunArchive.open().catch((e) => { archive = null; throw e; });
      return archive;
    },
    replay: replayInWorker,
    copy: async (text) => {
      if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
    },
    baseUrl: () => `${window.location.origin}${window.location.pathname}${window.location.search}`,
    download: downloadText,
    ...over,
  };
}

let defaults: PersistDeps | null = null;
export const PersistDepsContext = createContext<PersistDeps | null>(null);

/** The dependencies of this application instance (the browser's, unless a test provided others). */
export function usePersistDeps(): PersistDeps {
  return useContext(PersistDepsContext) ?? (defaults ??= createPersistDeps());
}

export const errorText = (e: unknown): string => (e instanceof ArchiveError || e instanceof Error ? e.message : String(e));
