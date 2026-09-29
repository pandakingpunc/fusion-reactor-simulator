import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NIF, ZMACHINE, MUON } from '../../physics/presets';
import { createModel, Simulation } from '../../physics/simulation';
import { HistoryFrame, ReactorConfig } from '../../physics/types';
import { SavedShot } from '../state/types';
import { Report } from './Report';

const cases: { name: string; cfg: ReactorConfig; unit: string; seconds: number }[] = [
  { name: 'ICF nanoseconds', cfg: NIF, unit: 'ns', seconds: 1e-9 },
  { name: 'MTF microseconds', cfg: ZMACHINE, unit: 'µs', seconds: 1e-6 },
  { name: 'seconds-based model', cfg: MUON, unit: 's', seconds: 1 },
];

function sampleShot(cfg: ReactorConfig): SavedShot {
  const model = createModel(cfg);
  // Burn lasts from 0 to 5 native time units; ignition only from 2 to 5.
  const frames: HistoryFrame[] = [
    { t: 0, d: { Q: 0, ignited: 0 } },
    { t: 2, d: { Q: 1, ignited: 0 } },
    { t: 5, d: { Q: 2, ignited: 1 } },
    { t: 11, d: { Q: 0, ignited: 0 } },
  ].map((f) => ({ ...f, y: [], internal: {} }));
  return {
    id: 1, name: 'Unit regression', cfg, frames, events: [],
    report: model.report(frames, []),
    meta: {
      method: model.method, kind: model.kind, timeUnit: model.timeUnit,
      tEnd: model.tEnd, diagSpecs: model.diagSpecs,
      geometry: model.geometryInfo(), controls: {},
    },
  };
}

function render(shot: SavedShot): string {
  return renderToStaticMarkup(React.createElement(Report, {
    shot, onRerun: () => {}, onEdit: () => {},
  }));
}

describe.each(cases)('$name report units', ({ cfg, unit, seconds }) => {
  it('keeps duration in native units and stores interval fields in seconds', () => {
    const { report } = sampleShot(cfg);
    expect(report.timeUnit).toBe(unit);
    expect(report.duration).toBe(11);
    expect(report.stableTime_s / seconds).toBeCloseTo(11, 12);
    expect(report.burnTime_s / seconds).toBeCloseTo(5, 12);
    expect(report.ignitionTime_s / seconds).toBeCloseTo(3, 12);
  });

  it('renders duration and intervals in the selected unit without double conversion', () => {
    const html = render(sampleShot(cfg));
    expect(html).toContain(`Shot duration 11.00 ${unit}`);
    expect(html).toContain(`<td>Stable operating time</td><td class="num">${unit === 's' ? '11.00' : '11.0'} ${unit}</td>`);
    expect(html).toContain(`<td>Burn time</td><td class="num">5.00 ${unit}</td>`);
    // the label carries an Explain popover: the value is the cell after the one that holds it
    expect(html).toMatch(new RegExp(`<span>Ignition time</span>.*?</td><td class="num">3[.]00 ${unit}</td>`));
  });
});

it('reports a completed NIF shot as 11 ns with sub-nanosecond ignition', () => {
  const sim = new Simulation(NIF);
  const report = sim.runAll();
  expect(report.duration).toBeCloseTo(11, 8);
  expect(report.stableTime_s).toBeGreaterThan(10e-9);
  expect(report.stableTime_s).toBeLessThan(12e-9);
  expect(report.ignitionTime_s).toBeGreaterThan(0);
  expect(report.ignitionTime_s).toBeLessThan(1e-9);
  expect(report.burnTime_s).toBeGreaterThan(2e-9);
  expect(report.burnTime_s).toBeLessThan(4e-9);
  expect(render({ ...sampleShot(NIF), report, frames: sim.history, events: sim.events }))
    .toContain('Shot duration 11.00 ns');
});
