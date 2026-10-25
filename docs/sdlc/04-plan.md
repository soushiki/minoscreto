# 4 · Plan (size S)

## Summary
- One iteration, 4 tasks, ≈ 5 h. Demo: load a doc with «fidel Castro», «FIDEL castro», «Fidel castro» and a lone
  «castro»; every name is one [PERSONA_n]; click-adding «castro» shows one tag; restore gives back the exact text.
- Order: R1 detection (independent) → R2a one span → R2b/c per-occurrence restore → R3 undo + old-dictionary check.
- No backend, so the exposed-yes baseline is S1 only (no network, no `eval`), checked in T4.
- **Decision taken here (no design stage for S):** per-occurrence variants go in an optional `"__variants__"` key of
  the JSON dictionary: `{"[PERSONA_1]": ["Fidel castro", "castro"]}`, the nth occurrence of a placeholder restores to
  the nth variant. If the count in the text differs from the list, every occurrence falls back to the main value.
  Dictionaries without the key restore exactly as today (R3). The plain-text dictionary format stays unchanged.

## Iteration 1 — every casing tagged whole, one tag per name, exact restore
- [x] T1 (M) Detect «fidel Castro» (lowercase first name before a capitalized surname) and «FIDEL castro»
  (upper run + lowercase surname); all-lowercase «fidel castro» only as a weak suggestion when both words are on the
  lists (decision 1) — R1 a/b/c, S2 — done when: new cases in `tests/addressesNames.test.js` pass, incl. «ríos de
  dinero» / «la paz del acuerdo» untagged, the full suite stays green, and sample-doc detection time is within +10 %
  — files: `src/model/detect.js` (`lowercaseNamePart`, `capitalizedRuns`), `src/model/caselessNames.js`
  (`detectUpperNames`), `src/model/lexicon.js` — model: Sonnet
  — hecho: `detect.js` (verb-like capitalized word no longer swallowed before «fidel Castro»; bare two-word lowercase deferred),
  `caselessNames.js` (bare lowercase pair = weak); 6 new checks; suite 139 green; detection time 23.9 ms vs 23.8 ms before
- [x] T2 (M) Join adjacent occurrences of the same entity (only spaces between, either order: «castro Fidel» too)
  into one span, in the anonymizer and the expediente view — R2a, decision 2/3 — done when: «Fidel castro» with
  «Fidel» tagged + `addAlias(…, 'castro')` anonymizes to «[PERSONA_1]» in text and docx output; test in
  `tests/model.test.js` and `tests/expediente.test.js` — files: `src/model/analysis.js` (`analyze`),
  `src/model/entities.js` (`addAlias`), `src/model/docx/edit.js` if ranges are applied there — model: Sonnet
  — hecho: `findOccurrences(…, { join: true })` in `text.js` merges same-entity hits separated only by spaces; used by `analyze`, docx and expediente anonymize (entities.js/edit.js untouched); 2 new tests; suite 141 green
- [x] T3 (M) Per-occurrence variants: `buildDictionary` records the exact source text of each occurrence (joined span
  = «Fidel castro», lone = «castro») under `__variants__`; `restoreText`/`restoreDocx` use the nth variant with the
  fallback above; `parseDictionary` keeps `__variants__` instead of dropping it — R2b/c, R3 — done when: round trip
  anonymize → restore returns the exact original (casing + spacing) for the demo doc; a pre-change dictionary
  fixture restores unchanged; mismatch count falls back — files: `src/model/dictionary.js`,
  `src/model/docx/restore.js`, `src/viewmodels/useAnonymizer.js`, `src/viewmodels/useExpediente.js`,
  `tests/model.test.js` — model: Opus
- [x] T4 (S) Undo/redo of `add-alias` returns the exact previous entities and output; S1 guard — R3, S1 — done when:
  reducer test in `tests/app.test.jsx` (add → undo → redo) passes, and `grep -rnE "fetch\(|XMLHttpRequest|eval\(|new
  Function" src` shows nothing new vs `main` — files: `src/viewmodels/anonymizerState.js`, `tests/app.test.jsx` —
  model: Sonnet
  — hecho: reducer already restores exact snapshots; added add-alias → undo → redo test in `tests/app.test.jsx` (entities + analyze output equal); S1 grep clean; suite 148 green

## Iteration 1 — fixes from 6-test (see 06-test-report.md)
- [x] FIX1 (S) Honorific + lowercase first name: «El señor fidel Castro firmó.», «La señora ana Gómez firmó.»,
  «Firmó el doctor fidel Castro.» → one strong PERSONA span each (R1a) — done when: the cases are in the
  `nombre de pila en minúscula…` block of `tests/addressesNames.test.js` and the suite stays green — files:
  `src/model/detect.js` (honorific branch of `detectPeopleAndPrefixedOrgs`) — model: Sonnet
  — hecho: cause was in `src/model/caselessNames.js` (lowercase honorific never enters a capitalized run): allow lower first name + Title surname when a cue precedes; added doctor/dr/dra cues; 3 cases added; suite 151 green
- [x] FIX2 (S) Don't let an excluded occurrence swallow its neighbour: join only when no part's own key is excluded
  (keep parts separate otherwise) — done when: excluded «Fidel» + added «castro» still replaces «castro»; test in
  `tests/model.test.js` — files: `src/model/text.js` (`joinAdjacent`), `src/model/analysis.js`,
  `src/model/docx/anonymize.js` — model: Sonnet
  — hecho: `findOccurrences` takes `isExcluded(start)`; `joinAdjacent` won't join a part whose own key is excluded; wired in analysis.js and docx/anonymize.js; 1 test added; suite 152 green
- [x] FIX3 (XS) `readVariants`: accept only `Object.hasOwn(dict, k)` keys — done when: a `__variants__` with
  `__proto__`/`toString` keys yields `{}` with an ordinary prototype; test in `tests/model.test.js` — files:
  `src/model/dictionary.js` — model: Sonnet
  — hecho: `dict[k] !== undefined` replaced by `Object.hasOwn(dict, k)`; 1 test added
- [x] FIX4 (S) Lowercase first name before a capitalized full name: «Firma: ana María Gómez» → one strong PERSONA
  «ana María Gómez» (today «ana» leaks) — done when: case added to the `nombre de pila en minúscula…` block of
  `tests/addressesNames.test.js`, suite green — files: `src/model/caselessNames.js` and/or `src/model/detect.js`
  (merge a cue-led lowercase word into the adjacent capitalized span) — model: Sonnet
  — hecho: `CUE_BEFORE` exported; detect.js folds a cue-led lowercase first name into the adjacent capitalized run; 2 tests added (1 case + 1 no-false-positive); suite 155 green
- [x] FIX5 (XS) Abbreviated honorific with dot: «Dra. lucía Paz llegó.», «El Dr. fidel Castro firmó.» → one strong
  PERSONA each — done when: cases in the same test block, suite green — files: `src/model/caselessNames.js`
  (`CUE_BEFORE` / where the preceding text is cut) — model: Sonnet
  — hecho: the dot was not the cause (Dr./Dra. already matched CUE_BEFORE); «Paz» is not in SURNAMES, so caselessNames.js now accepts a title-case non-common word after a cue-led lowercase first name; 2 cases added; suite 158 green
