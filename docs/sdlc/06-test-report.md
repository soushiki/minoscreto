# 6 · Test report — iteration 1 (d27188f..cef6282)

## Summary
- **Result: FAIL on one Must (R1a).** Suite 148 green (exact R1c sentence added to the existing check); R1a's own
  acceptance sentence fails and is filed as FIX1 (not left red in the suite).
- Coverage: R1a ✗ (honorific case untested until now, fails) · R1b ✓ · R1c ✓ · R2a ✓ (text, docx, expediente) ·
  R2b ✓ (docx + text round trip) · R2c ✓ · R3 ✓ (undo/redo reducer, pre-change dictionary, count-mismatch fallback) ·
  S1 ✓ (no fetch/XHR/eval/new Function/innerHTML added) · S2 ✓ (T1: 23.9 vs 23.8 ms).

## Failures
- **R1a** «El señor fidel Castro firmó.» → no PERSONA at all (whole name leaks). Same for «La señora ana Gómez»,
  «el doctor fidel Castro». Without an honorific («Declaró fidel Castro») it works; with an honorific and a
  capitalized first name it works. So the honorific path rejects a lowercase first name. → FIX1.

## Review findings (inline code + security review)
1. **Medium · privacy** `joinAdjacent` (`src/model/text.js:37`) joins before exclusions are applied, and the joined
   span keeps the first part's key. If the user had excluded «Fidel» at that spot, adding «castro» makes the whole
   «Fidel castro» unreplaced → «castro» leaks. (The reverse — an excluded «castro» — just gets anonymized, safe side.)
   Probe: `analyze` with excluded `0:6` returned one span `0:0` replaced. → FIX2.
2. **Low · robustness** `readVariants` (`src/model/dictionary.js:44`) tests `dict[k] !== undefined`, which accepts
   inherited names: a crafted `__variants__` with `toString`/`constructor` keys is kept, and a raw `"__proto__"` key
   re-parents the variants object to an attacker array. Local object only, restore output unaffected. Use
   `Object.hasOwn`. → FIX3.
3. Security: variants reach the docx through `node.textContent` (escaped), the restorer only reads own placeholder
   keys, no network or code-eval added. Attack-test suite n/a (no API/backend; S1 grep is the guard).
4. Accepted by design (04-plan decision): if the placeholders are reordered by hand while counts stay equal, the
   nth-variant rule restores the wrong casing variant. Text stays a correct name; no fix.

## Debt
- No linter/complexity tool configured in the repo; new functions are ≤12 lines. No DEBT task.

## Smoke (manual, ≈5 min — pending user)
1. `npm run dev`, paste: «Firmó fidel Castro. Testigo: FIDEL castro. Pagó Fidel castro y luego castro se fue.»
2. Each name shows as one [PERSONA_n]; if «Fidel castro» is split, click «castro» and add it to the label → one tag.
3. Download, open the restorer, load the .json and the protected file → text matches exactly (casing too).
4. Undo the add, redo it → output identical each time.
