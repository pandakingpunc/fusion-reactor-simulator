# Interface language and accessibility

What the interface guarantees in Turkish and for keyboard and screen-reader users, what is checked by the
test suite, and what is not (and so belongs on the release checklist).

## Language

The interface is in English or Turkish. Every text the interface draws comes from a dictionary
(`src/i18n/*.ts`, the wizard and catalog dictionaries, `src/edu/i18n`), and numbers follow the language
(a decimal comma and a thousands point in Turkish). Files, share links, CSV and JSON exports keep the
decimal point whatever the language is.

**Known limit: sentences written by the physics layer stay English.** Events, warnings, termination
reasons and report notes are built as English sentences inside `src/physics` and shown as they are, in the
Turkish interface too. The one exception is the step-control notes (`src/ui/settingsNotes.ts`), which are
translated. The Turkish interface is therefore not Turkish all the way down: the labels, buttons,
explanations, chart texts and units are, the model's own messages are not. The pseudo-locale sweep
(`src/ui/pseudoLocale.test.tsx`) exempts exactly these sentences (`modelTexts()` in
`src/ui/testing/appHarness.tsx`) and nothing else. The lasting fix is for the physics layer to return a
message code with parameters that the interface translates; that is a change to `src/physics` and belongs
to a later release.

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
4. Turkish reading of the whole interface by a Turkish speaker, including the physics-layer sentences that
   stay English (see above).

## Known gaps in the automated checks

- The panel titles of the screens are `<h3>` directly under the page `<h1>` (there is no `<h2>` level). The
  heading-order rule therefore does not count the `<h1>` as an outline level; a skip inside the outline
  (h2 to h4) is still reported.
- The embedded view (`#/embed`, `src/ui/persist/EmbedView.tsx`) has no heading of its own.
- A one-letter English word ("a", "I") in hard-coded text is not seen by the pseudo-locale sweep, which
  treats one letter as a symbol or an index.
