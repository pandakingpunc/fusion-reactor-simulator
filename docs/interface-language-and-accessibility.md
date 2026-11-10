# Interface language and accessibility

What the interface guarantees in Turkish and for keyboard and screen-reader users, what is checked by the
test suite, and what is not (and so belongs on the release checklist).

## Language

The interface is in English or Turkish. Every text the interface draws comes from a dictionary
(`src/i18n/*.ts`, the wizard and catalog dictionaries, `src/edu/i18n`), and numbers follow the language
(a decimal comma and a thousands point in Turkish). Files, share links, CSV and JSON exports keep the
decimal point whatever the language is.

**Sentences written by the physics layer are translated by pattern.** Events, warnings, termination reasons,
diagnoses and fixes are built as English sentences inside `src/physics` (part of exports, run files and tests, so
the physics layer does not change). The interface recognises each sentence by a regular expression and writes it
again in Turkish with the same numbers and a decimal comma (`src/i18n/physicsText.ts`, the API and the fallback;
`src/i18n/physicsText.tr.ts`, the rule table, loaded with the Turkish dictionary). It is applied to the
termination box, the report warnings, the Compare "Termination" row, the Learn and Validation verdicts, and the
event log. A sentence no rule knows is shown as the model wrote it, and so is a free-text detail inside a known
sentence (the error message of the equilibrium solver, a scenario trigger's own name); CSV, JSON, run files, figures
and share links keep the English sentences. The explanatory notes of the report (the definitions under stable time, Q_eng and the
Lawson ratio) have no rules yet and stay English. The step-control notes (`src/ui/settingsNotes.ts`) have their own
dictionary keys and are translated first. `src/i18n/physicsText.test.ts` runs the presets and forced shots and fails
on any emitted sentence that has no rule, so a changed physics template is found there. The pseudo-locale sweep
(`src/ui/pseudoLocale.test.tsx`) still exempts the model's sentences (`modelTexts()` in
`src/ui/testing/appHarness.tsx`). The lasting fix remains for the physics layer to return a message code with
parameters; that is a change to `src/physics`.

A number typed into a field is read the way the interface writes it: `1,5`, `1.5`, `1.234,5` and `1,234.5`
are accepted, grouping that is not in threes (`1,2,3`) is rejected.

## What the tests check

- **Hard-coded text** (`src/ui/pseudoLocale.test.tsx`): every main screen is rendered in a pseudo-locale in
  which every dictionary text is fenced (`[!! ... !!]`); any visible text, label-like attribute or canvas
  text that is not fenced, and is not a number, unit, symbol or an allowed name, fails. The global allow-list
  (`src/ui/testing/pseudo.ts`) holds units, symbols and names only; words that are ordinary words elsewhere
  are allowed per screen in the test, with the reason.
- **Accessibility** (`src/ui/testing/a11y.ts`, run by `src/ui/a11y.test.tsx`): names, roles, dialog
  semantics, tabs, duplicate ids, `aria-*` references, heading levels, a visible `<h1>`, one `<main>`,
  `lang`, mouse-only elements (a click handler on something a keyboard cannot reach) and a hidden file input.
  `src/ui/a11yKeyboard.test.tsx` checks where the focus goes, that Tab reaches the main controls in reading
  order without a trap, that a dialog keeps Tab inside, and (from the text of the stylesheets, not from a
  layout) the focus ring, the one-column phone layout and the 32 px touch targets.
- **First paint** (`src/ui/firstPaint.test.tsx`): a saved Turkish locale never paints English, and the key the
  inline script of `index.html` reads is the key the store saves under.

## What the tests cannot check (manual, before a release)

jsdom has no layout, no real Tab order and no screen reader, so these are done by hand and recorded in the
release notes of the release that was checked:

1. Screen reader pass over the wizard, the run screen and the report with NVDA (Windows, Firefox and Chrome)
   and TalkBack (Android): names read sensibly, dialogs announce and trap focus, live values are not noisy.
2. Real Tab and Shift+Tab pass over every screen: no trap, a visible focus ring, a sensible order.
3. A real 375 px phone: no horizontal scroll on the wizard, run and compare screens, touch targets reachable.
4. Turkish reading of the whole interface by a Turkish speaker, including the physics-layer sentences (translated by pattern, see above).

## Known gaps in the automated checks

- The panel titles of the screens are `<h3>` directly under the page `<h1>` (there is no `<h2>` level). The
  heading-order rule therefore does not count the `<h1>` as an outline level; a skip inside the outline
  (h2 to h4) is still reported.
- The embedded view (`#/embed`, `src/ui/persist/EmbedView.tsx`) has no heading of its own.
- A one-letter English word ("a", "I") in hard-coded text is not seen by the pseudo-locale sweep, which
  treats one letter as a symbol or an index.
