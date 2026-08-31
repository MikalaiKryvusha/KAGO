# KAIF improvement request: the review contour's voice is prescribed as a TIMBRE parameter and never bound to being INTELLIGIBLE in the owner's language

kaif-fp: `.claude/skills/owner-reviews/SKILL.md#I28,I35,I36,C8,DEF7` :: voice-prescribed-as-timbre-not-as-intelligibility :: v2.2

**Delivered upstream:** ✅ **origin #38 — filed 2026-08-31.** https://github.com/MikalaiKryvusha/KAIF/issues/38

> 🔴 **ЭТА СТРОКА ШЕСТНАДЦАТЬ ДНЕЙ НАЗЫВАЛА ПРИЧИНУ, КОТОРУЮ НЕ ПРОВЕРЯЛА.** Здесь стояло
> *«⏳ not yet filed — awaiting the owner's word»*. Ждать было НЕЛЬЗЯ: постоянный приказ владельца
> от 2026-08-30, дословно — *«НИКАКИХ ОДОБРЕНИЙ! АГЕНТ ВИДИТ БАГ В КАИФ — НЕМЕДЛЕННО ИДЁТ ЗАВОДИТЬ
> И ОТПРАВЛЯТЬ ЕГО В ОРИГИН!»* — и он же записан в `AGENT_GUIDE.md` как единственное исключение из
> ворот авторизации. **А настоящая причина простоя была другой и механической:** тикет не нёс блока
> метаданных отправки, и `send-upstream.mjs` отказывал ещё до всяких слов
> («в голове документа нет блока метаданных»). Проверено сухим прогоном 31.08 — то есть строка
> объясняла задержку словом владельца, пока её держал отсутствующий yaml.
> Тот же класс, что [[EXP-0206]]: объяснение, назначенное текстом, а не вычисленное.
> Отправлено напрямую через `gh` — тем же путём, каким ушёл `bugs/KAIF/16` (origin #37).

**Autocapture** (from `.kaif/kaif.json`): KAIF 2.2 · project KAGO · sphere `programming` · language `ru` ·
tracking `origin` · agent system claude-code · OS Windows 11 Pro 10.0.26200 · Node v24.15.0 ·
3 SAPI voices installed (measured, below)

**Dedup attestation:** searched `bugs/KAIF/` (`ls` → `01_placeholder_gate_scans_sphere_library.md`,
`02_adaptation_task_has_no_owner_voice_step.md` — that one is the WRITTEN voice portrait
`AUTHOR_STYLOMETRY.md`, a different surface entirely, `03_language_routed_by_directory_not_audience.md`,
`04_diff_preview_counts_adapted_module_and_names_no_module.md`) and origin issues
(`gh issue list --repo MikalaiKryvusha/KAIF --state all --limit 30` → 18 issues; #2 and #7 are the
contour's field reports, neither raises voice selection; `--search "voice tts speech synthesizer"` →
**no results**). No match found.

**Reported by the owner**, chat 2026-08-15, verbatim: *«голос неверный в интерактивном контуре. Заведи
баг в KAIF, он неверно тебе предписывает настроить голос интерактивного контура»*.

## Gap

The skill spends six invariants and a defaults table on the call, and every one of them treats the
voice as **timbre** — a matter of preference, availability and fallback:

> **I28.** The voice call by name is the DEFAULT level, not an option for the brave: a voice built
> but switched off by a setting exists only on paper.

> **I35.** The voice falls back honestly to the system one. No engine on this machine (other box,
> removed venv) — the approval contour has no right to break over timbre; make route choice a pure
> function so both branches sit under guards regardless of the machine running the checks.

> **I36.** Text normalization for speech lives in the ENGINE, not in the project. … Heavy shared
> resources (the TTS model, its venv) belong to the MACHINE, not the project: the project calls a
> ready command and falls back honestly when it is absent.

> **C8.** … sound first and always (I33/I34) · **the voice is a parameter**, the phrase = document
> type + its name + the COUNT of unanswered questions …

**Not one line binds the voice to the LANGUAGE of the phrase it must speak.** The skill is emphatic
that the page speaks the owner's language ("**The page speaks the owner's language.** The interface
chrome — state tags, buttons, notices, the header summary — follows the language the owner works in,
not the tool author's") — and then hands the same owner's sentence to whatever voice the host
happens to have selected.

Three consequences, all reproducible:

**1. The correct outcome is an accident of the host's settings, and no guard can tell.** Following
I35 literally ("falls back honestly to the system one") produces code that never SELECTS a voice.
On this machine the call is intelligible only because the OS default happens to be `ru-RU`:

| voice installed | culture | |
|---|---|---|
| **Microsoft Irina Desktop** | **ru-RU** | ← the OS default here, so the Russian phrase is read by a Russian voice |
| Microsoft Zira Desktop | en-US | |
| Microsoft David Desktop | en-US | |

On a deployment whose default is David or Zira — the factory default of an English-locale
Windows — the identical code reads a Russian sentence with an English voice, which is not "worse
timbre", it is **noise**. Every guard the skill specifies stays green: the route function returns
`voice: true`, the child exits 0, the phrase file is UTF-8, the command line is ASCII. The contour
reports a delivered call and the owner heard gibberish.

**2. I36 pushes normalization onto an engine the blessed fallback does not have.** "Text
normalization for speech lives in the ENGINE, not in the project" is true of a modern TTS engine and
false of the SAPI fallback I35 blesses: SAPI has no cross-script normalization, so every Latin token
inside an owner-language phrase is read as letters or swallowed. Because the skill declares
normalization out of scope for the project, a compliant implementation ships with no
transliteration — and the phrase is built from a DOCUMENT TITLE, which the agent writes and which
routinely carries product names, mode names and identifiers. In this deployment the symptom was
visible enough that the implementer hardcoded exactly two words:

```js
const say = (s) => plainText(s).replace(/\bKAGO\b/gu, 'КАГО').replace(/\bKAIF\b/gu, 'КАЙФ');
```

Which is a two-entry dictionary against an open set: the interview raised the same morning is titled
*«…возвращаем ли потолок частоты в `Optimised`?»*, and `Optimised` goes to a Russian voice raw.

**3. Delivery is verified, intelligibility is not.** I34 and C8 are careful that the exit code does
not prove the human HEARD, and require confirmation with the human. Nothing anywhere asks whether
what they heard was UNDERSTANDABLE. The contour's own QA (C10, eleven blocks in a live browser)
covers the page, not the call's language.

## Reproduction

Deterministic, on any deployment with `"language"` set to a non-English value, on a host whose
speech default is English (i.e. the factory state of an English-locale Windows):

1. Deploy the contour per `/owner-reviews`, implementing I35 literally — take the system voice.
2. `npm run ask interviews/interview_NNN_<topic>.md` with a title in the owner's language.
3. The call plays. Every check the skill prescribes passes.
4. What comes out of the speakers is the owner's sentence pronounced by an English phoneme set.

Probe that exposes the latent half on ANY host, including one where it currently works by luck:

```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
"default: " + $s.Voice.Name + " | culture: " + $s.Voice.Culture
$s.GetInstalledVoices() | % { $_.VoiceInfo.Name + "  " + $_.VoiceInfo.Culture }
```

If the default's culture ≠ the project's `language`, the contour is already broken on that host and
nothing in KAIF says so.

## Proposed change

Three lines, all in `/owner-reviews`:

1. **Add an invariant next to I35 — the voice is chosen by LANGUAGE first, timbre second.** The
   implementation SELECTS a voice whose culture matches `.kaif/kaif.json` → `language`; the system
   default is used only when it already matches, and when no matching voice exists the contour says
   so out loud and drops to beeps + banner rather than speaking an unintelligible sentence. The
   honest fallback of I35 is preserved — it just stops being silent about the one failure that
   matters.
2. **Correct I36's boundary.** "Normalization lives in the engine" holds for the rich engine; the
   FALLBACK path has no normalization, so the skill must say that a project on the fallback owns the
   minimal script normalization of its own phrase (transliteration of foreign-script tokens), and
   that the source of those tokens is the document title — i.e. the rule belongs to the phrase
   builder, not to a per-word dictionary.
3. **Make intelligibility a checked property, not an assumed one.** The route function already
   exists as a pure function under guards (I35); it should return the CHOSEN VOICE and its culture,
   and the guard should assert culture-matches-language. That is a guard that can go red, which is
   what G-norms require of every guard the skill ships.

The cheap version of all three, if only one line can be added: **the voice's culture must match the
project's working language, and a call that cannot satisfy that is not made.**

## Why this is a CLASS, not a one-off

The defect is in the prescription, so it reproduces in every deployment that follows it: any project
whose `language` is not the host's speech default gets an unintelligible call while every specified
guard stays green. It is also the same shape KAIF already knows in another surface —
`bugs/KAIF/03`, where document language was routed by a list instead of by the audience: here the
VOICE is routed by the host's setting instead of by the listener. One canon, two places where the
listener/reader is the thing that was not asked.

## Local remediation

Local fix lands in `tools/review.mjs` (KAGO's contour implementation), and the divergence is noted
here so the next `/kaif-update` sees the merge coming:

- `speak()` selects the voice by culture prefix taken from `.kaif/kaif.json` → `language`, falls back
  to the system voice **only if its culture already matches**, and otherwise prints the refusal and
  leaves the beeps to do the work;
- the chosen voice and its culture are PRINTED next to the `ЗОВ:` line, so the owner can see which
  voice spoke without asking;
- the phrase builder's two-word dictionary is replaced by a rule over the whole phrase.

## Links

- `bugs/KAIF/03` — the sibling defect (routing by list instead of by audience).
- Origin issues #2 and #7 — the contour's two field reports; this gap is in neither.
- `.claude/skills/owner-reviews/SKILL.md` I28 · I33–I36 · C8 · C10 · DEF1 · DEF7.
