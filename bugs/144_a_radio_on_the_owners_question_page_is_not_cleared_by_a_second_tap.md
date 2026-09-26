# Bug 144 — на странице вопросов выбор (радиокнопка) не снимается повторным касанием

**Status:** 🔴 open — the fix belongs upstream: KAGO's page IS the shipped KAIF 2.8 contour since `plans/104`; origin **#128**
(filed by NDim Space the same day, with the same symptom) carries KAGO's +1 with the owner's words
(`…/issues/128#issuecomment-5846727975`). Arrives with the KAIF update that fixes #128; then verified by a tap on a live page.
**Severity:** S3 — no answer lost (the owner recorded Q1 = A, Q2 = A); a wrong choice cannot be taken back by a second tap, only
replaced by another option.
**Version/build:** KAIF 2.8 `.kaif/tools/contour/review.mjs` (page JS, the `pointerdown` handler of `label.opt`, ~840-845) ·
**When/context:** the owner's first live 2.8 page, `interviews/interview_032`, 2026-09-26 16:21 +03:00

## The owner's words (verbatim, three fields of that page — `interviews/decisions/interview_032_….decision.json`)

«Не снимаются радиокнопки повторным тапом - баг в КАИФ и у тебя»

## Cause (as read in the shipped code, confirmed by #128's analysis)

The page takes the radio's activation over on `pointerdown` (`e.preventDefault(); … if(e.target===inp){inp.checked=!was}`) to let a
second press clear it (contract P3), but the native `click` of the same press re-checks the input afterwards — `preventDefault` on
`pointerdown` does not cancel the click.

## Why not patched locally now

A local edit of `.kaif/tools/contour/review.mjs` makes a shipped file diverge (the next update then hands a merge), and this session
had no touch device to prove a fix on — shipping an unproved page change to the owner's only question page is the worse risk.
The agent-side miss (the defect report was first overlooked) is EXP-0301; the door now prints the whole answer after `--wait`.
