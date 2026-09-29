import { useCallback, useContext } from 'react';
import { RouterContext } from '../persist/routing';

/**
 * The "Open in the glossary" action of the Explain popovers: opens the Learn tab at the glossary entry of a term
 * (#/learn/glossary/<term>). Undefined outside the application (no router), where the popover then leaves the link out.
 */
export function useOpenGlossary(): ((termId: string) => void) | undefined {
  const router = useContext(RouterContext);
  const open = useCallback((termId: string) => { router?.navigate({ name: 'learn', section: 'glossary', id: termId }); }, [router]);
  return router ? open : undefined;
}
