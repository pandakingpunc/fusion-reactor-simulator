import type { VerifyStatus } from './types';
import { usePersistT } from './usePersistT';

const CLASS: Record<VerifyStatus, string> = { verified: 'ok', mismatch: 'bad', tampered: 'bad', 'other-version': 'warn', unsigned: '' };

/** The outcome of re-simulating an imported run, as a badge; its tooltip says what the outcome means. */
export function VerifyBadge({ status, fileVersion, currentVersion }: { status: VerifyStatus; fileVersion?: string; currentVersion?: string }) {
  const p = usePersistT();
  const text = status === 'other-version'
    ? p('persist.verify.other-version.text', { file: fileVersion ?? '?', current: currentVersion ?? '?' })
    : p(`persist.verify.${status}.text` as 'persist.verify.verified.text');
  return (
    <span className={`badge ${CLASS[status]}`} title={text} data-verify={status}>
      {status === 'verified' ? '✓ ' : ''}{p(`persist.verify.${status}` as 'persist.verify.verified')}
    </span>
  );
}
