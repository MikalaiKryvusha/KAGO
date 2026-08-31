# Research 31 — how the industry handles a RESCUE that mutates state under a live operation

> **Created:** 2026-08-31 (session 72) · **Parent:** `bugs/88` (the rescue zeroed the curve under a
> live rung; repro measured the same day) · `plans/81` Ш4 · **Status:** written before the fork is
> put to the owner, as `GOAL.md` → «🎓 НА РАЗВИЛКЕ — НЕ РЕШАТЬ САМОМУ» requires ·
> **Outbound:** the fork goes to the owner through the review contour, carrying this document's
> conclusions QUOTED INSIDE the question (the self-sufficiency rule)

## 0. The decision this recon serves

`bugs/88`, measured on the twin on 2026-08-31: the fuse trips, hand 2 zeroes the V/F curve while a
rung is alive, and the rung — knowing nothing — goes on to burn on the FACTORY curve and closes
`PASS`, writing an undervolt that never happened.

The ticket named three candidate fixes and refused to choose:

1. **The rung learns about the rescue** — it reads hand 2's receipt before the burn.
2. **The rescue does not touch what a live rung owns** — the hand waits for the rung to release.
3. **The trip terminates the rung explicitly** — the trip kills not only the burn but the rung.

The owner's standing rule forbids the agent deciding this alone (fuse ⇒ safety of his machine,
`interviews/022` Q3 = A). This document answers the question the rule actually asks: **not «which do
I like», but «how do the people who solved this before us solve it, and WHY is their answer the
best one»**.

## 1. The problem, stated in the industry's own vocabulary

Strip the GPU away and the shape is a classic one:

> A worker holds a resource and performs a multi-step operation. A supervisor decides the worker is
> unhealthy and forcibly restores the resource to a safe state. The worker was never told. It
> completes its operation on state it did not write and reports a result it believes.

Three well-worn fields answer exactly this: **distributed locking** (a preempted lease holder must
not be able to write), **kernel synchronisation** (a reader must not trust data a writer changed
underneath it), and **machinery safety** (an emergency stop must not silently allow the cycle to
finish).

## 2. What each field answers, and what it costs to ignore

### 2.1 Distributed locking — FENCING TOKENS. *Never trust a process to know its own lock is gone*

Kleppmann's analysis (2016) is the canonical statement, and the Redis project's own locking guidance
now carries it. Client 1 holds a lease with token 33, pauses, the lease expires; client 2 acquires
it with token 34 and writes; client 1 wakes and writes with token 33 — and **the resource rejects
it**, because it has already seen a higher token.

**The sentence that decides our fork, verbatim in substance:** *fencing pushes safety enforcement to
the RESOURCE being protected, rather than relying on the lock holder to know its lease has expired —
never trust a process to know that its own lock has expired.*

🔴 **Candidate 1 («the rung reads the receipt») is precisely the shape this literature warns
against**: it makes the VICTIM responsible for noticing that it was preempted. It works only while
the victim is healthy enough to look — and the fuse trips exactly when health is in doubt. It is not
wrong, but it cannot be the *only* mechanism, and it must not be the one the safety property rests
on.

### 2.2 Kernel synchronisation — SEQLOCK. *Validate across the critical section; discard on change*

The Linux `seqlock`: the writer increments a counter **before and after** writing; the reader reads
the counter before and after its critical section and, if it changed (or was odd — a write in
flight), **the read is invalid and is discarded**, never used.

Two properties matter for us:

- **The check is CHEAP and it is at the point of USE**, not at the point of damage. The reader does
  not have to detect the writer; it only has to notice that *something* changed while it worked.
- **The failure mode is DISCARD, not repair.** An invalidated read produces no value at all. It is
  never partially trusted.

🎯 **This is the closest analogue to our defect there is.** Our rung's «critical section» runs from
«the curve is written» to «the verdict is recorded»; the rescue is the writer that bumps the
counter. Today the rung has no counter to read, so it commits a measurement whose premise was
destroyed mid-flight — which is exactly the invalid read a seqlock exists to throw away.

### 2.3 Machinery safety — ISO 13850. *Latch, and reset ≠ restart*

ISO 13850:2015 (with IEC 60947-5-5) requires the emergency stop to **latch**: the contact opens and
stays open — «no latching without opening the contact and no opening without latching». The
machinery **must not be able to operate again until the function is reset**, and the standard is
explicit about a second boundary: **resetting the e-stop does NOT mean the machine may start; reset
only makes a restart POSSIBLE, through a separate, deliberate start command.**

Two lessons land on us directly:

- **The stop latches at the SUPERVISOR, not at the worker's goodwill.** After a trip there is a
  state in the world that says «stopped», and it persists.
- **«The rescue succeeded» and «work may continue» are TWO decisions, not one.** `plans/81` already
  has the first half right (re-arm only on a receipt verified by read-back); the standard says the
  second half must stay separate — a confirmed stock is permission to *consider* continuing, never
  the continuation itself.

## 3. Reflection — WHY these are the best practices, and HOW they serve THIS project

*(the two halves the owner's rule demands)*

**Why they are best.** All three were paid for by the same failure and converge on one principle:
**the party that is possibly broken must not be the party responsible for noticing that it is
broken.** Kleppmann's client is paused; the seqlock's reader may be arbitrarily slow; the machine
operator may be unconscious on the floor. In every case the design refuses to build safety on the
victim's alertness — it puts the check either at the resource (fencing), at the moment of use
(seqlock validation), or in a latched physical state (e-stop). That is not a stylistic preference;
it is the property that makes the safety argument survive the case it exists for.

**How they serve KAGO specifically.** This project's core product is **a document of measurements
the owner will run his card on**. The worst outcome available to us is therefore NOT a wasted burn —
it is a FALSE PROVEN GROUND: a row that says «790 mV serves 2145 MHz and held» when the burn ran at
stock. `bugs/88`'s repro produced exactly that row. So the seqlock lesson — *an invalidated
measurement is DISCARDED, never partially trusted* — maps onto the project's own standing barrier,
«only confirmed values reach the document» (`ЗАКАЗ.md` §3, one of the five the owner left). And the
e-stop lesson maps onto the owner's other standing rule, «🏗 ЗДАНИЕ ВАЖНЕЕ ЛЕСОВ»: latching the stop
does not have to mean losing the band — it means *this rung's result is void* and continuation is a
separate, explicit decision, which is precisely the shape `plans/81` is building.

**What the recon CHANGES about the three candidates** (this is the value of having done it):

| candidate | verdict after recon |
|---|---|
| 1. rung reads the receipt | **Necessary but NOT sufficient, and it must not be the load-bearing part.** It is the shape fencing literature warns about: safety resting on the victim's alertness |
| 2. the hand waits for the rung to release | **Refuted by the field's own reasoning.** An emergency stop that waits for the healthy path to yield is not an emergency stop; the ticket already called this «dangerous by construction», and ISO 13850's latching requirement says the same thing from the other side |
| 3. trip terminates the rung | **Right in DIRECTION, incomplete in FORM.** Killing the rung is the e-stop's «latch»; but the seqlock adds what killing alone does not give — the rule for the result that already exists: it must be VOIDED, not merely abandoned |

**The shape the three sources jointly point at**, and which none of the three candidates states on
its own: **a rescue EPOCH that the rung validates before it is allowed to record anything.** The
fuse bumps a counter when it trips; the rung reads it at its start and again before writing its
verdict; a change means the measurement is `void` — never `PASS`, never `unknown`-by-accident — and
the decision to continue the band is a separate one, made by the existing accumulator.

⚠️ **This is a RECOMMENDATION, not a decision.** It touches the fuse, i.e. the safety of the owner's
machine, so the choice is his (`interviews/022` Q3 = A). What this document buys him is that the
choice is now made with the field's knowledge rather than with my taste.

## 4. What this recon did NOT establish — named, not glossed

- **Whether the epoch can be read by the rung cheaply on the LIVE path.** The fuse journal is
  `fsync`ed and read-back costs a file read per rung; measured cost is unknown. The twin says
  nothing about it (its hand runs in-process).
- **Whether the pin releases when the curve is zeroed on REAL silicon.** Measured on the twin: it
  does not — but `virtual-gpu.targetMhz()` holds a pin unconditionally, so the twin cannot express
  the failure at all (`bugs/88`, `bugs/26` class). Open, and only a live measurement closes it.
- **No source was found that treats this exact composition** (an out-of-process rescue mutating a
  GPU V/F table under a measurement). The three fields above are analogues, argued as analogues.

## Sources

- [How to do distributed locking — Martin Kleppmann](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- [Locks, leases, fencing tokens — Surfing Complexity](https://surfingcomplexity.blog/2025/03/03/locks-leases-fencing-tokens-fizzbee/)
- [Sequence counters and sequential locks — The Linux Kernel documentation](https://docs.kernel.org/locking/seqlock.html)
- [linux/Documentation/locking/seqlock.rst](https://github.com/torvalds/linux/blob/master/Documentation/locking/seqlock.rst)
- [ISO 13850: Safety of Machinery — Emergency Stop Function (The ANSI Blog)](https://blog.ansi.org/ansi/iso-13850-safety-of-machinery-emergency-stop/)
- [The manual reset function — what it is and how it works (Machinery Safety 101)](https://machinerysafety101.com/2021/05/19/understanding-safety-functions-manual-reset/)
- [Standards guide the use of e-stops — Control Design](https://www.controldesign.com/safety/safety-components/article/21526010/standards-guide-the-use-of-e-stops)
