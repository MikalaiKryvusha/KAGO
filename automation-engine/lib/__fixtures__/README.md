# Event-log fixtures — what each one proves, and what it does NOT

These feed `event-logger.mjs --fixtures` (plan step 3.5, acceptance criterion **P1-AC3**). They exist
because three of the four fault detectors cannot be proved on this machine: it has no TDR, no WHEA
and no bugcheck history at all. A detector that has never gone red proves nothing
(`BUG_FIXING_FRAMEWORK.md` → Guards), so the fixtures are how those three go red at least once.

**The filename carries the provenance, so nobody has to open this file to know what they are looking
at:** `__captured` = pulled off this machine's own event log with `Get-WinEvent … | ForEach-Object
{ $_.ToXml() }`; `__constructed` = written by hand against the Windows event schema.

| Fixture | Provenance | What it proves |
|---|---|---|
| `kernel_power_41__captured.xml` | **CAPTURED** — the real 06.08.2026 20:35 event | The one detector with real local history. Manifested-provider shape: `<EventID>41</EventID>` |
| `display_4107_not_a_fault__captured.xml` | **CAPTURED** — a real 01.08.2026 event | The NEGATIVE case, and it is real data: a provider we watch, at an id we do not. Classic-provider shape: `<EventID Qualifiers='0'>4107</EventID>` — the form that a regex written for the first shape silently misses |
| `display_4101_tdr__constructed.xml` | **CONSTRUCTED** from the captured 4107 above | The TDR id is recognised and classified CRASH |
| `whea_logger_17__constructed.xml` | **CONSTRUCTED** | A machine-check event is recognised and classified CRASH |
| `wer_1001_bugcheck__constructed.xml` | **CONSTRUCTED** | A bugcheck report is recognised and classified CRASH |

## The boundary, stated plainly

A constructed fixture proves that **the parser handles the shape it was given**. It does **not**
prove that shape is what this machine would really emit — nobody here has seen a WHEA event, and a
fixture cannot manufacture that evidence. The two claims are kept apart on purpose:
`config.FAULT_PROVIDERS` marks each detector `provable: 'history' | 'fixture'`, the code's `[TESTED]`
markers repeat the distinction, and the CLI prints it next to every provider it queries.

**When a real event of one of these kinds ever appears on this machine — capture it and replace the
constructed fixture.** That is a strict upgrade of the evidence, and the filename tells you which
ones are still waiting for it.

## Adding a fixture

1. Capture: `Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='X';ID=N} -MaxEvents 1 |
   ForEach-Object { $_.ToXml() } | Out-File -FilePath out.xml -Encoding utf8` (strip the BOM).
2. Name it `<provider>_<id>[_note]__captured.xml` or `__constructed.xml`.
3. Add a row to `expectations.json` — provider, id, level, `timeCreated`, `fault`, and `means` when
   it is a fault. **A fixture with no expectation, or an expectation with no fixture, fails the
   suite**: the first is a file nobody checks, the second is a check that silently never runs.

---

## Пульс сэмплера — два ЗАХВАЧЕННЫХ файла рокового прогона (2026-08-23)

`pulse_2797mhz_death__captured.jsonl` · `journal_2797mhz_death__captured.jsonl`

Это не образцы формата и не иллюстрация — это **единственная запись явления, ради которого
существует `ideas/10`**. Живой прогон 2797 МГц при владельце, две перезагрузки за час: сэмплер
телеметрии потерял такт ДВАЖДЫ на последней прошедшей ступени (845 мВ) и НИ РАЗУ на трёх безопасных
до неё, а оракул на всех четырёх сказал PASS.

**Почему они лежат ЗДЕСЬ, а не в `runs/`:** `runs/` под `.gitignore`, а прогоны затирают телеметрию
друг друга. До 2026-08-23 архива не существовало вовсе (`ideas/10` §5.6) — этот файл уцелел только
потому, что после смерти машины никто не запускал развёртку снова. Оставить его в игнорируемом
каталоге значило бы хранить главную улику проекта в одном экземпляре на диске.

**Что на них держится:** блоки 8 · 8а · 8б · 17 · 17а · 17б набора `pulse`. Они сверяют код с
числами, которые `ideas/10` §2 посчитал руками — 4436 мс сверх обещания в двух интервалах, — и
поэтому эти числа не могут тихо измениться под рефакторингом.

⚠️ **У файла пульса ОБОРВАН ХВОСТ: 768 нулевых байт**, и это не порча при копировании, а сама улика
— `bugs/37`. Машина умерла, не сбросив кэш страниц, и ступень 840 мВ, которая её убила, не имеет ни
одной пробы. Не «чините» этот файл.
