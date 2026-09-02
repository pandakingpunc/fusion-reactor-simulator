import React, { useState } from 'react';
import { ShotReport } from '../../physics/types';
import { PRESETS } from '../../physics/presets';
import { SimApi } from '../useSim';
import { fmtNum } from '../format';

interface Props { runAll: SimApi['runAll'] }

/** Bir doğrulama ölçütü: rapordan bir sayı çek, [lo, hi] aralığında mı bak. */
interface Criterion { label: string; get: (r: ShotReport) => number; lo: number; hi: number; unit: string; source: string }
interface TestDef { id: string; presetId: string; title: string; criteria: Criterion[] }

// Beklenen değerler yayınlanmış deney/tasarım sonuçlarından (eğitsel toleranslarla).
const TESTS: TestDef[] = [
  {
    id: 'iter', presetId: 'ITER', title: 'ITER — Q ≈ 10 (tasarım noktası)',
    criteria: [
      { label: 'Q_sci maks', get: (r) => r.Q_sci_max, lo: 8, hi: 20, unit: '', source: 'ITER Physics Basis 1999; Q=10 hedefi, 0D model 15’e kadar kabul' },
      { label: 'T_i maks', get: (r) => r.Timax_keV, lo: 8, hi: 20, unit: 'keV', source: '⟨T_i⟩ ≈ 8–10 keV, tepe ≈ 20 keV' },
      { label: 'Disruption yok', get: (r) => (r.termination.disruption ? 1 : 0), lo: 0, hi: 0, unit: '', source: 'Tasarım noktası tüm limitlerin içinde' },
    ],
  },
  {
    id: 'jet', presetId: 'JET', title: 'JET DTE2 (2021) — 59 MJ',
    criteria: [
      { label: 'E_füzyon', get: (r) => r.E_fusion_MJ, lo: 45, hi: 75, unit: 'MJ', source: 'JET DTE2 rekor atışı #99971: 59 MJ / 5 s' },
      { label: 'Q_sci ort.', get: (r) => r.Q_sci_avg, lo: 0.2, hi: 0.6, unit: '', source: 'Q ≈ 0.33' },
    ],
  },
  {
    id: 'nif', presetId: 'NIF', title: 'NIF N221204 — kazanç ≈ 1.5',
    criteria: [
      { label: 'Kazanç (Q)', get: (r) => r.Q_sci_max, lo: 1, hi: 2, unit: '', source: '2.05 MJ lazer → 3.15 MJ füzyon (Dec 2022)' },
      { label: 'E_füzyon', get: (r) => r.E_fusion_MJ, lo: 2, hi: 4.5, unit: 'MJ', source: '3.15 MJ' },
    ],
  },
];

type Row = { test: TestDef; report?: ShotReport; error?: string; ms?: number };

export function Validation({ runAll }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [sweep, setSweep] = useState<{ name: string; validation?: string; report?: ShotReport; error?: string }[]>([]);

  const runTest = async (t: TestDef) => {
    const preset = PRESETS.find((p) => p.id === t.presetId);
    if (!preset) return;
    setBusy(t.id);
    const t0 = performance.now();
    try {
      const res = await runAll(preset.cfg);
      setRows((rs) => [...rs.filter((r) => r.test.id !== t.id), { test: t, report: res.report, ms: performance.now() - t0 }]);
    } catch (e) {
      setRows((rs) => [...rs.filter((r) => r.test.id !== t.id), { test: t, error: String(e) }]);
    } finally { setBusy(null); }
  };

  const runAllTests = async () => { for (const t of TESTS) await runTest(t); };

  const runSweep = async () => {
    setBusy('sweep'); setSweep([]);
    for (const p of PRESETS) {
      try {
        const res = await runAll(p.cfg);
        setSweep((s) => [...s, { name: p.name, validation: p.validation, report: res.report }]);
      } catch (e) { setSweep((s) => [...s, { name: p.name, validation: p.validation, error: String(e) }]); }
    }
    setBusy(null);
  };

  const passCount = rows.filter((r) => r.report && r.test.criteria.every((c) => inRange(c, r.report!))).length;

  return (
    <div className="report">
      <div className="panel full">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>Doğrulama</h2>
            <div className="muted small">Model, bilinen deneylerle karşılaştırılır. <b className="accent">Test başarısızsa modeli düzelt, testi değil.</b> Her test arka planda (worker) tam hızda koşar.</div>
          </div>
          <div className="row">
            <button className="btn primary" onClick={runAllTests} disabled={busy !== null}>{busy && busy !== 'sweep' ? `çalışıyor: ${busy}…` : '▶ 3 testi çalıştır'}</button>
            <button className="btn" onClick={runSweep} disabled={busy !== null}>{busy === 'sweep' ? `tarama… ${sweep.length}/${PRESETS.length}` : 'Tüm ön ayarları tara'}</button>
          </div>
        </div>
        {rows.length > 0 && <div style={{ marginTop: 6 }}><span className={`badge ${passCount === rows.length ? 'ok' : 'bad'}`}>{passCount}/{rows.length} test geçti</span></div>}
      </div>

      {TESTS.map((t) => {
        const row = rows.find((r) => r.test.id === t.id);
        const ok = row?.report ? t.criteria.every((c) => inRange(c, row.report!)) : undefined;
        return (
          <div className="panel" key={t.id}>
            <div className="panel-title">
              <h3>{t.title}</h3>
              <span className="row" style={{ gap: 6 }}>
                {ok !== undefined && <span className={`badge ${ok ? 'ok' : 'bad'}`}>{ok ? 'GEÇTİ' : 'KALDI'}</span>}
                <button className="btn sm" onClick={() => runTest(t)} disabled={busy !== null}>çalıştır</button>
              </span>
            </div>
            {row?.error && <pre className="err">{row.error}</pre>}
            <table className="kv"><tbody>
              {t.criteria.map((c) => {
                const v = row?.report ? c.get(row.report) : undefined;
                const pass = row?.report ? inRange(c, row.report) : undefined;
                return (
                  <tr key={c.label}>
                    <td>{c.label}<div className="small muted">{c.source}</div></td>
                    <td className="num">
                      <span className="muted">[{fmtNum(c.lo)} … {fmtNum(c.hi)}] {c.unit}</span><br />
                      {v === undefined ? <span className="muted">—</span> : <b className={pass ? 'ok' : 'bad'}>{fmtNum(v)} {c.unit}</b>}
                    </td>
                  </tr>
                );
              })}
              {row?.report && (
                <tr><td className="small muted">Sonlanma</td><td className="small muted">{row.report.termination.reason} · {row.ms?.toFixed(0)} ms</td></tr>
              )}
            </tbody></table>
          </div>
        );
      })}

      {sweep.length > 0 && (
        <div className="panel full" style={{ overflowX: 'auto' }}>
          <h3>Ön ayar taraması</h3>
          <table className="cmp">
            <thead><tr><th>Ön ayar</th><th>Beklenen</th><th>Q_sci maks</th><th>T_max [keV]</th><th>E_füz [MJ]</th><th>Sonlanma</th><th>Puan</th></tr></thead>
            <tbody>
              {sweep.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td className="small muted">{s.validation ?? '—'}</td>
                  {s.report ? (
                    <>
                      <td>{fmtNum(s.report.Q_sci_max)}</td><td>{fmtNum(s.report.Tmax_keV)}</td><td>{fmtNum(s.report.E_fusion_MJ)}</td>
                      <td className={s.report.termination.disruption ? 'bad' : ''}>{s.report.termination.reason}</td><td>{Math.round(s.report.score)}</td>
                    </>
                  ) : <td colSpan={5} className="bad">{s.error}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function inRange(c: Criterion, r: ShotReport): boolean { const v = c.get(r); return isFinite(v) && v >= c.lo && v <= c.hi; }
