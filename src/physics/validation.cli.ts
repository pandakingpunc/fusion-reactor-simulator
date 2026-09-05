/**
 * Doğrulama CLI'si — `npm run validate` (tsx ile çalışır).
 *
 * Her preset'i Simulation.runAll() ile koşturur ve seçili çıktıları açık literatürdeki
 * beklenen aralıklarla karşılaştırır. Amaç regresyon yakalamaktır (mertebe/tutarlılık).
 * Bir kontrol başarısız olursa süreç sıfırdan farklı kodla çıkar (tsx yakalanmamış
 * hatada exit 1 verir).
 */
import { PRESETS } from './presets';
import { Simulation } from './simulation';
import { ShotReport } from './types';

interface Check {
  id: string;
  label: string;
  get: (r: ShotReport) => number;
  lo: number;
  hi: number;
  unit: string;
  ref: string;
}

// Beklenen aralıklar — açık literatür (0D olduğu için toleranslar geniştir).
const CHECKS: Check[] = [
  { id: 'ITER', label: 'Q_scientific', get: (r) => r.Q_sci_max, lo: 8, hi: 40, unit: '', ref: 'ITER target Q≈10 (0D overprediction is normal)' },
  { id: 'JET', label: 'E_fusion', get: (r) => r.E_fusion_MJ, lo: 40, hi: 80, unit: 'MJ', ref: 'JET DTE2 2021: 59 MJ' },
  { id: 'SPARC', label: 'Q_scientific', get: (r) => r.Q_sci_max, lo: 2, hi: 20, unit: '', ref: 'SPARC estimate Q≈11' },
  { id: 'DEMO', label: 'Q_scientific', get: (r) => r.Q_sci_max, lo: 10, hi: 60, unit: '', ref: 'EU DEMO ~2 GW fusion, P_aux 50 MW' },
  { id: 'NIF', label: 'Gain G', get: (r) => r.Q_sci_max, lo: 1.0, hi: 3.0, unit: '', ref: 'NIF N221204: G≈1.5' },
  { id: 'DIRECT', label: 'Gain G', get: (r) => r.Q_sci_max, lo: 1.0, hi: 8.0, unit: '', ref: 'Direct drive (scaled)' },
  { id: 'MUON', label: 'Q_scientific', get: (r) => r.Q_sci_max, lo: 0.0, hi: 0.99, unit: '', ref: 'µCF Q<1 (sticking + muon cost)' },
];

const reports = new Map<string, ShotReport>();
for (const p of PRESETS) {
  const sim = new Simulation(p.cfg);
  reports.set(p.id, sim.runAll());
}

let fails = 0;
console.log('\n=== SUMMARY (all presets) ===');
for (const p of PRESETS) {
  const r = reports.get(p.id)!;
  const finite = isFinite(r.Q_sci_max) && isFinite(r.E_fusion_MJ) && isFinite(r.Tmax_keV) && isFinite(r.score);
  if (!finite) { fails++; console.log(`  NAN!  ${p.id}`); continue; }
  console.log(
    `  ${p.id.padEnd(8)} Q=${r.Q_sci_max.toExponential(2)}  E_fus=${r.E_fusion_MJ.toExponential(2)} MJ  T=${r.Tmax_keV.toFixed(2)} keV  score=${r.score}`
  );
}

console.log('\n=== VALIDATION (against literature) ===');
for (const c of CHECKS) {
  const r = reports.get(c.id);
  if (!r) { fails++; console.log(`  SKIP  ${c.id} — preset not found`); continue; }
  const v = c.get(r);
  const pass = isFinite(v) && v >= c.lo && v <= c.hi;
  if (!pass) fails++;
  console.log(
    `  ${pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(8)} ${c.label} = ${v.toPrecision(3)} ${c.unit}` +
    ` (expected ${c.lo}–${c.hi})  [${c.ref}]`
  );
}

console.log(`\n${fails === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${fails} CHECKS FAILED`}\n`);
if (fails > 0) throw new Error(`${fails} validation checks failed`);
