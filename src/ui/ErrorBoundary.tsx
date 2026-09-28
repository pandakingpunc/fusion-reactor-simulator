import React from 'react';
import { useT } from './state/store';

interface Props {
  children?: React.ReactNode;
  /** a caught error is cleared (and the children drawn again) when any of these values changes */
  resetKeys?: readonly unknown[];
  /** 'view': a whole screen; 'panel': one panel of a screen */
  variant?: 'view' | 'panel';
}
interface State { error: Error | null }

const sameKeys = (a: readonly unknown[] = [], b: readonly unknown[] = []) =>
  a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/**
 * Catches an error thrown while rendering or drawing (in an effect) below it and shows it in place,
 * so that one failing view or panel does not unmount the whole application — and with it the shot
 * archive, which lives only in memory.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && !sameKeys(prev.resetKeys, this.props.resetKeys)) this.setState({ error: null });
  }

  private readonly retry = () => this.setState({ error: null });

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <ErrorFallback error={error} variant={this.props.variant ?? 'view'} onRetry={this.retry} />;
  }
}

function ErrorFallback({ error, variant, onRetry }: { error: Error; variant: 'view' | 'panel'; onRetry: () => void }) {
  const t = useT();
  return (
    <div className={variant === 'panel' ? 'panel tight' : 'panel'}>
      <div className="diag-box bad" role="alert">
        <b>{t(variant === 'panel' ? 'err.panelTitle' : 'err.viewTitle')}</b> <span className="small muted">{t('err.hint')}</span>
        <pre className="err" style={{ margin: '4px 0 6px', maxHeight: 120, overflow: 'auto' }}>{error.message}</pre>
        <button className="btn sm" onClick={onRetry}>{t('err.retry')}</button>
      </div>
    </div>
  );
}
