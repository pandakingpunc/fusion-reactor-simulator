/**
 * UI state types shared by App, the run screen and the report screens.
 * (Moved out of App.tsx so that screens no longer import from the root component.)
 */
import { ReactorConfig, ShotReport, SimEvent } from '../../physics/types';
import { SimMeta, UiFrame } from '../../worker/protocol';
import { Locale } from '../../i18n';
import type { RunProvenance, VerifyStatus } from '../persist/types';

export type Tab = 'setup' | 'run' | 'report' | 'compare' | 'validate' | 'learn';

/** Rapor ekranı + karşılaştırma için saklanan tamamlanmış atış */
export interface SavedShot {
  id: number;
  name: string;
  cfg: ReactorConfig;
  meta: SimMeta;
  report: ShotReport;
  frames: UiFrame[];
  events: SimEvent[];
  /** what the run carries besides its results (its live interventions), so that it can be exported and reproduced */
  prov?: RunProvenance;
  /** id of this shot's record in the browser archive (set for shots opened from it) */
  archiveId?: string;
  /** where an opened shot came from ('archive:<id>', 'import:<fingerprint>'): opening the same source again shows the shot that is there */
  sourceKey?: string;
  /** for an imported shot: how re-simulating it turned out */
  verification?: VerifyStatus;
}

export type SimStatus = 'idle' | 'loading' | 'ready' | 'running' | 'paused' | 'done' | 'error';

export interface SimState {
  status: SimStatus;
  cfg: ReactorConfig | null;
  meta: SimMeta | null;
  frames: UiFrame[];
  events: SimEvent[];
  t: number;
  dt: number;
  nSteps: number;
  controls: Record<string, number>;
  /** end-of-shot report of the current branch (cleared when a rewind abandons the branch) */
  report: ShotReport | null;
  error: string | null;
  speed: number;
  wallMs: number;
  /** id of the loaded run (the worker `init` id); changes on every load/restart (chart zoom reset, stale-run guard) */
  runId: number;
  /** timeline branch inside the run; bumped on every rewind so frames of an abandoned branch are dropped */
  branchId: number;
  /** start playing as soon as the worker is ready */
  autoPlay: boolean;
  /** live interventions sent for this run (control()); a run with any cannot be exported with a fingerprint unless its actuator log is known */
  interventions: number;
}

export interface RunAllResult { report: ShotReport; meta: SimMeta; frames?: UiFrame[]; events?: SimEvent[] }
export interface RunAllProgress { t: number; tEnd: number; frames: number }

export interface AppState {
  tab: Tab;
  /** configuration being edited in the wizard */
  cfg: ReactorConfig;
  cfgName: string;
  /** completed shots (report + comparison archive) */
  shots: SavedShot[];
  /** `${runId}:${branchId}` of the last archived completion, so each completed branch is archived once */
  archivedKey: string | null;
  /** id of the shot the Report shows, when the user opened one (from the archive or an imported file); null: the live or latest run */
  viewId: number | null;
  locale: Locale;
}
