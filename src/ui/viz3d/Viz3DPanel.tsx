import { Suspense, lazy, useState } from 'react';
import { useT } from '../state/store';
import type { Viz3DSource } from './input';

/**
 * The 3D view's slot on the run screen. Only this small file is part of the main bundle: the view itself (WebGL2 renderer, mesh
 * generation, camera) is a separate chunk, fetched the first time the panel is opened (or when the pointer or focus reaches the
 * button, so that the click finds it loaded).
 */
const loadViz3D = () => import('./Viz3D');
const Viz3D = lazy(loadViz3D);

/** where the Show / Hide choice is kept (per browser; storage may be blocked, then the choice lasts for the session only) */
export const VIZ3D_OPEN_KEY = 'fusion-sim.viz3d.open';
/** the choice of the session: it survives switching between the run screen and the report even without storage */
let openByDefault: boolean | null = null;

function readOpen(): boolean {
  if (openByDefault !== null) return openByDefault;
  try { return localStorage.getItem(VIZ3D_OPEN_KEY) === '1'; } catch { return false; }
}
function writeOpen(open: boolean): void {
  openByDefault = open;
  try { localStorage.setItem(VIZ3D_OPEN_KEY, open ? '1' : '0'); } catch { /* storage unavailable: the choice lasts for this page view */ }
}

export function Viz3DPanel(props: Viz3DSource) {
  const t = useT();
  const [open, setOpen] = useState(readOpen);
  const toggle = () => { writeOpen(!open); setOpen(!open); };
  return (
    <div className="panel tight">
      <div className="panel-title">
        <h3>{t('viz3d.title')}</h3>
        <button className="btn sm" aria-expanded={open} onClick={toggle} onPointerEnter={() => { void loadViz3D(); }} onFocus={() => { void loadViz3D(); }}>
          {t(open ? 'viz3d.hide' : 'viz3d.show')}
        </button>
      </div>
      {open && (
        <Suspense fallback={<div className="muted small">{t('viz3d.loading')}</div>}>
          <Viz3D {...props} />
        </Suspense>
      )}
    </div>
  );
}
