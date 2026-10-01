#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read balanced BibTeX entries, including nested braces in titles and author names. */
export function bibliographyEntries(bib) {
  const entries = [];
  const start = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  for (let m; (m = start.exec(bib));) {
    let depth = 1, i = start.lastIndex;
    for (; i < bib.length && depth; i++) {
      if (bib[i] === '\\') { i++; continue; }
      if (bib[i] === '{') depth++;
      if (bib[i] === '}') depth--;
    }
    if (depth) throw new Error(`unclosed bibliography entry ${m[2]}`);
    entries.push({ key: m[2], body: bib.slice(start.lastIndex, i - 1) });
    start.lastIndex = i;
  }
  return entries;
}

export function checkBibliography(md, bib) {
  const errors = [];
  const entries = bibliographyEntries(bib);
  const keys = entries.map(e => e.key);
  const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/<!--[\s\S]*?-->/g, '');
  const cited = new Set([...body.matchAll(/@([\w:-]+)/g)].map(m => m[1]));
  for (const key of cited) if (!keys.includes(key)) errors.push(`missing bibliography entry ${key}`);
  for (const entry of entries) {
    if (keys.filter(k => k === entry.key).length > 1) errors.push(`duplicate bibliography entry ${entry.key}`);
    if (!cited.has(entry.key)) errors.push(`unused bibliography entry ${entry.key}`);
    if (!/\b(?:doi|url)\s*=\s*[{"][^}"]+/.test(entry.body)) errors.push(`${entry.key} needs a DOI or URL`);
  }
  // Count rendered prose; include marker values, exclude headings and citation keys.
  const prose = body.replace(/^#.*$/gm, '').replace(/\[@[^\]]*\]/g, '').replace(/@[\w:-]+/g, '');
  const words = prose.match(/\S+/g)?.length ?? 0;
  if (words < 750 || words > 1000) errors.push(`body has ${words} words; expected 750–1000`);
  if (!/^---\r?\n/.test(md) || !/\bbibliography:\s*paper\.bib/.test(md)) errors.push('missing JOSS front matter or bibliography');
  return { errors, words, entries: entries.length, citations: cited.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = checkBibliography(readFileSync(resolve(root, 'paper/paper.md'), 'utf8'), readFileSync(resolve(root, 'paper/paper.bib'), 'utf8'));
  console.log(`paper bibliography: ${result.words} body words, ${result.entries} entries, ${result.citations} cited keys`);
  for (const error of result.errors) console.error(error);
  process.exitCode = result.errors.length ? 1 : 0;
}
