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
- [ ] T4 (S) Undo/redo of `add-alias` returns the exact previous entities and output; S1 guard — R3, S1 — done when:
  reducer test in `tests/app.test.jsx` (add → undo → redo) passes, and `grep -rnE "fetch\(|XMLHttpRequest|eval\(|new
  Function" src` shows nothing new vs `main` — files: `src/viewmodels/anonymizerState.js`, `tests/app.test.jsx` —
  model: Sonnet
