/**
 * An accessibility check for rendered screens, written with the DOM alone (no axe-core: the project has no dependency for it). It covers
 * the failures that a machine can see in a document and that matter to a keyboard or a screen reader user:
 *   name          every button, link, input, select, summary and [role=button|tab|...] has an accessible name
 *   img           an <img> has alt, an <svg> and a <canvas> that draw a figure are role="img" with a name (or aria-hidden)
 *   role-name     a dialog, a figure (role=img), a tablist, a progressbar or a group that names a region has a name
 *   dup-id        no two elements share an id
 *   aria-ref      aria-labelledby/-describedby/-controls point at ids that exist
 *   heading       heading levels do not skip (h2 then h4), and a heading is not empty
 *   dialog        a dialog is aria-modal, named, and has something to focus
 *   tabs          role=tab sits in a role=tablist and says whether it is selected
 *   keyboard      what a mouse can do a keyboard can: an element with a click handler is a native control or has a role, a tab stop and a
 *                 key handler; no positive tabindex
 *   hidden-focus  nothing focusable inside aria-hidden
 *   file-input    a file input that is display:none / hidden cannot be reached by a keyboard (a button that clicks a visually hidden input can)
 *   landmark      one <main>
 *   lang          <html lang> is set
 * `tabOrder` lists the tab stops in the order the Tab key visits them. Not imported by the application bundle.
 */

export interface A11yIssue { rule: string; where: string; detail: string }

export interface A11yOptions {
  /** a finding that is on purpose; the reason belongs next to the predicate */
  allow?: (issue: A11yIssue, el: Element) => boolean;
  /** check the document-level rules (landmark, lang) too; default: when the root is the body */
  page?: boolean;
}

const NATIVE_INTERACTIVE = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [contenteditable=""], [contenteditable=true]';
const CUSTOM_ROLES = ['button', 'link', 'tab', 'checkbox', 'switch', 'menuitem', 'option', 'radio', 'slider', 'spinbutton', 'textbox', 'combobox', 'treeitem'];
const INTERACTIVE = `${NATIVE_INTERACTIVE}, ${CUSTOM_ROLES.map((r) => `[role=${r}]`).join(', ')}`;
/** roles that take their name from their content */
const NAME_FROM_CONTENT = new Set(['button', 'link', 'tab', 'checkbox', 'switch', 'menuitem', 'option', 'radio', 'treeitem', 'heading']);
const NATIVE_CLICKABLE = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL', 'OPTION']);

const cls = (el: Element) => (typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '');

/** a short, readable address of an element for a failure message */
export function describe(el: Element): string {
  const role = el.getAttribute('role');
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls(el)}${role ? ` role=${role}` : ''}>${text ? ` "${text}"` : ''}`;
}

/** not shown to anyone: hidden, display:none, visibility:hidden (inline or from a stylesheet in the document), or inside a closed <details> */
export function isHidden(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.hasAttribute('hidden')) return true;
    const s = n.ownerDocument.defaultView?.getComputedStyle(n);
    if (s && (s.display === 'none' || s.visibility === 'hidden')) return true;
  }
  // the body of a closed <details> (its summary stays)
  for (let d = el.parentElement?.closest('details'); d; d = d.parentElement?.closest('details')) {
    if (!d.open && !d.querySelector(':scope > summary')?.contains(el)) return true;
  }
  return false;
}

/** the screen reader's view: aria-hidden removes a subtree from it */
const isAriaHidden = (el: Element): boolean => !!el.closest('[aria-hidden=true]');

function contentText(el: Element, seen: Set<Element>): string {
  let out = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) { out += n.textContent ?? ''; return; }
    if (n.nodeType !== 1) return;
    const c = n as Element;
    if (c.getAttribute('aria-hidden') === 'true' || isHidden(c)) return;
    if (['SCRIPT', 'STYLE'].includes(c.tagName)) return;
    // a control embedded in a label is its value, not its name
    if (['SELECT', 'TEXTAREA'].includes(c.tagName) || (c.tagName === 'INPUT' && (c as HTMLInputElement).type !== 'image')) return;
    const own = c.getAttribute('aria-label')?.trim() || (c.tagName === 'IMG' ? c.getAttribute('alt')?.trim() : '') || (c.tagName === 'svg' ? svgTitle(c) : '');
    out += ` ${own || contentText(c, seen)} `;
  });
  return out;
}
const svgTitle = (el: Element): string => el.querySelector(':scope > title')?.textContent?.trim() ?? '';
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** the accessible name of an element (a close version of the W3C algorithm: labelledby, aria-label, native label, content, title) */
export function accessibleName(el: Element, seen = new Set<Element>()): string {
  if (seen.has(el)) return '';
  seen.add(el);
  const doc = el.ownerDocument;
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const text = clean(by.split(/\s+/).map((id) => doc.getElementById(id)).filter((x): x is HTMLElement => !!x)
      .map((x) => x.getAttribute('aria-label')?.trim() || contentText(x, seen)).join(' '));
    if (text) return text;
  }
  const label = el.getAttribute('aria-label')?.trim();
  if (label) return label;
  const tag = el.tagName;
  if (tag === 'IMG' || (tag === 'INPUT' && (el as HTMLInputElement).type === 'image')) { const alt = el.getAttribute('alt')?.trim(); if (alt) return alt; }
  if (tag === 'INPUT' && ['button', 'submit', 'reset'].includes((el as HTMLInputElement).type)) { const v = (el as HTMLInputElement).value; if (v) return v; }
  if (['INPUT', 'SELECT', 'TEXTAREA', 'METER', 'PROGRESS'].includes(tag)) {
    const labels = (el as HTMLInputElement).labels;
    const text = clean([...(labels ?? [])].map((l) => contentText(l, seen)).join(' '));
    if (text) return text;
  }
  if (tag === 'svg') { const t = svgTitle(el); if (t) return t; }
  if (tag === 'FIELDSET') { const l = el.querySelector(':scope > legend'); if (l) return clean(contentText(l, seen)); }
  if (tag === 'TABLE') { const c = el.querySelector(':scope > caption'); if (c) return clean(contentText(c, seen)); }
  const role = el.getAttribute('role') ?? '';
  if (NAME_FROM_CONTENT.has(role) || ['BUTTON', 'A', 'SUMMARY', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LEGEND', 'CAPTION', 'TH'].includes(tag)) {
    const text = clean(contentText(el, seen));
    if (text) return text;
  }
  return el.getAttribute('title')?.trim() ?? '';
}

const FOCUSABLE = `${NATIVE_INTERACTIVE}, [tabindex]`;
/** focusable by a mouse click or script, whether or not the Tab key stops there */
function isFocusable(el: Element): boolean {
  if (!el.matches(FOCUSABLE)) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.tagName === 'A' && !el.hasAttribute('href')) return el.hasAttribute('tabindex');
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'hidden') return false;
  return !isHidden(el);
}

/** the tab stops of `root` in the order that the Tab key visits them (positive tabindex first, then the document order) */
export function tabOrder(root: ParentNode = document.body): HTMLElement[] {
  const all = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => isFocusable(e) && e.tabIndex >= 0 && !isAriaHidden(e) && !e.closest('[inert]'));
  const positive = all.filter((e) => e.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex);
  return [...positive, ...all.filter((e) => e.tabIndex === 0)];
}

/** the React props of a DOM node (react-dom keeps them on the node), to see which elements carry a handler */
function reactProps(el: Element): Record<string, unknown> | undefined {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
  return key ? (el as unknown as Record<string, Record<string, unknown>>)[key] : undefined;
}
const hasHandler = (el: Element, ...names: string[]) => { const p = reactProps(el); return !!p && names.some((n) => typeof p[n] === 'function'); };

const HEADING = /^H([1-6])$/;
const FORM_CONTROL = (el: Element): boolean => {
  const t = el.tagName;
  if (t === 'SELECT' || t === 'TEXTAREA') return true;
  if (t === 'INPUT') return !['hidden', 'button', 'submit', 'reset', 'image'].includes((el as HTMLInputElement).type);
  return ['slider', 'spinbutton', 'textbox', 'combobox', 'checkbox', 'switch', 'radio'].includes(el.getAttribute('role') ?? '');
};

/** Check the rendered `root`; the list is empty when nothing is wrong. */
export function checkA11y(root: ParentNode = document.body, opts: A11yOptions = {}): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const doc = (root as Node).ownerDocument ?? (root as Document);
  const add = (el: Element, rule: string, detail: string) => {
    const issue = { rule, where: describe(el), detail };
    if (!opts.allow?.(issue, el)) issues.push(issue);
  };
  const visible = (el: Element) => !isHidden(el);
  const all = [...root.querySelectorAll('*')].filter(visible);

  // names
  for (const el of root.querySelectorAll(INTERACTIVE)) {
    if (!visible(el) || isAriaHidden(el)) continue;
    if (!accessibleName(el)) add(el, FORM_CONTROL(el) ? 'label' : 'name', 'has no accessible name');
  }

  // figures
  for (const el of all) {
    if (isAriaHidden(el)) continue;
    const role = el.getAttribute('role');
    if (el.tagName === 'IMG' && !el.hasAttribute('alt') && role !== 'presentation' && role !== 'none') add(el, 'img', 'an image without alt');
    if ((el.tagName === 'svg' || el.tagName === 'CANVAS') && !el.closest('button, a, [role=img]:not(svg):not(canvas)')) {
      if (role !== 'img' && role !== 'graphics-document' && role !== 'group' && role !== 'presentation' && role !== 'none') add(el, 'img', `a ${el.tagName.toLowerCase()} without role="img" and a name (or aria-hidden)`);
      else if ((role === 'img' || role === 'graphics-document') && !accessibleName(el)) add(el, 'img', `a ${el.tagName.toLowerCase()} figure without a name`);
    }
    const isFigureTag = el.tagName === 'svg' || el.tagName === 'CANVAS';
    if (['img', 'dialog', 'alertdialog', 'tablist', 'progressbar', 'meter'].includes(role ?? '') && !isFigureTag && !accessibleName(el)) add(el, 'role-name', `role=${role} without a name`);
    // a drawing that is a group of controls (the scenario's waveform lane) names itself too
    if (role === 'group' && isFigureTag && !accessibleName(el)) add(el, 'role-name', 'role=group without a name');
  }

  // ids
  const seenIds = new Map<string, Element>();
  for (const el of root.querySelectorAll('[id]')) {
    const id = el.id;
    if (!id) continue;
    if (seenIds.has(id)) add(el, 'dup-id', `id "${id}" is used twice`);
    else seenIds.set(id, el);
  }
  for (const el of root.querySelectorAll('[aria-labelledby], [aria-describedby], [aria-controls], [aria-owns]')) {
    for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns']) {
      for (const id of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) {
        if (!doc.getElementById(id)) add(el, 'aria-ref', `${attr} points at "${id}", which is not in the document`);
      }
    }
  }

  // headings: in document order, a level may go down by any step but up by one
  let prev = 0;
  for (const el of all) {
    const m = HEADING.exec(el.tagName) ?? (el.getAttribute('role') === 'heading' ? [null, el.getAttribute('aria-level') ?? '2'] : null);
    if (!m || isAriaHidden(el)) continue;
    const level = Number(m[1]);
    if (!accessibleName(el)) add(el, 'heading', 'an empty heading');
    if (prev && level > prev + 1) add(el, 'heading', `jumps from h${prev} to h${level}`);
    prev = level;
  }

  // dialogs
  for (const el of root.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open]')) {
    if (!visible(el)) continue;
    if (el.getAttribute('aria-modal') !== 'true') add(el, 'dialog', 'a dialog without aria-modal="true"');
    if (!accessibleName(el)) add(el, 'dialog', 'a dialog without a name');
    if (!el.matches('[tabindex]') && !el.querySelector(FOCUSABLE)) add(el, 'dialog', 'a dialog with nothing to focus');
  }

  // tabs
  for (const el of root.querySelectorAll('[role=tab]')) {
    if (!visible(el)) continue;
    if (!el.closest('[role=tablist]')) add(el, 'tabs', 'a tab outside a tablist');
    if (!el.hasAttribute('aria-selected')) add(el, 'tabs', 'a tab without aria-selected');
  }
  for (const el of root.querySelectorAll('[role=tablist]')) if (visible(el) && !el.querySelector('[role=tab]')) add(el, 'tabs', 'a tablist without tabs');

  // keyboard
  for (const el of all) {
    const ti = el.getAttribute('tabindex');
    if (ti !== null && Number(ti) > 0) add(el, 'keyboard', `tabindex="${ti}" takes the tab order away from the page`);
    if (isAriaHidden(el)) continue;
    const role = el.getAttribute('role');
    const native = NATIVE_CLICKABLE.has(el.tagName) && (el.tagName !== 'A' || el.hasAttribute('href'));
    if (native) continue;
    // (a wrapper that only stops a click from reaching its parent is a finding too: say so with `allow`, next to the reason)
    if (hasHandler(el, 'onClick') && !role) add(el, 'keyboard', 'has a click handler but is not a button, link or control (a mouse-only element)');
    if (role && CUSTOM_ROLES.includes(role) && !['textbox', 'slider', 'spinbutton', 'combobox'].includes(role)) {
      if (!isFocusable(el) || (el as HTMLElement).tabIndex < 0) { if (!el.closest('[role=listbox], [role=tablist], [role=menu], [role=radiogroup]')) add(el, 'keyboard', `role=${role} is not a tab stop`); }
      if (hasHandler(el, 'onClick') && !hasHandler(el, 'onKeyDown', 'onKeyUp', 'onKeyPress')) add(el, 'keyboard', `role=${role} reacts to a click but not to Enter or Space`);
    }
  }

  // a file input taken out of the page entirely (a label that "looks like a button" around it is not a tab stop)
  for (const el of root.querySelectorAll('input[type=file]')) if (el.hasAttribute('hidden') || doc.defaultView?.getComputedStyle(el).display === 'none') add(el, 'file-input', 'a hidden file input: no keyboard reaches it (use a button that clicks a visually hidden input)');

  // nothing focusable under aria-hidden
  for (const el of root.querySelectorAll('[aria-hidden=true]')) {
    const bad = [el, ...el.querySelectorAll('*')].find((x) => isFocusable(x) && (x as HTMLElement).tabIndex >= 0);
    if (bad) add(bad, 'hidden-focus', 'is focusable inside aria-hidden content');
  }

  const page = opts.page ?? (root === doc.body);
  if (page) {
    const mains = [...doc.querySelectorAll('main, [role=main]')].filter(visible);
    if (mains.length !== 1) issues.push({ rule: 'landmark', where: 'document', detail: `${mains.length} main landmarks (one is needed)` });
    if (!doc.documentElement.getAttribute('lang')) issues.push({ rule: 'lang', where: '<html>', detail: 'no lang attribute' });
  }
  return issues;
}

/** the issues as readable lines (`expect(lines(...)).toEqual([])` shows all of them at once) */
export const issueLines = (issues: A11yIssue[], where = ''): string[] =>
  [...new Set(issues.map((i) => `${where ? `${where}: ` : ''}[${i.rule}] ${i.where} ${i.detail}`))];
