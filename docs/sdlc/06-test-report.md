# 6 · Test report — iteration 1, re-run after FIX1–5 (d27188f..95bf36b)

## Summary
- **Result: PASS.** Suite 158/158 green; all Musts pass. FIX4 (305ee5a) and FIX5 (95bf36b) close the two leaks below.
- Coverage: R1a ✓ (3 honorific cases, FIX1) · R1b ✓ · R1c ✓ · R2a ✓ · R2b ✓ · R2c ✓ · R3 ✓ · S1 ✓ · S2 ✓ (iteration 1).
- Previous findings closed: R1a (FIX1), exclusion swallowed by join (FIX2, test in model.test.js), inherited keys
  in `readVariants` (FIX3, test with `__proto__`/`toString`).

## Failures
- None. FIX4/5 probe: «Firma: ana María Gómez», «Dra. lucía Paz», «El Dr. fidel Castro» → one strong PERSONA each;
  «juez Castro», «doctora paz León», «ríos de dinero», «la paz del acuerdo» → nothing. A FIX5 first pass tagged
  «juan Bogotá» / «rosa Medellín»; PLACES + NOT_NAMES now excluded, with a test.
- Known limit (accepted): a cue-led lowercase first name followed by a city («Firma: juan Bogotá») is not tagged.

## Review findings (inline review + security review of 32b15a5..58b692a)
Probe of the widened honorific rule (`CUE_BEFORE` + `cue && lower → title`, `src/model/caselessNames.js:39`):
- «El señor juez Castro decidió.» → nothing · «La doctora paz León» → nothing · «El señor de la Torre» → nothing
  (no new false positives; R1c guard holds).
- «El señor fidel Castro ruiz firmó.» → «fidel Castro ruiz» ✓ · «Firmado por el Dr Castro.» → «Castro» ✓.
1. **Medium · privacy** «Firma: ana María Gómez» → only «María Gómez» tagged; «ana» leaks. The capitalized
   detector claims «María Gómez» first, so the caseless run starting at «ana» can't extend into it. → FIX4 ✓.
2. **Medium · privacy** «Dra. lucía Paz llegó.» → no PERSONA at all, while «el doctor fidel Castro» works. The
   abbreviation-with-dot at sentence start doesn't reach the cue path (`dra` + `.`). → FIX5 ✓.
3. Security: FIX3 is sound — `parseDictionary` assigns strings, so `result.__proto__` is never an own key and
   `Object.hasOwn` can't pass it. FIX2 only adds a predicate; no new input surface, network or eval. No API → no
   attack-test suite (S1 grep is the guard).
4. Accepted by design (unchanged): reordered placeholders with equal counts restore the wrong casing variant.

## Debt
- No linter configured; FIX diff is +43/−15, no function grew past ~15 lines. No DEBT task.

## Smoke (manual, ≈5 min — PASS on prod 2026-10-24, user)
1. `npm run dev`, paste: «El señor fidel Castro firmó. Testigo: FIDEL castro. Pagó Fidel castro y luego castro se fue.»
2. Each name is one [PERSONA_n]; if «Fidel castro» is split, click «castro» → add to the label → one tag.
3. Exclude «Fidel» at one spot, then add «castro» → «castro» there is still replaced.
4. Download, restore with the .json → text matches exactly (casing too). Undo/redo the add → output identical.
