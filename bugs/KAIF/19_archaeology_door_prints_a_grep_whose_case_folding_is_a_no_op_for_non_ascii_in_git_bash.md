# KAIF bug: the archaeology door prints a `grep -rniE` to «run as printed» — in Git Bash on Windows `-i` does not fold non-ASCII case, so a non-English deployment attests searches that silently skipped every capitalized hit

kaif-fp: `.kaif/tools/contour/core.mjs` archaeology command + `/interview` step 3d :: search-false-negative-non-ascii-locale :: v2.7
**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/74
**Autocapture** (from `.kaif/kaif.json` + update receipt): KAIF 2.7 · project KAGO · sphere `programming` ·
language `ru` · i18n language pack `ru` (8 owner docs) · tracking `origin` · agent system claude-code (+4 mirrored) ·
OS Windows 11 Pro 10.0.26200 · Node v24.15.0 · shell Git Bash: `GNU bash 5.2.21(1)-release (x86_64-pc-msys)`,
`grep (GNU grep) 3.0`, `LANG=''`, `LC_ALL=''`
**Dedup attestation:** searched `bugs/KAIF/` (`grep -ril "archaeology\|grep -rniE\|locale\|LC_ALL" bugs/KAIF/` → tickets
04 and 05, both other surfaces: the diff preview and the contour voice) and origin issues
(`gh issue list --repo MikalaiKryvusha/KAIF --state all --search "archaeology grep locale"` → #50, #48, #41;
`--search "grep -i Cyrillic case"` → none; `--search "LC_ALL"` → none). Origin #70 is the request that CREATED the
door; nothing reports its search being blind. No match found.

**Severity:** S2 by this project's ladder — no data lost; the cost is the exact thing the door exists to prevent
(origin #70): a question the owner already answered is served to him again, now with a machine-blessed attestation.

## Expected per canon

`/interview` step 3d (KAIF 2.7): *«**Run the search.** The door prints the ready command for the question's own
heading … **Run it as printed**; broaden it when the topic has a synonym, never narrow it.»* and *«`N = 0` is an
honest attestation: the axis does not promise a find, it promises you searched and said with what.»*
The printed command carries `-i`: the promise is a CASE-INSENSITIVE search of the owner's prior answers.

## Got in the field

The door, on a Russian question heading (`node .kaif/tools/contour/review.mjs <doc> --check`, verbatim):

```
PRE-FLIGHT REFUSED TO OPEN (spec §2, exit 3):
  Q1: no archaeology line — … Run the search:  grep -rniE "строк|достав|открыва|закрыва|сесси|оставля" interviews/ GOAL.md MASTER_PLAN.md plans/  — read the hits, …
```

That command, run as printed in this deployment's Git Bash, and the same command with a UTF-8 locale:

```
as printed, default locale — matching lines: 1180
same, LC_ALL=C.UTF-8 — matching lines:          1241
```

61 lines (4.9 %) are invisible to the command as printed — the lines whose ONLY occurrences of the searched stems
are capitalized or upper-cased. Per path: `interviews/` 12 · `GOAL.md` 4 · `MASTER_PLAN.md` 2 · `plans/` 43.

> ✏️ **Correction №1, 2026-09-18 (posted as a comment on the origin issue).** The first edition of this ticket said
> here: «every line where the word is capitalized» and «the prior answers the door is looking for are
> over-represented among the misses». The first is too wide (a line with one lower-case hit is still found); the
> second was NEVER MEASURED — «over-represented» is a claim about proportion, and no proportion was counted. It
> stays retracted.
>
> ✏️ **Correction №2, same evening — SUPERSEDED by №3 below (its conclusion overshot; kept as a record).
> Correction №1 was itself wrong, and in the direction that weakened this ticket.** №1 went on to say that the four `GOAL.md` misses are «lines 9–10 (a header block) and 212, 1275 (a
> sentence-initial «Строка») — none of them is an owner decision. So for THIS command no prior answer was
> hidden». I took that classification from a judge's pass without opening the lines. A third judge opened them:
> **`GOAL.md:9-10` carry the owner's decision on the prayer cadence** — `GOAL.md:7` reads «Каденция уточнена
> владельцем 2026-08-28 (интервью 017, Q2 = B)», and lines 9–10 are that decision written into the canon IN
> CAPITALS: «ПРОИЗНЕСИ ЕЁ В ЧАТЕ ЦЕЛИКОМ ОДИН РАЗ НА СЕССИЮ … ПЕРЕД КАЖДОЙ СЛЕДУЮЩЕЙ ЗАДАЧЕЙ — ОДНА СТРОКА»
> (the owner's recorded answer: `**Ответ:** B`, interview 017, 2026-08-28T01:23:51+03:00). **So the risk case WAS
> observed in this run:** the door's own printed command, built for a question about what opens and closes a
> session («строк|достав|открыва|закрыва|сесси|оставля»), did not see the owner's prior decision about what is
> said at the opening of a session — its only hits on those lines are «СЕССИ» (line 9) and «СТРОК» (line 10), both
> upper-case (`sed -n 9p GOAL.md | LC_ALL=C.UTF-8 grep -oiE …` → `СЕССИ`; the same without the prefix → 0 hits;
> likewise line 10 → `СТРОК` / 0). Lines 212 and 1275 are
> sentence-initial «Строка» in agent commentary. Proportion is still not measured; one hidden prior answer is.
>
> ✏️ **Correction №3, same evening — №2 overshot; the paragraph above stands only as a record.** Its facts about
> lines 9–10 are right (they are the owner's Q2 = B decision in capitals, and the printed command misses them), but
> its conclusion — «the risk case WAS observed … did not see the owner's prior decision … one hidden prior answer» —
> is false. The SAME printed command, in the default locale, still lists that decision twice: the option the owner
> chose, `interviews/interview_017_five_method_forks.md:52` («**Целиком один раз на сессию** … одна строка»), and
> `GOAL.md:12` («полный текст раз в сессию»). Checked by me, both locales: `grep -rniE "<stems>" interviews/ GOAL.md
> MASTER_PLAN.md plans/ | grep -E "^interviews/interview_017_five_method_forks.md:52:|^GOAL.md:(9|10|12):"` → default:
> `…017…:52` and `GOAL.md:12`; with `LC_ALL=C.UTF-8`: those two plus `GOAL.md:9`, `GOAL.md:10`. **What this run
> observed:** a capitalized COPY of an owner decision was missed, so the attested N was low by 2 in `GOAL.md`; the
> decision itself was still found, so no prior answer was hidden. Correction №1's closing sentence, as posted on the
> issue — «the hidden-answer case is a plausible risk in a canon that writes emphatic decisions in capitals, not an
> observation» — was TRUE and stands; only its «none of them is an owner decision» was false. Found by a fourth judge pass; I had copied the third pass's conclusion without re-running the
> search on the interview record.

The mechanism, isolated (no repository needed):

```
$ printf 'СТРОКА ДОСТАВКИ\nСтрока доставки\nстрока доставки\n' > case.txt
$ grep -ciE "строк|достав" case.txt
2
$ LC_ALL=C.UTF-8 grep -ciE "строк|достав" case.txt
3
```

`locale` in that shell prints `LC_CTYPE="C.UTF-8"` (a derived default), which makes the trap harder to see: the
shell LOOKS UTF-8, `grep -i` does not fold. A sibling face of the same class, met in the same session by the agent's
own hand-written search: a Cyrillic BRACKET expression (`строк[аиуе]`) matches NOTHING in the default locale
(0 hits vs 4 under `LC_ALL=C.UTF-8`), and `git grep -E` with a multibyte bracket returns nothing even WITH
`LC_ALL=C.UTF-8`. An independent judge caught the published «→ 0 hits»; the agent had already acted on it.

## Repro (deterministic)

1. Windows 11, Git for Windows (Git Bash), no `LANG`/`LC_ALL` exported — the default of a fresh install.
2. Run the three-line `printf` / `grep -ciE` block above: `2`, then `3` with `LC_ALL=C.UTF-8`.
3. Or, on any `ru` deployment of 2.7: write an interview dated ≥ 2026-09-18 with a Russian `### Q1.` heading, run
   `node .kaif/tools/contour/review.mjs <doc> --check`, run the printed grep with and without `LC_ALL=C.UTF-8`, compare `wc -l`.

## Cost and violated invariant

**honest-green.** The attestation `<!-- archaeology: grep … → N hits · read: … · prior: none -->` is a machine-checked
form whose N is systematically low on this platform, and the door then ACCEPTS it (`N = 0` with `prior: none` is legal;
`N > 0` with `prior: none` is refused — so a false zero is the one state that passes without reading anything).
Near-miss here: a decision was published with a false «→ 0 hits» in three documents; the conclusion happened to
survive the corrected search, the evidence did not. Also **universality**: the defect selects by alphabet — an English
deployment never sees it; OBSERVED here for Cyrillic only. By the mechanism (byte-wise case folding outside a UTF-8
locale) other non-ASCII scripts are expected to behave the same — not tested.

## What in KAIF led to this

`.kaif/tools/contour/core.mjs:351` — `return words.length ? 'grep -rniE "' + words.join('|') + '" ' + ARCHAEOLOGY_PATHS : null;`
The door (Node, Unicode-correct) delegates the search to whatever `grep` the agent's shell resolves, and the skill
orders «run it as printed». The command is correct on Linux/macOS with a UTF-8 locale and silently weaker in Git
Bash on Windows; five field REPORTS of four deployments in the origin's tracker name Windows 11 as their host (issue
titles #11, #12, #17, #24, #45 — #12 and #45 are the same deployment; which shell each of them uses is not known to
me). The stems are already lower-cased by
the door, so `-i` is the ONLY thing standing between the search and every capitalized occurrence.

Smallest fixes, either one closes it: **(a)** print `LC_ALL=C.UTF-8 grep -rniE …` (one token; verified above to
restore the 61 lines); **(b)** better, by the canon's own «code before cognition»: let the door RUN the search in
Node (`toLowerCase()` is Unicode-aware everywhere) and print the hit list with file:line — `review.mjs <doc>
--archaeology` — so the attested N comes from the same machine that judges it, and no shell is in the path at all.
A one-line note in step 3d for hand-written searches: «non-ASCII pattern → no bracket expressions, and prove the
pattern on a line known to contain it before writing N = 0».

## Local remediation (per the "defect in KAIF itself" contour, if applied)

Lesson recorded as `EXPERIENCE.md` EXP-0285 (class `shell-lied`): «a search that returns zero proves nothing until the
same pattern has been seen to HIT a known line; for non-ASCII use the harness Grep tool (ripgrep) or
`LC_ALL=C.UTF-8`». The shipped tool was NOT patched locally (it is replace-eligible machinery; a local edit would
be overwritten or freeze the file at the next update). Not mutation-proved — there is no local guard, only the habit
and this ticket.
