/**
 * Fast-ion source of the 1.5D model with energy fields on the radial grid (ProfileSettings.fastIonModel = 'profile'; pool.ts describes the
 * equations). It takes over the heating by the NBI ions and by the charged fusion products from the instantaneous, local heating of
 * sources/nbi.ts and sources/fusion.ts:
 *
 *  - prepare (old state, once per attempt): the energy time τ_W and the ion fraction G of every cell for each beam component and for the fusion
 *    products, the orbit kernels from the safety factor of the old state; the heating of the rate of the state (Δt → 0, h = w/τ);
 *  - particles (once per attempt, with Δt): the weights of the delivery for that step (a, b), the beam heating h̄ of the step;
 *  - heat (every Picard iteration and on the old state): the alpha heating h̄ = a S + b w from the birth power of the iterate
 *    (w.Pchg of sources/fusion.ts), written into w.PaE and w.PaI in place of the instantaneous split;
 *  - accepted: the exact update of the fields with the source of the accepted iterate, the energy ledger of the step, the contents
 *    ctx.WfBeam and ctx.WfAlpha (integrals of the fields), the pressure.
 *
 * The birth profile of the beam components is written by sources/nbi.ts (ctx.fast.beamBirth), which also takes its beam-target density from
 * the fields (fastions/beamTarget.ts). Source order: after 'fusion'.
 */
import { FUEL_SPECIES } from '../../reactivity';
import { criticalEnergy, fastIonEnergyTime, ionHeatingFraction } from '../../heating';
import type { ProfileContext, StepConstants } from '../context';
import type { CheckpointAux, CheckpointRecord } from '../checkpoint';
import type { TransportGeometry } from '../geometry1d';
import type { SourceModel } from '../sources/SourceModel';
import type { ProfileState } from '../state';
import { orbitSigma, type BirthEnergy } from './orbit';
import { FastIonProfile, TAU_MIN, type PoolField } from './pool';
import { chargedProductProps, productBirthEnergies } from './products';

/** Log-quantisation step of the orbit widths: a kernel is a function of the widths rounded to 3 %, rebuilt only when one of them changes step */
const SIGMA_STEP = Math.log(1.03);

function quantise(sigma: Float64Array): void {
  for (let j = 0; j < sigma.length; j++) if (sigma[j] > 0) sigma[j] = Math.exp(Math.round(Math.log(sigma[j]) / SIGMA_STEP) * SIGMA_STEP);
}

/** The orbit kernel of a field, rebuilt when the (quantised) widths differ from those it was built with */
class KernelCache {
  private widths: Float64Array | null = null;
  invalidate(): void { this.widths = null; }
  update(field: PoolField, g: Pick<TransportGeometry, 'rhoC' | 'dRhoC' | 'dV'>, sigma: Float64Array): void {
    quantise(sigma);
    const w = this.widths;
    if (w && w.length === sigma.length) {
      let same = true;
      for (let j = 0; j < sigma.length && same; j++) same = w[j] === sigma[j];
      if (same) return;
    }
    this.widths = Float64Array.from(sigma);
    field.setKernel(g, sigma);
  }
}

export class FastIonSource implements SourceModel {
  readonly id = 'fastions';
  private readonly sigma: Float64Array;
  private readonly cache: KernelCache[];
  private readonly alphaCache = new KernelCache();
  private alphaBirth: BirthEnergy[] | null = null;

  constructor(private readonly ctx: ProfileContext) {
    const f = this.fast;
    this.sigma = new Float64Array(ctx.N);
    this.cache = f.comps.map(() => new KernelCache());
  }

  private get fast(): FastIonProfile {
    const f = this.ctx.fast;
    if (!f) throw new Error("FastIonSource needs ctx.fast (ProfileSettings.fastIonModel = 'profile')");
    return f;
  }

  geometryChanged(_ctx: ProfileContext, tg: TransportGeometry): void {
    for (const c of this.cache) c.invalidate();
    this.alphaCache.invalidate();
    // the energy of a cell is kept when the cell volumes change (pool.ts remap)
    this.fast.remap(tg.dV);
  }

  prepare(ctx: ProfileContext, _t: number, st: ProfileState, K: StepConstants): void {
    const f = this.fast, g = ctx.tg, w = ctx.w, N = ctx.N, cfg = ctx.cfg;
    const fs = FUEL_SPECIES[cfg.fuel];
    const { Te, Ti, ne } = st;
    if (!f.isBound) f.remap(g.dV);
    const aMid = 0.5 * (g.RoutF[N] - g.RinF[N]);
    const scale = ctx.ps.fastOrbitScale ?? 1;
    f.comps.forEach((comp, k) => {
      const field = f.beam[k], birth = f.beamBirth[k];
      for (let i = 0; i < N; i++) {
        const Tev = Math.max(Te[i], 0.01), Ec = criticalEnergy(Tev, fs.a.A, w.ionSum[i]);
        field.tau[i] = Math.max(fastIonEnergyTime(Tev, ne[i], fs.a.A, fs.a.Z, comp.E_keV, Ec), TAU_MIN);
        field.G[i] = ionHeatingFraction(comp.E_keV, Ec);
      }
      // the kernel is only needed while the component is born
      let born = false;
      for (let i = 0; i < N && !born; i++) born = birth[i] > 0;
      if (born) {
        orbitSigma(this.sigma, w.q, [{ E_keV: comp.E_keV, A: fs.a.A, Z: fs.a.Z, weight: 1 }], g.B0, aMid, scale);
        this.cache[k].update(field, g, this.sigma);
      }
      field.coefficients(0);
    });
    // the charged fusion products: energy time and ion fraction of the old state's mix of products, the orbit width of their birth energies
    const alpha = f.alpha;
    for (let i = 0; i < N; i++) {
      const p = chargedProductProps(cfg.fuel, Te[i], Ti[i], ne[i], w.na[i], w.nb[i], w.ionSum[i], (j) => K.btR[j][i]);
      alpha.tau[i] = Math.max(p.tauW, TAU_MIN);
      alpha.G[i] = p.G;
    }
    this.alphaBirth ??= productBirthEnergies(cfg.fuel);
    orbitSigma(this.sigma, w.q, this.alphaBirth, g.B0, aMid, scale);
    this.alphaCache.update(alpha, g, this.sigma);
    alpha.coefficients(0);
    this.deliverBeam(ctx);
  }

  particles(ctx: ProfileContext, _t: number, dt: number): void {
    const f = this.fast;
    for (const field of f.beam) field.coefficients(dt);
    f.alpha.coefficients(dt);
    this.deliverBeam(ctx);
  }

  heat(ctx: ProfileContext): void {
    const f = this.fast, w = ctx.w, N = ctx.N;
    const alpha = f.alpha;
    alpha.smooth(ctx.tg.dV, w.Pchg);
    alpha.deliver();
    for (let i = 0; i < N; i++) {
      w.PaI[i] = alpha.h[i] * alpha.G[i];
      w.PaE[i] = alpha.h[i] * (1 - alpha.G[i]);
    }
  }

  accepted(ctx: ProfileContext, _t: number, dt: number): void {
    const f = this.fast, dV = ctx.tg.dV;
    const beam = { birth: 0, delivered: 0, dContent: 0 };
    for (const field of f.beam) {
      const l = field.advance(dV, dt);
      beam.birth += l.birth; beam.delivered += l.delivered; beam.dContent += l.dContent;
    }
    const alpha = f.alpha.advance(dV, dt);
    f.lastStep = { beam, alpha };
    const c = f.contents(dV);
    ctx.WfBeam = c.beam; ctx.WfAlpha = c.alpha;
    f.updatePressure();
  }

  save(rec: CheckpointRecord, aux: CheckpointAux): void { this.fast.save(rec, aux); }

  restore(_rec: Readonly<CheckpointRecord>, aux: Readonly<CheckpointAux> | undefined): void {
    const ctx = this.ctx;
    this.fast.restore(aux, ctx.WfBeam, ctx.WfAlpha, ctx.tg.dV);
  }

  /** The beam heating of the attempt: the smoothed birth power of each component, delivered with a and b, split between the electrons and the ions by G */
  private deliverBeam(ctx: ProfileContext): void {
    const f = this.fast, w = ctx.w, N = ctx.N, dV = ctx.tg.dV;
    w.PnbiE.fill(0); w.PnbiI.fill(0);
    f.beam.forEach((field, k) => {
      field.smooth(dV, f.beamBirth[k]);
      field.deliver();
      for (let i = 0; i < N; i++) {
        w.PnbiI[i] += field.h[i] * field.G[i];
        w.PnbiE[i] += field.h[i] * (1 - field.G[i]);
      }
    });
  }
}
