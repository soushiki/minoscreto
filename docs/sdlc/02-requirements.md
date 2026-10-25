# 2 · Requirements (size S)

## Summary
- **Problem:** (a) a name with one word in lowercase is only partly tagged: «Fidel castro» works since d27188f, but «fidel Castro» and «FIDEL castro» leave a word visible. (b) Clicking a word to add it to an existing label (`addAlias`, `src/model/entities.js:260`) appends a separate alias, so «Fidel castro» comes out as «[PERSONA_1] [PERSONA_1]» instead of one tag.
- **Fix:** R1 detects the whole name in every casing mix. R2: a word added to a label that is next to an occurrence of that label joins it into one span (one tag, restores to the exact original text). The same word elsewhere, on its own, gets the same label and restores to exactly that word (triage decision: store the variant per occurrence).
- **Acceptance check:** see R1–R3 below; each criterion becomes a vitest case in `tests/`.
- **Out of scope:** new name lists, the ML layer (`ml-layer` branch), changing the dictionary file format beyond what R2 needs, other entity types (cédula, NIT, addresses).
- **Risk:** more lowercase matching → false positives on common words that are also surnames («ríos», «paz», «león»). R1 c guards this.

## Stories
- **R1 (Must):** As a user anonymizing a legal document, I want a person name tagged whole whatever its casing, so no part of the name leaks.
  - a. Given «El señor fidel Castro firmó», when detection runs, then «fidel Castro» is one PERSONA span.
  - b. Given «FIDEL castro» and «Fidel castro» (regression d27188f), then each is one PERSONA span.
  - c. Given «pagó en ríos de dinero» or «la paz del acuerdo», then nothing new is tagged (all existing tests stay green).
- **R2 (Must):** As a user, I want a word I click to join the label next to it, so the label shows once.
  - a. Given «Fidel castro» with only «Fidel» tagged [PERSONA_1], when I add «castro» to [PERSONA_1], then the output is «[PERSONA_1]» (one tag, no repeat).
  - b. Given that document, when I restore, then the text is exactly «Fidel castro» (same casing and spacing).
  - c. Given «castro» also appears alone elsewhere, then it shows [PERSONA_1] there and restores to «castro».
- **R3 (Should):** Undo/redo of the add (R2) returns to the exact previous state, and a dictionary saved before the change still restores.

## Non-functional
- S1: all processing stays in the browser; no new network calls, no `eval` (exposed: yes; backend items of the baseline don't apply, nothing server-side).
- S2: detection time on the sample document stays within +10 % of today's.

## Out of scope
See Summary.

## Decisions (approved 2026-10-24 with the defaults)
1. All-lowercase «fidel castro»: only when both words are on the name lists (FIRST_NAMES + SURNAMES), and only as a weak suggestion, not auto-tagged.
2. R2 joins on either side («castro Fidel» too).
3. R2 also applies to the expediente view (same model function).
