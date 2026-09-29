/// <reference types="node" />
/**
 * Mission check — `tsx src/cli/missions.cli.ts` (the missions of the Learn screen, src/edu/missions.ts).
 *
 * Plays every mission headless three ways: as it starts (it must fail: not trivial), with its negative
 * control (it must still fail) and with its solution script (it must pass), and prints one line per mission
 * with the goal values of the solution. The solution of the POPCON mission is a search of the map.
 *   --only a,b   only these mission ids
 *   --json       machine-readable results on stdout
 * Exit codes: 0 every mission is solvable and not trivial; 1 a mission is not; 2 usage error.
 */
import { MISSIONS, Mission } from '../edu/missions';
import { Outcome, playMission, solveMission } from '../edu/missionEval';
import { defineCli, parseArgsOrExit } from './args';

const CLI = defineCli({
  name: 'tsx src/cli/missions.cli.ts',
  summary: 'Plays every Learn-screen mission headless: untouched (must fail), with its negative control (must fail) and with its\n' +
    'solution script (must pass). Exit codes: 0 all missions are solvable and not trivial; 1 one is not; 2 usage error.',
  flags: {
    only: { type: 'list', choices: MISSIONS.map((m) => m.id), metavar: 'ID,…', help: 'only these mission ids' },
    json: { type: 'bool', help: 'print machine-readable JSON results' },
  },
});

interface Row { id: string; start: boolean; control: boolean; solution: boolean; ok: boolean; edits: Record<string, number | string>; goals: string; ms: number }

const goalsOf = (o: Outcome) => o.results.map((r) => `${r.goal.metric}${r.goal.op}${r.goal.target}=${r.value === undefined ? '—' : +r.value.toPrecision(3)}${r.ok ? '' : '!'}`).join(' ');

function play(m: Mission): Row {
  const t0 = Date.now();
  const edits = solveMission(m);
  const start = playMission(m, {}).outcome.passed;
  const control = playMission(m, m.control).outcome.passed;
  const sol = playMission(m, edits).outcome;
  return { id: m.id, start, control, solution: sol.passed, ok: !start && !control && sol.passed, edits, goals: goalsOf(sol), ms: Date.now() - t0 };
}

const args = parseArgsOrExit(CLI);
const rows = MISSIONS.filter((m) => !args.only || args.only.includes(m.id)).map(play);
if (args.json) console.log(JSON.stringify(rows, null, 2));
else {
  const verdict = (passed: boolean) => (passed ? 'pass' : 'fail');
  for (const r of rows) {
    console.log(`${r.ok ? 'ok  ' : 'BAD '} ${r.id.padEnd(9)} start ${verdict(r.start)}  control ${verdict(r.control)}  solution ${verdict(r.solution)}  ${JSON.stringify(r.edits)}  ${r.goals}  (${r.ms} ms)`);
  }
  console.log(`${rows.filter((r) => r.ok).length}/${rows.length} missions solvable and not trivial`);
}
process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
