import { Simulation } from './src/physics/simulation';
import { DIIID } from './src/physics/presets';
import { greenwaldDensity, lineAverageFactor } from './src/physics/limits';
const nG = greenwaldDensity(DIIID.Ip_MA, DIIID.geometry.a), fl = lineAverageFactor(DIIID.transport.alpha_n);
console.log('nG', nG, 'fline', fl, 'nt at nbar=nG', nG/fl);
const out: string[] = [];
for (const seed of [1, 2, 3, 5, 8, 13]) for (const n of [0.95, 1.0, 1.01]) {
  const cfg: any = { ...DIIID, n_target: n * 1e20, t_end: 4, seed };
  const sim = new Simulation(cfg); sim.runAll();
  const rep: any = sim.model.report(sim.history, sim.events);
  let peak = 0; for (const f of sim.history) peak = Math.max(peak, (f.d as any).nG_frac);
  const set = n*1e20*fl/nG;
  out.push(`seed ${seed} n ${n} set ${set.toFixed(3)} peak ${peak.toFixed(3)} (${(100*(peak/set-1)).toFixed(1)}%) ${rep.termination.disruption ? 'DISRUPT ' + rep.termination.disruption.cause + ' t=' + rep.termination.t.toFixed(2) : 'ok'}`);
}
console.log(out.join('\n'));
