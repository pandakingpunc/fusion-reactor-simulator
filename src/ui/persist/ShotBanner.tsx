import type { SavedShot } from '../state/types';
import { usePersistT } from './usePersistT';
import { VerifyBadge } from './VerifyBadge';

/** Above the Report when the shot shown was opened from the archive or a file: where it came from and whether it reproduces. */
export default function ShotBanner({ shot }: { shot: SavedShot }) {
  const p = usePersistT();
  if (!shot.verification && !shot.sourceKey) return null;
  return (
    <div className="persist-shotbar row" data-testid="shot-banner">
      <strong>{shot.name}</strong>
      {shot.sourceKey?.startsWith('archive:') && <span className="badge">{p('persist.library')}</span>}
      {shot.sourceKey?.startsWith('import:') && <span className="badge">{p('persist.lib.imported')}</span>}
      {shot.verification && <VerifyBadge status={shot.verification} />}
    </div>
  );
}
