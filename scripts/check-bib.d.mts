export interface BibEntry { key: string; body: string }
export function bibliographyEntries(bib: string): BibEntry[];
export function checkBibliography(md: string, bib: string): { errors: string[]; words: number; entries: number; citations: number };
