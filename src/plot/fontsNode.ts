/// <reference types="node" />
/**
 * Node font provider: reads the STIX Two TTF files from assets/fonts/stix-two with fs.
 * Not imported by browser code (the web app uses the fetch-based provider in exportFigures.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_FILES, FONT_KEYS, FontKey, FontProvider, FontSet } from './fonts';

/** assets/fonts/stix-two, resolved relative to this module */
export const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/stix-two/', import.meta.url));

export function nodeFontProvider(dir: string = FONT_DIR): FontProvider {
  return (file) => new Uint8Array(readFileSync(join(dir, file)));
}

let cached: FontSet | null = null;

/** The four STIX Two faces, read synchronously and parsed once per process. */
export function nodeFontSet(dir: string = FONT_DIR): FontSet {
  if (cached && dir === FONT_DIR) return cached;
  const bytes: Partial<Record<FontKey, Uint8Array>> = {};
  for (const k of FONT_KEYS) bytes[k] = new Uint8Array(readFileSync(join(dir, FONT_FILES[k])));
  const fs = FontSet.fromBytes(bytes);
  if (dir === FONT_DIR) cached = fs;
  return fs;
}
