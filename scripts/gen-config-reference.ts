/// <reference types="node" />
/**
 * Writes docs/config-reference.md, the human-readable reference of every configuration field, from the two
 * generated JSON Schemas (schema/fusion-sim.schema.json: the reactor configuration, and
 * schema/scenario.schema.json: the scenario). Nothing is written by hand and nothing is read from the
 * source tree: type, unit, default, range and description of a field are the ones the schema declares, so
 * the reference cannot drift from what the validator accepts as long as `npm run schema` is current.
 *
 *   npx tsx scripts/gen-config-reference.ts            write docs/config-reference.md
 *   npx tsx scripts/gen-config-reference.ts --check    exit 1 if the file on disk differs from what is generated
 *   npx tsx scripts/gen-config-reference.ts --out FILE write to (or, with --check, compare with) FILE instead
 *
 * Exit codes: 0 done / up to date, 1 stale or missing (--check), 2 usage error. The file is LF-terminated;
 * --check and the test in src/cli/configReference.test.ts compare with line endings normalised (a checkout
 * with core.autocrlf may turn it into CRLF).
 *
 * The opt-in modules of the 1.5D profile model (OPT_IN_MODULES) and the grouping of the profile settings
 * (PROFILE_GROUPS) are the only curated parts; the default and the alternatives of every module are read from
 * the schema, and the generator fails loudly if a curated key no longer exists there.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The schemas are plain JSON of a known but wide shape; a loose node type keeps the walker short.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Node = Record<string, any>;

/** An opt-in module of the 1.5D profile model: a switch whose default reproduces the v3 behaviour. */
export interface OptInModule {
  /** Short name of the module. */
  readonly label: string;
  /** Path of the switch in the reactor configuration. */
  readonly key: string;
  /** What the switch decides, one line. */
  readonly summary: string;
  /**
   * Settings that only act when the module is switched on, relative to `profiles`, with the text that the
   * description of each of them must contain (the gate value), so that this list cannot go stale unnoticed.
   */
  readonly settings?: readonly { readonly key: string; readonly gate: string }[];
}

export const OPT_IN_MODULES: readonly OptInModule[] = [
  {
    label: '1.5D profile model',
    key: 'fidelity',
    summary: 'Radial transport with a Grad-Shafranov equilibrium instead of the global power balance. Every module below needs it.',
  },
  {
    label: 'Predictive transport',
    key: 'profiles.transportModel',
    summary: 'Critical-gradient, Bohm/gyro-Bohm or IFS-PPPL closure instead of the tau_E-constrained transport.',
  },
  {
    label: 'EPED1-type pedestal',
    key: 'profiles.pedestalModel',
    summary: 'Pedestal width and height from the KBM and peeling-ballooning constraints.',
    settings: [
      { key: 'pedPbGradient', gate: 'eped1' },
      { key: 'pedKbmCoefficient', gate: 'eped1' },
      { key: 'pedDensityExponent', gate: 'eped1' },
    ],
  },
  {
    label: 'ELM energy loss',
    key: 'profiles.elmLoss',
    summary: 'Energy removed by an ELM from the pedestal collisionality (Loarte et al.) instead of a fixed fraction.',
  },
  {
    label: 'Impurity and helium-ash transport',
    key: 'profiles.impurityTransport',
    summary: 'Profile-resolved impurities and helium ash (anomalous or FACIT) instead of scalar inventories.',
    settings: [
      { key: 'impurityDoverDe', gate: 'impurityTransport' },
      { key: 'impurityPinchOverPe', gate: 'impurityTransport' },
      { key: 'impurityExtraSpecies', gate: 'profile-resolved' },
      { key: 'impurityExtraConcentration', gate: 'third species' },
    ],
  },
  {
    label: 'Fast-ion model',
    key: 'profiles.fastIonModel',
    summary: 'Fast-ion energy profiles with slowing-down delay and orbit smoothing instead of two scalar pools.',
    settings: [{ key: 'fastOrbitScale', gate: "'profile'" }],
  },
  {
    label: 'Current-drive model',
    key: 'profiles.cdModel',
    summary: 'NBCD from the fast-ion current and ECCD from a launcher model instead of the efficiency factors.',
    settings: [{ key: 'eccd', gate: "'physics'" }],
  },
  {
    label: 'Sawtooth trigger',
    key: 'profiles.sawtoothTrigger',
    summary: 'The Porcelli-Boucher-Rosenbluth conditions instead of the critical shear at q = 1.',
  },
  {
    label: 'Sawtooth reconnection',
    key: 'profiles.sawtoothReconnection',
    summary: "Kadomtsev's full reconnection with a poloidal-flux reset instead of the flattening only.",
  },
  {
    label: 'Neoclassical coefficients',
    key: 'profiles.neoclassicalModel',
    summary: 'Redl et al. bootstrap and conductivity coefficients instead of Sauter et al. (an alternative, not an addition).',
  },
  {
    label: 'Edge model for the separatrix temperature',
    key: 'profiles.edgeModel',
    summary: 'Two-point T_sep from the edge model (Eich lambda_q, divertor spreading) instead of the conduction-limited estimate.',
  },
];

/**
 * Enum settings of `profiles` that have a default but are not opt-in modules of the v4 model (a numerical or
 * placement choice, not a physics module that is off by default). Every other enum-with-default of
 * `profiles` must be in OPT_IN_MODULES: the generator throws otherwise, so a switch added to the schema
 * cannot go unmarked.
 */
export const NON_MODULE_SWITCHES: readonly string[] = ['nonlinearSolver', 'impuritySetpoint'];

/** Groups of the flat `profiles` settings, in reading order; a setting not named here is listed under "Other". */
export const PROFILE_GROUPS: readonly { readonly title: string; readonly keys: readonly string[] }[] = [
  { title: 'Numerics', keys: ['nRho', 'gridPacking', 'rtol', 'atol', 'dtMax', 'nonlinearSolver'] },
  {
    title: 'Equilibrium and plasma shape',
    keys: ['eqNR', 'eqUpdateInterval', 'lcfsKappa', 'lcfsDelta', 'lcfsRef95', 'IpWaveform'],
  },
  { title: 'Transport', keys: ['transportModel', 'chiShape', 'stiffness', 'critGrad', 'chiRatio', 'DoverChi'] },
  {
    title: 'Pedestal and ELMs',
    keys: [
      'pedestalModel', 'pedestalWidth', 'etbFactor', 'alphaCritFactor', 'pedPbGradient', 'pedKbmCoefficient', 'pedDensityExponent',
      'elmLoss', 'elmFraction',
    ],
  },
  {
    title: 'Impurities and helium ash',
    keys: [
      'impurityTransport', 'impuritySetpoint', 'impurityDoverDe', 'impurityPinchOverPe', 'impurityExtraSpecies', 'impurityExtraConcentration',
    ],
  },
  { title: 'Heating deposition', keys: ['ecrhRho', 'ecrhWidth', 'icrhWidth', 'nbiRtan'] },
  { title: 'Fast ions and current drive', keys: ['fastIonModel', 'fastOrbitScale', 'cdModel', 'nbcdEff', 'eccdEff', 'eccd'] },
  { title: 'Sawteeth', keys: ['sawtoothTrigger', 'sawtoothShear', 'sawtoothReconnection'] },
  { title: 'Boundary and edge', keys: ['edgeModel', 'Tsep_keV', 'nsepFrac'] },
  { title: 'Neoclassical coefficients', keys: ['neoclassicalModel'] },
];

const FAMILY_TITLES: Record<string, string> = {
  magneticConfig: 'Magnetic confinement',
  icfConfig: 'Inertial confinement (ICF)',
  mtfConfig: 'Magnetized target fusion and pulsed pinches',
  frcConfig: 'Field-reversed configuration (FRC)',
  mirrorConfig: 'Magnetic mirror',
  muonConfig: 'Muon-catalysed fusion',
};

// ---------------------------------------------------------------------------------------------------------
// schema helpers

class Schema {
  constructor(readonly root: Node) {}

  /** The node a local `$ref` points to (only `#/$defs/<name>` is used by the schemas). */
  deref(ref: string): Node {
    const m = /^#\/\$defs\/(.+)$/.exec(ref);
    const def = m ? (this.root.$defs as Node | undefined)?.[m[1]] : undefined;
    if (!def) throw new Error(`unresolved $ref ${ref}`);
    return def;
  }

  /** The node with its `$ref` resolved; keywords written next to the `$ref` (description, title, x-unit) win. */
  resolve(node: Node): Node {
    if (typeof node.$ref !== 'string') return node;
    const { $ref, ...local } = node;
    return { ...this.deref($ref), ...local };
  }

  /** The property at a dotted path below a node (`profiles.pedestalModel` below magneticConfig). */
  at(node: Node, path: string): Node {
    let cur = this.resolve(node);
    for (const part of path.split('.')) {
      const next = (cur.properties as Node | undefined)?.[part];
      if (!next) throw new Error(`the schema has no property "${path}" (stopped at "${part}")`);
      cur = this.resolve(next);
    }
    return cur;
  }
}

/** `number`, `number or null`, `enum`: the type of a schema node as a short word. */
function typeName(n: Node): string {
  if (Array.isArray(n.type)) return n.type.join(' or ');
  if (typeof n.type === 'string') return n.type;
  return n.enum ? 'enum' : 'any';
}

const q = (s: string): string => `\`${s.replace(/`/g, "'")}\``;
/** A JSON value as inline code, written as it appears in a configuration file (`"auto"`, `0.3`, `true`). */
const code = (v: unknown): string => q(JSON.stringify(v));

/** 10000000 -> 1e7, 100000 -> 100000: only powers of ten from a million up are shortened. */
function num(n: number): string {
  if (Math.abs(n) >= 1e6 && Math.log10(Math.abs(n)) % 1 === 0) return `${n < 0 ? '-' : ''}1e${Math.log10(Math.abs(n))}`;
  return String(n);
}

/** `(0, 100]`, `[0, 1]`, `≥ 0`, `> 0`, `≤ 5`: the bounds of a numeric schema, or '' if it has none. */
export function rangeText(n: Node): string {
  const lo = n.minimum !== undefined ? { v: n.minimum as number, open: false } : n.exclusiveMinimum !== undefined ? { v: n.exclusiveMinimum as number, open: true } : undefined;
  const hi = n.maximum !== undefined ? { v: n.maximum as number, open: false } : n.exclusiveMaximum !== undefined ? { v: n.exclusiveMaximum as number, open: true } : undefined;
  if (lo && hi) return `${lo.open ? '(' : '['}${num(lo.v)}, ${num(hi.v)}${hi.open ? ')' : ']'}`;
  if (lo) return `${lo.open ? '>' : '≥'} ${num(lo.v)}`;
  if (hi) return `${hi.open ? '<' : '≤'} ${num(hi.v)}`;
  return '';
}

/** Markdown-safe table cell: no pipes or line breaks, and `<` `>` shown literally outside code spans. */
function cell(s: string): string {
  return s
    .replace(/\r?\n+/g, ' ')
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/</g, '&lt;').replace(/>/g, '&gt;')))
    .join('')
    .replace(/\|/g, '\\|');
}

class Renderer {
  /** signature of an object's properties -> the first heading that listed it (a repeated object is cross-referenced) */
  private readonly listed = new Map<string, string>();
  readonly out: string[] = [];

  constructor(readonly sc: Schema) {}

  /** The "Type" column. */
  typeOf(n: Node, required: boolean): string {
    let t: string;
    if (n.const !== undefined) t = 'constant';
    else t = typeName(n);
    if (t === 'array') {
      const items = n.items && typeof n.items === 'object' ? this.sc.resolve(n.items) : undefined;
      if (items?.prefixItems) t = `array of [${(items.prefixItems as Node[]).map((p) => typeName(this.sc.resolve(p))).join(', ')}]`;
      else if (items?.type) t = `array of ${items.type}`;
    }
    return required ? `${t}, required` : t;
  }

  /** The "Allowed values / range" column. */
  allowed(n: Node): string {
    const parts: string[] = [];
    if (n.const !== undefined) parts.push(code(n.const));
    if (n.enum) parts.push((n.enum as unknown[]).map(code).join(', '));
    if (n.type === 'boolean') parts.push('`true`, `false`');
    const r = rangeText(n);
    if (r) parts.push(r);
    if (n.type === 'array') {
      const items = n.items && typeof n.items === 'object' ? this.sc.resolve(n.items) : undefined;
      if (items?.prefixItems) {
        const els = (items.prefixItems as Node[]).map((p) => {
          const e = this.sc.resolve(p);
          const rt = rangeText(e);
          return rt ? `${rt}${e['x-unit'] ? ` ${e['x-unit']}` : ''}` : '';
        });
        if (els.some(Boolean)) parts.push(`elements ${els.map((e) => e || 'any').join(', ')}`);
      }
      if (n.minItems !== undefined || n.maxItems !== undefined) {
        parts.push(`${n.minItems ?? 0} to ${n.maxItems ?? 'any number of'} items`);
      }
    }
    if (n.type === 'object' && (n.minProperties !== undefined || n.maxProperties !== undefined)) {
      parts.push(`${n.minProperties ?? 0} to ${n.maxProperties ?? 'any number of'} entries`);
    }
    if (n.type === 'string') {
      if (n.minLength !== undefined || n.maxLength !== undefined) parts.push(`${n.minLength ?? 0} to ${n.maxLength ?? 'any number of'} characters`);
      if (n.pattern) parts.push(`pattern ${q(String(n.pattern))}`);
    }
    return parts.join('; ') || '—';
  }

  /** One table row; `badge` is prepended to the description (opt-in marker). */
  row(name: string, prop: Node, required: boolean, badge = ''): string {
    const n = this.sc.resolve(prop);
    const unit = typeof n['x-unit'] === 'string' ? (n['x-unit'] as string) : '';
    let desc = String(n.description ?? n.title ?? '');
    if (unit) desc = desc.replace(new RegExp(`\\s*Unit: ${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.$`), '');
    const def = n.default !== undefined ? code(n.default) : '—';
    return `| ${q(name)} | ${cell(this.typeOf(n, required))} | ${unit ? cell(unit) : '—'} | ${def === '—' ? def : cell(def)} | ${cell(this.allowed(n))} | ${cell(badge + desc) || '—'} |`;
  }

  /** A field table for the properties of an object node, in schema order, optionally restricted to a key list. */
  table(node: Node, prefix: string, keys?: readonly string[], badge?: (key: string) => string): string[] {
    const props = (node.properties ?? {}) as Node;
    const req = new Set<string>(node.required ?? []);
    const names = keys ?? Object.keys(props);
    const lines = [
      '| Field | Type | Unit | Default | Allowed values / range | Description |',
      '|---|---|---|---|---|---|',
    ];
    for (const k of names) lines.push(this.row(prefix + k, props[k], req.has(k), badge?.(k) ?? ''));
    return lines;
  }

  /**
   * Sections for one object node: a heading, its description and rules, the field table and then, depth first,
   * the object-valued fields that have properties of their own. An object whose properties are identical to one
   * listed before (the `set` and `release` of a trigger) is cross-referenced instead of repeated.
   */
  object(node: Node, path: string, level: number, opts: ObjectOptions = {}): void {
    const n = this.sc.resolve(node);
    const props = (n.properties ?? {}) as Node;
    const heading = (title: string): void => {
      this.out.push(`${'#'.repeat(level)} ${title}`, '');
    };
    heading(opts.title ?? q(path));
    if (n.description) this.out.push(cell0(String(n.description)), '');
    const sig = JSON.stringify(props);
    const seen = this.listed.get(sig);
    if (seen !== undefined && path !== '') {
      this.out.push(`The same fields as ${seen}.`, '');
      return;
    }
    this.listed.set(sig, q(path || 'the top level'));
    this.rules(n);
    const groups = opts.groups ?? [{ title: '', keys: Object.keys(props) }];
    const grouped = new Set(groups.flatMap((g) => g.keys));
    const rest = Object.keys(props).filter((k) => !grouped.has(k));
    const all = rest.length && opts.groups ? [...groups, { title: 'Other', keys: rest }] : groups;
    for (const g of all) {
      if (g.title) this.out.push(`${'#'.repeat(level + 1)} ${g.title}`, '');
      this.out.push(...this.table(n, path ? `${path}.` : '', g.keys, opts.badge), '');
    }
    // nested objects that have fields of their own
    for (const k of Object.keys(props)) {
      const child = this.sc.resolve(props[k]);
      if (child.type === 'object' && child.properties && !opts.skipNested?.includes(k)) {
        this.object(child, path ? `${path}.${k}` : k, level + 1 + (opts.groups ? 1 : 0), opts.nested?.[k]);
      }
    }
  }

  /** x-rules: constraints JSON Schema cannot express. */
  private rules(n: Node): void {
    const rules = n['x-rules'] as { id: string; description: string }[] | undefined;
    if (!rules?.length) return;
    this.out.push('Rules the JSON Schema cannot express (the runtime validator enforces them):', '');
    for (const r of rules) this.out.push(`- ${q(r.id)}: ${cell0(r.description)}`);
    this.out.push('');
  }
}

interface ObjectOptions {
  title?: string;
  groups?: readonly { title: string; keys: readonly string[] }[];
  badge?: (key: string) => string;
  skipNested?: readonly string[];
  nested?: Record<string, ObjectOptions>;
}

/** Description text outside a table: `<` `>` shown literally outside code spans. */
function cell0(s: string): string {
  return s
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/</g, '&lt;').replace(/>/g, '&gt;')))
    .join('');
}

// ---------------------------------------------------------------------------------------------------------
// the document

/** `[method, definition name]` pairs of the top-level `allOf` (if method is one of ... then <definition>). */
function families(sc: Schema): { defName: string; methods: string[] }[] {
  const out: { defName: string; methods: string[] }[] = [];
  for (const branch of (sc.root.allOf ?? []) as Node[]) {
    const methods = branch.if?.properties?.method?.enum as string[] | undefined;
    const ref = branch.then?.$ref as string | undefined;
    if (!methods || !ref) throw new Error('unexpected shape of a top-level allOf branch');
    out.push({ defName: ref.replace('#/$defs/', ''), methods });
  }
  return out;
}

export function renderConfigReference(configSchema: Node, scenarioSchema: Node): string {
  const cfg = new Schema(configSchema);
  const scn = new Schema(scenarioSchema);
  const fams = families(cfg);
  const L: string[] = [];

  L.push(
    '# Configuration reference',
    '',
    '<!-- Generated by scripts/gen-config-reference.ts (npm run docs:config) from schema/fusion-sim.schema.json and',
    '     schema/scenario.schema.json. Do not edit: change the schema source and regenerate. -->',
    '',
    'Every field of a reactor configuration (the argument of `new Simulation(cfg)`, the `*.reactor.json` file of',
    '`fusion-sim run`) and of a scenario (`--scenario FILE`), with its type, unit, default, allowed values and',
    'description. The tables are generated from the JSON Schemas, so they list exactly what the validator accepts;',
    'unknown properties are rejected.',
    '',
    '**How to read the tables.** *Unit* is the unit of the stored value (`—`: dimensionless or not applicable).',
    '*Default* is the value the model uses when the field is absent, as the schema declares it; `—` means the schema',
    'declares none (the field is required, or its default depends on other fields and is stated in the description).',
    '*Allowed values / range* uses interval notation: `(0, 100]` excludes 0 and includes 100; `≥ 0` is a lower bound only.',
    'Fields marked **Opt-in module** are switches that turn on a model beyond the base behaviour (the modules of the',
    '1.5D profile model added in v4, and the 1.5D model itself): their default reproduces the earlier behaviour, so a',
    'configuration that does not name them is unchanged.',
    '',
    `Companion files: [schema/fusion-sim.schema.json](../schema/fusion-sim.schema.json) and [schema/scenario.schema.json](../schema/scenario.schema.json)`,
    `(machine-readable, for editors and validators).`,
    '',
    '## Contents',
    '',
    '- [Configuration families](#configuration-families)',
    '- [Opt-in modules of the 1.5D profile model](#opt-in-modules-of-the-15d-profile-model)',
    ...fams.map((f) => `- [${FAMILY_TITLES[f.defName] ?? f.defName}](#${anchor(FAMILY_TITLES[f.defName] ?? f.defName)})`),
    '- [Scenario](#scenario)',
    '',
    '## Configuration families',
    '',
    `The field ${q('method')} selects the family; only the fields of that family are accepted.`,
    '',
    '| `method` | Family (section below) |',
    '|---|---|',
  );
  for (const f of fams) for (const m of f.methods) L.push(`| ${q(m)} | [${FAMILY_TITLES[f.defName] ?? f.defName}](#${anchor(FAMILY_TITLES[f.defName] ?? f.defName)}) |`);
  L.push('');

  // ---- opt-in modules
  const magnetic = cfg.deref('#/$defs/magneticConfig');
  const profileNode = cfg.at(magnetic, 'profiles');
  const moduleKeys = new Map<string, OptInModule>();
  const dependents = new Map<string, { module: OptInModule; gate: string }>();
  L.push(
    '## Opt-in modules of the 1.5D profile model',
    '',
    `The modules of the 1.5D profile model that v4 added are opt-in: each switch has a default that reproduces the previous`,
    'behaviour ("off") and one or more values that switch the module on. They need `fidelity` `"1.5D"` (tokamak and',
    'spherical tokamak; the default `"0D"` is the global power balance), and the settings of a module are only used while',
    'it is on. The first row, `fidelity`, is the older switch of the 1.5D model itself.',
    '',
    '| Module | Switch | Default (off) | Opt-in values | Settings used only when on | What it changes |',
    '|---|---|---|---|---|---|',
  );
  const listed = new Set(OPT_IN_MODULES.map((m) => m.key));
  for (const [k, v] of Object.entries((profileNode.properties ?? {}) as Node)) {
    const n = cfg.resolve(v as Node);
    if (Array.isArray(n.enum) && n.default !== undefined && !listed.has(`profiles.${k}`) && !NON_MODULE_SWITCHES.includes(k)) {
      throw new Error(`profiles.${k} is an enum with a default but is neither in OPT_IN_MODULES nor in NON_MODULE_SWITCHES; classify it`);
    }
  }
  for (const m of OPT_IN_MODULES) {
    const node = cfg.at(magnetic, m.key);
    if (!Array.isArray(node.enum) || node.default === undefined) throw new Error(`opt-in switch ${m.key} must be an enum with a default in the schema`);
    const on = (node.enum as unknown[]).filter((v) => v !== node.default);
    if (!on.length) throw new Error(`opt-in switch ${m.key} has no value other than its default`);
    for (const s of m.settings ?? []) {
      const dep = cfg.at(profileNode, s.key);
      if (!String(dep.description ?? '').includes(s.gate)) {
        throw new Error(`setting ${s.key} no longer mentions "${s.gate}" in its description; update OPT_IN_MODULES`);
      }
      dependents.set(s.key, { module: m, gate: s.gate });
    }
    moduleKeys.set(m.key.startsWith('profiles.') ? m.key.slice('profiles.'.length) : `top:${m.key}`, m);
    L.push(
      `| ${cell(m.label)} | ${q(m.key)} | ${code(node.default)} | ${on.map(code).join(', ')} | ${(m.settings ?? []).map((s) => q(s.key)).join(', ') || '—'} | ${cell(m.summary)} |`,
    );
  }
  L.push('');

  /** Description prefix of an opt-in switch or of a setting that only acts while a module is on; `top:` keys are top-level. */
  const badgeAt = (scope: Node, prefix: string) => (key: string): string => {
    const m = moduleKeys.get(prefix + key);
    if (m) return `**Opt-in module: ${m.label}.** Default ${code(cfg.at(scope, key).default)} (off). `;
    const d = prefix === '' ? dependents.get(key) : undefined;
    return d ? `*Used only while ${q(d.module.key)} is on.* ` : '';
  };

  // ---- families
  const rdr = new Renderer(cfg);
  for (const f of fams) {
    const def = cfg.deref(`#/$defs/${f.defName}`);
    const title = FAMILY_TITLES[f.defName] ?? f.defName;
    rdr.out.push(`## ${title}`, '', `Used when \`method\` is ${f.methods.map(q).join(', ')}.`, '');
    if (def.description) rdr.out.push(cell0(String(def.description)), '');
    rdr.object(
      { ...def, description: undefined },
      '',
      3,
      f.defName === 'magneticConfig'
        ? {
            title: 'Top-level fields',
            badge: badgeAt(magnetic, 'top:'),
            nested: {
              profiles: {
                title: q('profiles') + ': 1.5D profile settings',
                groups: PROFILE_GROUPS,
                badge: badgeAt(profileNode, ''),
              },
            },
          }
        : { title: 'Fields' },
    );
  }
  L.push(...rdr.out);

  // ---- scenario
  L.push(...renderScenario(scn));

  L.push('---', '', 'Generated by `scripts/gen-config-reference.ts`; regenerate with `npm run docs:config`, verify with `npm run docs:config:check`.', '');
  return L.join('\n');
}

/** GitHub's anchor of a heading: lower case, punctuation dropped, spaces to hyphens. */
function anchor(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/ /g, '-');
}

function renderScenario(sc: Schema): string[] {
  const r = new Renderer(sc);
  const root = sc.root;
  const props = (root.properties ?? {}) as Node;
  r.out.push('## Scenario', '', cell0(String(root.description ?? '')), '', '### Top-level fields', '');
  r.out.push(...r.table(root, ''), '');
  const rules = (root['x-rules'] ?? []) as { id: string; description: string }[];
  if (rules.length) {
    r.out.push('Rules the JSON Schema cannot express (the loader enforces them):', '');
    for (const x of rules) r.out.push(`- ${q(x.id)}: ${cell0(x.description)}`);
    r.out.push('');
  }

  // controls that have a documented waveform: key, label, unit, value limit
  const wf = sc.resolve(props.waveforms ?? {});
  const controls = (wf.properties ?? {}) as Node;
  r.out.push('### Controls with a documented limit', '', `The keys of ${q('waveforms')}, of ${q('triggers[].set')} and of ${q('triggers[].release')} that the model exposes as actuator controls.`, 'Other keys are accepted if the model of the run exposes them (rule `known-keys`).', '');
  r.out.push('| Key | Control | Unit | Value limit |', '|---|---|---|---|');
  for (const k of Object.keys(controls)) {
    const c = sc.resolve(controls[k]);
    const points = c.properties?.points ? sc.resolve(c.properties.points) : undefined;
    const valueNode = points?.items ? sc.resolve(sc.resolve(points.items).prefixItems?.[1] ?? {}) : c;
    r.out.push(`| ${q(k)} | ${cell(String(c.title ?? ''))} | ${c['x-unit'] ? cell(String(c['x-unit'])) : '—'} | ${rangeText(valueNode) || '—'} |`);
  }
  r.out.push('');

  // the waveform and the trigger
  const defs = (root.$defs ?? {}) as Node;
  r.object(defs.waveform, 'waveforms.<control>', 3, { title: q('waveforms.<control>') + ': a waveform' });
  r.object(defs.trigger, 'triggers[]', 3, { title: q('triggers[]') + ': a trigger on a frame diagnostic', skipNested: ['set', 'release'] });
  // the if/then of the trigger is not a property: state it, and fail if the schema no longer says what the note says
  const t = defs.trigger as Node;
  if (t.then?.not?.required?.[0] !== 'release' || t.then?.properties?.hysteresis?.maximum !== 0) {
    throw new Error('the if/then of the trigger schema changed; update the note under the trigger table');
  }
  r.out.push(
    `Constraint across fields: a trigger whose ${q('mode')} is not ${code('repeat')} (${code('once')} is the default) must not have a ${q('release')} and needs ${q('hysteresis')} 0.`,
    '',
  );
  return r.out;
}

// ---------------------------------------------------------------------------------------------------------
// command line

function main(): void {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const outIdx = args.indexOf('--out');
  const out = resolve(outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : `${root}docs/config-reference.md`);
  const unknown = args.filter((a, i) => a !== '--check' && a !== '--out' && !(outIdx >= 0 && i === outIdx + 1));
  if (unknown.length || (outIdx >= 0 && !args[outIdx + 1])) {
    process.stderr.write('usage: gen-config-reference.ts [--check] [--out FILE]\n');
    process.exit(2);
  }
  const read = (f: string): Node => JSON.parse(readFileSync(`${root}schema/${f}`, 'utf8')) as Node;
  const text = renderConfigReference(read('fusion-sim.schema.json'), read('scenario.schema.json'));
  if (check) {
    const disk = existsSync(out) ? readFileSync(out, 'utf8').replace(/\r\n/g, '\n') : null;
    if (disk === text) {
      console.log(`${out}: up to date`);
      process.exit(0);
    }
    process.stderr.write(`${out}: ${disk === null ? 'missing' : 'out of date'}; run: npm run docs:config\n`);
    process.exit(1);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(`wrote ${out} (${text.length} bytes)`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
