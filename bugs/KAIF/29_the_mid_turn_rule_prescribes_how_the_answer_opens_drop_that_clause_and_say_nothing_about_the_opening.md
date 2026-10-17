# KAIF improvement: «The owner's word mid-turn» prescribes how the agent's answer OPENS — drop that clause and say nothing about the opening

kaif-fp: AGENT_GUIDE.md "The owner's word mid-turn" item 2 :: answer-opening-prescribed :: v2.9
**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/156
**Autocapture** (from `.kaif/kaif.json` + update receipt): KAIF 2.9 · project KAGO · sphere programming · language ru ·
tracking origin · agent system claude-code (Claude Opus 5.5, VS Code extension) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0
**Dedup attestation:** searched `bugs/KAIF/` (`grep -ril "first words" bugs/KAIF/` → none) and origin issues
(`gh issue list --repo MikalaiKryvusha/KAIF --state all --search "first words mid-turn"` → #144, #138, #88). #144 retired the HOOK that
rejected an answer not opening with the owner's literal first words; the same demand survived in the RULE TEXT of 2.9. Not covered.
**Found:** 2026-10-17, right after the KAGO 2.8 → 2.9 update.

## The owner's word (verbatim, chat 2026-10-17)

«Сразу ответить, начав с ваших слов в «…», - не нужно начинать с моих слов, это БАГ КАИФ, который меня бесит. Я задал вопрос. ИИ Агент
тут же отвечает и работает дальше без оставновки чата. Заведи импрув в кайф, что не НУЖНО с моих слов начинать в ответе. Не давайте этого
указания "начинай со слов владельца" - просто не упоминайте этой инструкции. И не говорите в инструкции "не начинай со слов владельца" -
не говорите, с чего ИИ агенту начинать, пусть он сам решает. Его задача - ОТВЕТИТЬ НЕЗАМЕДЛИТЕЛЬНО ВЛАДЕЛЬЦУ и ПРОДОЛЖИТЬ РАБОТУ»

Rendered: the agent answers the owner's mid-turn question AT ONCE and goes on working, without stopping the chat. HOW the answer opens is
the agent's own call. The rule must neither order a particular opening nor forbid one — it must not mention the opening at all.

## Where the clause lives in 2.9 (the release's `KAIF-CORE-BUNDLE.md`)

- the `AGENT_GUIDE.md` template, «The owner's word mid-turn», item 2 (bundle line 1186): «**Answer it AT ONCE — your next output, before
  any further tool call — by its kind, AS TEXT, opening with its first words in «…»:**»;
- the update's template news (bundle lines 16 and 98): «"The owner's word mid-turn" now says: answer as text that opens with the owner's
  first words quoted, then WORK ON in the same turn».

## Proposed change

Item 2 opens: «**Answer it AT ONCE — your next output, before any further tool call — by its kind, AS TEXT:**» and the rest stays
(«… Unless he asked you to stop, answer, then WORK ON with what you were doing before his word, in the same turn — never end the turn just
to answer; the final message repeats the answer.»). The news line: «answer at once as text, then WORK ON in the same turn». No sentence
anywhere about how the answer begins — not an order, not a ban. A `/fable-judge` hunt or a hook that checks the opening goes with it.

## Cost and violated invariant

**the owner's experience**: a formula the agent must put at the top of every answer is ceremony on what the owner reads; in his words it
is a defect that angers him. #144 already removed its mechanical enforcement for the same reason; the text kept the demand.

## Local remediation

KAGO: the clause removed from the deployed `AGENT_GUIDE.md` (item 2) on the owner's word, 2026-10-17 — «Его задача - ОТВЕТИТЬ
НЕЗАМЕДЛИТЕЛЬНО ВЛАДЕЛЬЦУ и ПРОДОЛЖИТЬ РАБОТУ» (commit `754a563`); the next update will show the
module as locally edited until upstream takes this change.
