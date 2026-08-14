# Bug 08 — a selftest's teardown deleted the production evidence store, and a mistyped argument is why

**Status:** ✅ **DONE 2026-08-14 21:42 — class closed by two guards, both mutation-proved.** The DATA
is not recoverable and that is stated rather than softened.
**Version/build:** driver 610.88 · VBIOS 98.03.58.40.8b · introduced and closed in commit `dfd10d6`
**When/context:** 2026-08-14 21:3x, while adding blocks for the session depth bound of `bugs/07` —
minutes after the hang, in the fix for the hang

## Symptom

The engine's own isolation block went red with an impossible-looking value:

```
ПЛОХО ПРОДАКШЕН НЕ ВЫРОС: самопроверка движка не подбросила улик  -> получено 0, ждали 18
```

Production had not grown — it had gone to **zero**. `runs/vmin/` did not exist. Gone with it:
**all 74 ratchet records** (2026-08-10, 08-11 and the whole of 08-14, including the two live band
sweeps in the shipped shape) and every sampler telemetry file.

## Root cause

```js
export function openStore({ dir = VMIN_DIR } = {}) { … }        // takes an OPTIONS OBJECT
…
const storeDeep = openStore(mkdtempSync(join(tmpdir(), 'kago-vmin-deep-')));   // passed a STRING
```

Destructuring a **string** finds no `dir`, so the default applied and the "sandbox" store pointed at
**the production directory**. The block's own `finally` then ran `rmSync(storeDeep.dir, { recursive:
true, force: true })` and deleted it.

**What makes this a class and not a slip: the wrong type produced a VALID object pointing at exactly
the place the parameter exists to avoid.** No error, no warning, no type check — a silently correct
shape with catastrophically wrong content. And the caller was a TEST, i.e. the one kind of code whose
job includes deleting directories.

## Why nothing recovered it

- `runs/` is git-ignored by design (it is local state, and the goldens live there) — no git copy;
- `vssadmin list shadows /for=D:` → **no items**;
- File History service (`fhsvc`) → **Stopped**;
- `rmSync` does not use the Recycle Bin.

**The data is gone permanently.** The numbers of that evening survive only because they had been
printed into the chat, and they are recorded — labelled as reconstruction, not as measurement — in
`bugs/07`.

## The fix — two guards, because the two halves fail independently

1. **`openStore` refuses a bare string**, with a message naming this incident and the correct call.
   That stops the KNOWN way in.
2. **`assertSandbox(store)` refuses to hand back the production directory**, and every sandboxed
   teardown now calls it instead of reading `.dir` directly. That stops the CATEGORY: any future path
   that puts production in front of a teardown, for any reason, meets a refusal rather than a
   deletion.

Both are proved by blocks (`vmin-store --selftest`, 38 blocks) and the suite is mutation-proved.

## What this cost, stated plainly

The ratchet is **empty**. The card therefore has "no history" again, and under the new session bound
(`bugs/07`) a run may go only 30 mV below stock. The road back to the measured −185 mV has to be
walked again, one bounded session at a time. **Safety was not reduced by the loss — knowledge was**,
and the owner's evening with it.

## Decisions made without the owner

- **The store was NOT reconstructed from the chat.** Reconstructed rows are indistinguishable from
  measured ones once written, and a later session would treat them as evidence (EXP-0025 — a test
  that writes into real state fabricates forensics). The numbers went into a document instead.
- **Reported immediately and in full**, before the fix was written. A loss the owner discovers later
  costs more than the loss itself.
- **`runs/` stays git-ignored.** Committing the evidence store would put local machine state and
  goldens into a public repository to guard against a defect that is now guarded directly. If a
  backup is wanted, it belongs in a local copy step, not in git — that is an owner-level call and it
  is NOT made here.

## Links

- `automation-engine/lib/vmin-store.mjs` → `openStore`, `assertSandbox`
- `bugs/07` (the incident this was found inside) · EXP-0025 (tests must not touch real state)
