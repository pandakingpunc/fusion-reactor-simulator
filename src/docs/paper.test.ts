/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkBibliography } from '../../scripts/check-bib.mjs';
import { checkText, checkValidateRecord, checkConvergenceRecord, fileSources, findMarkers, writeText } from '../../scripts/paper-numbers';

const src = fileSources();
const md = src.text('paper/paper.md');
const bib = readFileSync(new URL('../../paper/paper.bib', import.meta.url), 'utf8');

describe('JOSS submission package', () => {
  it('anchors all measured numbers and records to the golden files and reference table', () => {
    expect(checkValidateRecord(src.validate(), src)).toEqual([]);
    expect(checkConvergenceRecord(src.convergence(), src)).toEqual([]);
    expect(findMarkers(md).length).toBeGreaterThan(30);
    expect(checkText(md, src)).toEqual([]);
    expect(writeText(md, src)).toBe(md);
  });
  it('rejects a falsified result, an unmarked claim and a stale record', () => {
    expect(checkText(md.replace('<!--num:ITER15.Q-->10.45', '<!--num:ITER15.Q-->99.99'), src).join('\n')).toContain('ITER15.Q');
    expect(checkText(md + '\nAn unsupported value is 123.45.\n', src).join('\n')).toContain('unmarked');
    const rec = structuredClone(src.validate());
    rec.checks[0].value *= 2;
    expect(checkValidateRecord(rec, src).length).toBeGreaterThan(0);
  });
  it('has a complete used bibliography and the required body length', () => {
    expect(checkBibliography(md, bib).errors).toEqual([]);
  });
  it('rejects missing, duplicate, unused and untraceable citations', () => {
    expect(checkBibliography(md + '\n[@missing]\n', bib).errors.join('\n')).toContain('missing');
    expect(checkBibliography(md, bib + '\n@article{extra, title={Unused}}').errors.join('\n')).toContain('unused');
    expect(checkBibliography(md, bib.replace(/\bdoi\s*=/g, 'unverified =').replace(/\burl\s*=/g, 'unverified =')).errors.join('\n')).toContain('needs a DOI or URL');
    expect(checkBibliography(md, bib + bib).errors.join('\n')).toContain('duplicate');
  });
});
