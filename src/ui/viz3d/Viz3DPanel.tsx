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

/** kept for the whole session so that the choice survives switching between the run screen and the report */
let openByDefault = false;

export function Viz3DPanel(props: Viz3DSource) {
  const t = useT();
  const [open, setOpen] = useState(openByDefault);
  const toggle = () => { openByDefault = !open; setOpen(!open); };
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
