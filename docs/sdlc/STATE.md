# SDLC state

project: Minoscreto (anonimizador de documentos legales colombianos, React + Vite, Netlify)
goal: Detect person names in every casing permutation («Fidel castro», «fidel Castro», «FIDEL castro»…) and make a word added to an existing label merge with an adjacent occurrence, so the label appears once and restores to the exact original text.
size: S
exposed: yes    # yes → apply references/app-security.md (web, mobile, desktop, API)
regulated: no   # yes → externally owned values rules (design + implement)
next: 5-implement

## Stages
- [x] 0-triage
- [~] 1-research
- [x] 2-requirements   (approved 2026-10-24)
- [~] 3-design         (gate: user approval)
- [x] 4-plan
- [x] 5-implement      current task: FIX1
- [~] 6-test         (iteration 1: R1a failed → FIX1–3, re-run after)
- [ ] 7-release
- [~] 8-maintain

(Mark skipped stages `- [~]`.)

## Log
<!-- YYYY-MM-DD | stage | one-line result -->
2026-10-24 | 0-triage | size S (bug fix + rule extension); exposed yes (web app, all processing local); next 2-requirements
2026-10-24 | 0-triage | user confirmed goal + size; decision: a word added to a label apart from its other occurrences restores to that exact word (store the variant per occurrence)
2026-10-24 | 0-triage | context: «Fidel castro» already works on main since d27188f (live); «fidel Castro» still fails; the label bug lives in addValue/addAlias (src/model/entities.js) and restore
2026-10-24 | 2-requirements | approved: R1 name in any casing (Must), R2 clicked word joins adjacent label, one tag, exact restore (Must), R3 undo + old dictionaries (Should); S1 local only; defaults for Q1–Q3 → next 4-plan
2026-10-24 | 4-plan | 1 iteration, T1–T4 ≈5 h; decided __variants__ JSON key for per-occurrence restore (old dicts unchanged) → next 5-implement
2026-10-24 | 5-implement | T1 done (Sonnet subagent): fidel Castro / FIDEL castro tagged whole, bare lowercase pair weak; 139 tests green; detection 23.9 vs 23.8 ms → next T2
2026-10-24 | 5-implement | T2 done (Sonnet subagent): findOccurrences join merges same-entity hits split by spaces (text/docx/expediente); 141 tests green; user approved extra files → next T3
2026-10-24 | 5-implement | T3 done (Opus): hidden __variants__ per occurrence, nth-variant restore with count-mismatch fallback, old dicts unchanged; 147 tests green; also touched protectedFiles.js + expediente/anonymize.js → next T4
2026-10-24 | 5-implement | T4 done (Sonnet subagent): add-alias → undo → redo test (reducer unchanged, snapshots exact); S1 grep clean; 148 tests green; iteration 1 complete → next 6-test
2026-10-24 | 6-test | FAIL R1a (honorific + lowercase first name untagged); review: exclusion swallowed by join (medium), hasOwn in readVariants (low); filed FIX1–3 → next 5-implement
