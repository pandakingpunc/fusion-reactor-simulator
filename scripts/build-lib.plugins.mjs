// Vite plugins of scripts/build-lib.mjs (in a file of their own so that a test can run them on a fixture).
/**
 * src/cli/provenance.ts has `new URL('../../', import.meta.url)` (the package root of the figure scripts). Vite's asset
 * plugin resolves such a directory reference at build time, and for a directory it reads package.json `main`: with the
 * exports patch in place and an earlier build/lib/index.cjs on disk it inlined that file as a data: URL and the
 * compiled CLI died at start-up. The CLI always passes its package root explicitly, so the expression is only a
 * default value; `import.meta['url']` is the same value at run time and is not matched by the asset plugin, whatever
 * package.json says.
 */
export const rootUrlPlugin = {
  name: 'fusion-sim-root-url',
  enforce: 'pre',
  transform(code, id) {
    if (!/(?:^|[\\/])src[\\/]cli[\\/]provenance\.ts$/.test(id.split('?')[0])) return null;
    const from = "new URL('../../', import.meta.url)";
    if (!code.includes(from)) throw new Error('build-lib: src/cli/provenance.ts no longer contains ' + from + '; update rootUrlPlugin');
    return { code: code.replace(from, "new URL('../../', import.meta['url'])"), map: null };
  },
};

