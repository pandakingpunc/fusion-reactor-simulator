/**
 * Random configurations reachable through the setup wizard (src/ui/wizard/schema.ts, read-only):
 * start from any preset of a method (the preset list or the method card), then change any subset of
 * the fields the wizard shows for that method, each to a value its control can produce:
 *  - number fields: anywhere in [min, max] (UI units × scale); integer-step fields on the slider
 *    lattice min + k·step; ranges spanning ≥ 2 decades are drawn log-uniformly;
 *  - select fields: any option; the empty option (e.g. seeding "none") is recorded as NONE and
 *    written as undefined, as Field.tsx does;
 *  - bool fields: on/off.
 * Fields are applied in schema order and only while visible (fieldVisible), exactly like the UI,
 * where e.g. the 1.5D fields appear only after "Model fidelity" is set to 1.5D.
 * Shrinking drops edits first (back to the preset value), then simplifies the remaining values.
 */
import type { Method, ReactorConfig } from '../physics/types';
import { FieldDef, PRESETS, fieldVisible, setPath, stepsFor } from '../ui/wizard/schema';
import { Arbitrary, gen } from './prop';

/** the empty select option ("none"); an absent edit is plain undefined */
export const NONE = '<none>';

export interface WizardCase {
  method: Method;
  preset: string;
  edits: Record<string, unknown>;
}

/** every field the wizard can show for a method, schema order, one entry per path */
export function wizardFields(method: Method): FieldDef[] {
  const seen = new Set<string>();
  const out: FieldDef[] = [];
  for (const step of stepsFor(method)) for (const f of step.fields) if (!seen.has(f.path)) { seen.add(f.path); out.push(f); }
  return out;
}

/** the values one field's control can produce, in configuration units */
export function fieldArbitrary(f: FieldDef): Arbitrary<unknown> {
  const type = f.type ?? 'number';
  if (type === 'bool') return gen.bool();
  if (type === 'select') return gen.oneOf((f.options ?? []).map((o) => (o.value === '' ? NONE : o.value)));
  const scale = f.scale ?? 1;
  const lo = f.min ?? 0, hi = f.max ?? lo + 1;
  const step = f.step ?? 0;
  let ui: Arbitrary<number>;
  if (step >= 1 && Number.isInteger(step) && Number.isInteger(lo)) {
    const k = gen.int(0, Math.floor((hi - lo) / step));
    ui = { generate: (r) => lo + step * k.generate(r), *shrink(v) { for (const c of k.shrink(Math.round((v - lo) / step))) yield lo + step * c; } };
  } else if (lo > 0 && hi / lo >= 100) ui = gen.logFloat(lo, hi);
  else ui = gen.float(lo, hi, { target: Math.max(lo, Math.min(hi, 0)) });
  return { generate: (r) => ui.generate(r) * scale, *shrink(v) { for (const c of ui.shrink((v as number) / scale)) yield c * scale; } };
}

/**
 * Arbitrary wizard case for a method. `pEdit` is the probability that a field is changed;
 * `force` pins fields (e.g. { fidelity: '1.5D' }) and removes them from the random edits.
 */
export function wizardCase(method: Method, pEdit = 0.5, force: Record<string, unknown> = {}): Arbitrary<WizardCase> {
  const presets = PRESETS.filter((p) => p.cfg.method === method).map((p) => p.id);
  if (!presets.length) throw new Error(`no preset for ${method}`);
  const shape: Record<string, Arbitrary<unknown>> = {};
  for (const f of wizardFields(method)) if (!(f.path in force)) shape[f.path] = gen.optional(fieldArbitrary(f), pEdit);
  const edits = gen.record(shape);
  const preset = gen.oneOf(presets);
  return {
    generate: (r) => ({ method, preset: preset.generate(r), edits: { ...edits.generate(r), ...force } }),
    *shrink(c) {
      const free = Object.fromEntries(Object.entries(c.edits).filter(([k]) => !(k in force)));
      for (const e of edits.shrink(free as Record<string, unknown>)) yield { ...c, edits: { ...e, ...force } };
      for (const p of preset.shrink(c.preset)) yield { ...c, preset: p };
    },
  };
}

/** the configuration the wizard would hand to the simulator */
export function buildConfig(c: WizardCase): ReactorConfig {
  const p = PRESETS.find((x) => x.id === c.preset);
  if (!p) throw new Error(`unknown preset ${c.preset}`);
  let cfg = p.cfg;
  for (const f of wizardFields(c.method)) {
    if (!(f.path in c.edits)) continue;
    const v = c.edits[f.path];
    if (v === undefined) continue; // field left as the preset has it
    if (!fieldVisible(c.method, f.path, cfg)) continue;
    cfg = setPath(cfg, f.path, v === NONE ? undefined : v);
  }
  return cfg;
}

/** compact description of a case for failure messages: only the edits actually present */
export function showCase(c: unknown): string {
  const w = c as WizardCase;
  const e = Object.entries(w.edits).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(6) : String(v)}`);
  return `${w.method} from ${w.preset}${e.length ? ': ' + e.join(', ') : ' (unchanged)'}`;
}
