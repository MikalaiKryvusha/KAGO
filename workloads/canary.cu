// canary.cu — the smallest possible question to the card: «ARE YOU STILL COMPUTING?»
//
// THE OWNER'S ORDER, verbatim (2026-09-09, right after the fuse failed to save the machine):
//   «177 секунд комп уже висел, я просто не перезагружал его в надежде, что КАГО спасёт. Не спас»
//   «Не рассчитывай на секунды, рассчитывай на миллисекунды на спасение»
//
// WHY THIS FILE EXISTS AT ALL — the four blindnesses of 2026-09-09 (`bugs/132`), and every one of
// them was BY CONSTRUCTION rather than by accident:
//   · input 1 (channel silence)   — the driver ANSWERED the poll: the channel was alive, the CARD
//                                   had stopped. Beat gaps 0,01…2,4 ms right up to the last tick;
//   · input 2 (burn progress)     — `progressSilenceMs: null` for all 20 546 ring ticks: there was
//                                   no burn at all, the machine died BETWEEN rungs;
//   · input 3 (power collapse)    — disarmed that morning, its threshold has no provenance
//                                   (`bugs/131`);
//   · input 4 (telemetry frozen)  — born from that death, and it is bounded by the SOURCE: NVML
//                                   refreshes the number about twice a second, so ~1,5 s to detect.
//
// The common root, and it is the whole design brief: NOT ONE OF THEM ASKS THE CARD ITSELF WHETHER
// IT IS COMPUTING. Three ask our own processes; the fourth asks the driver about its readings.
// Nobody hands the card a TASK and waits for the answer. This file hands it one, every few
// milliseconds, and the answer is the signal.
//
// THE SHAPE, and the three decisions it rests on (`plans/95` §3):
//   1. A SEPARATE PROCESS, never a thread inside the burn. A hung card drags its context down with
//      it; a canary living inside the burn dies with the burn and says nothing. Same argument that
//      keeps the judge out of the sweep process (`bugs/27`).
//   2. A HIGH-PRIORITY STREAM. Otherwise the canary's kernel queues behind our own furnace and we
//      measure QUEUE LENGTH while calling it card health — exactly the `bugs/124` class, «the
//      instrument measures something other than what it names».
//   3. THE JUDGE WATCHES ONLY THE TIMESTAMP of the last beat. If the canary blocks inside the
//      driver, that IS the signal; the observer must live in another process or it hangs alongside.
//
// THE POLL IS NON-BLOCKING ON PURPOSE. `cudaEventSynchronize` would park this thread inside the
// driver on the first stall and the canary would go quiet without ever knowing why. `cudaEventQuery`
// returns `cudaErrorNotReady` and lets us keep our own clock — so a stall is something we can SEE
// and time, not merely something we disappear into.
//
// ⚠️ WHAT THIS FILE DOES NOT KNOW, stated here so no reader takes it for settled: how the query
// behaves on a REALLY hung card. The documentation says it does not block; a hang can be of a kind
// that blocks every call into the driver. For the judge the signal exists either way (the beats
// stopped), but the DIFFERENCE decides the detection time, and it is measured in phase 3 of the
// epic — never taken from the documentation (`plans/95` §3).
//
// TWO MODES, ONE BINARY, and the reason is the build pipeline rather than convenience:
//   · NO `--port`  — the SELF-PROOF run. `tools/build-workloads.mjs` picks up every `.cu` in this
//                    directory and demands of each one a `KAGO-WORKLOAD … checksum=` line, ONE
//                    distinct checksum across 5 runs, and the same checksum again under
//                    `--sustain 2` with `distinct=1`. The canary satisfies that contract as its
//                    siblings do, so the pipeline needs no second class of artifact and the
//                    manifest covers this source like any other (P96-AC1). The determinism proof is
//                    not a formality here: a canary whose kernel disagrees with itself would be a
//                    broken instrument, and we would learn it on the owner's machine.
//   · WITH `--port` — the BEAT run. Tick loop, high-priority stream, non-blocking poll, one `0x03`
//                    datagram per completed launch to 127.0.0.1:<port>, latency histogram at exit.
//
// THE PROTOCOL IS THE JUDGE'S, NOT A NEW ONE: the same loopback port and the same one-byte
// datagram the probe already uses — `0x01` = driver-liveness beat, `0x02` = burn progress, and this
// file adds `0x03` = the card completed the canary's kernel. Borrowed, not invented (`plans/96`,
// risk row «сокет в .cu — новая для проекта машинерия»).
//
// 🔴 EVERY INITIALISATION FAILURE IS LOUD — a named line and a non-zero exit code, never a silent
// zero. A silent canary is indistinguishable from a stopped card, and that indistinguishability is
// precisely the disease this whole epic treats. Exit codes:
//     0 ran · 2 CUDA error · 3 socket error · 4 bad arguments · 5 the kernel never completed
//     within the poll bound (an OBSERVATION, and no setpoint is ever derived from it here).
//
// TIMING IS MEASURED, NEVER ASKED. `timeBeginPeriod(1)` is requested, and then we report the GAPS
// WE OBSERVED — because Windows 11 applies EcoQoS to a hidden detached process and silently ignores
// the resolution request, while `NtQueryTimerResolution` cheerfully reports 0,5 ms on the broken
// instrument. That cost this project a whole misdiagnosis (`bugs/128`): the witness must be a
// quantity the throttling cannot forge, and the observed gap is that quantity.
//
// Usage:
//   canary.exe [--sustain <s>]                            self-proof (the build pipeline's shape)
//   canary.exe --port <P> [--tick <ms>] [--seconds <s>]    beat mode
//              [--parent-pid <pid>] [--poll-timeout-ms <ms>]
//   `--seconds` and `--sustain` are TWO SPELLINGS OF ONE NUMBER (the run's duration in seconds).
//   The pipeline spells it `--sustain`, the probe spells it `--seconds`; one variable answers to
//   both rather than two concepts drifting apart.
//
// Output (stdout, machine-readable, integer microseconds only — a ru-RU locale would corrupt a
// float silently, the same reason the siblings state):
//   KAGO-WORKLOAD name=canary checksum=<16 hex> launches=<n> distinct=<n> ms=<n>   [self-proof only]
//   KAGO-CANARY tick_us=<n> launches=<n> beats=<n> expected=<n> stream_priority=<p>
//               priority_range=<lo>..<hi> lat_med_us=<n> lat_p90_us=<n> lat_p99_us=<n>
//               lat_max_us=<n> gap_med_us=<n> gap_p90_us=<n> gap_p99_us=<n> gap_max_us=<n>
//
// [NOT-TESTED] at birth. The markers in the MEASURED NUMBERS block below stay «— не измерено —»
// until step 3 of `plans/96` runs them; an invented number is worse than a missing one
// (`PHILOSOPHY.md` → the three doors).

#include <cuda_runtime.h>

// winsock2.h MUST precede windows.h, or windows.h drags in the winsock 1.1 header and the two
// collide. Stated rather than trusted to include order elsewhere in the file.
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <timeapi.h>

#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cstdlib>

// The linker learns its libraries from the source, NOT from the build command: `buildCuda`
// (`automation-engine/lib/toolchain.mjs`) invokes nvcc with a fixed `-O2` and no per-file flags, so
// asking for extra libs on the command line would mean editing shared machinery for one workload.
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "winmm.lib")

// ---------------------------------------------------------------------------------------------
// MEASURED NUMBERS — step 3 of `plans/96`, on an IDLE card, 2026-09-09. Nothing here is chosen.
//
// THESE ARE THE FLOOR OF THE FLOOR, and the wording is not modesty: an idle card is the EASIEST
// case there is. Phase 2 measures the same quantities while the furnace holds the card at ~305 W,
// and the setpoint of input 5 is derived from THOSE. Deriving one from the numbers below would be
// `bugs/131` repeated — an input armed on a threshold with no provenance.
//
//   idle card · tick 5 ms · 10 s · three runs, each with an INDEPENDENT loopback receiver counting
//   the datagrams (the canary's own beat count cannot prove its beats arrived):
//
//     beats delivered    2001 of 2001 · 2001 of 2001 · 2001 of 2001 — 100 %, receiver agrees exactly
//     kernel latency µs  median  42 ·  51 ·  43     p90 121 · 129 · 124
//                        p99    273 · 272 · 270     max 1703 · 679 · 629
//     beat gap µs        median 5000 · 5000 · 4999  p90 5063 · 5065 · 5066
//                        p99   5180 · 5156 · 5161   max 6550 · 5582 · 5541
//     stream priority    range ASKED OF THE CARD: 0..-5 (six levels); this card honours -5
//     mechanism          hr_timer=1 · thread_time_critical=1 · timer_period_1ms=1
//
//   ⚠️ THE SAME THREE RUNS BEFORE THE CADENCE WAS FIXED, kept because the difference IS the lesson:
//   delivery was already 100 % (2001 of 2001) while the gap p90 sat at 15 238 µs — i.e. a canary can
//   deliver every single beat and still be three times its own tick late. Delivery and CADENCE are
//   two facts, and an instrument that reports only the first would have passed P96-AC2 while being
//   useless for milliseconds.
//
// ---- UNDER THE FURNACE — phase 2, `plans/97`, 2026-09-09. THIS is the floor the setpoint stands on.
//
//   Card held at the FULL envelope by `furnace.exe 2400 8192 256 64 --sustain 60`: 299,8…302,3 W,
//   79…80 °C. Two series, canary at tick 5 ms for 90 s, independent receiver counting:
//
//     beats delivered    18 001 of 18 001 · 18 001 of 18 001 — 100 %; receiver max 11 281 / 9 919 µs
//                        against the canary's own 11 289 / 9 872 — two clocks, ten microseconds apart
//     kernel latency µs  median 150 · 152     p90 300 · 356
//                        p99   2307 · 2793    max 6470 · 5568
//     beat gap µs        median 4999 · 5000   p90 5101 · 5141
//                        p99   7009 · 7138    max 11 289 · 9 872
//
//   🎯 THE PRIORITY HOLDS, and that is the phase's answer: with the card busy at 300 W the MEDIAN gap
//   did not move at all — 5000 µs against 5000 µs idle. Had `cudaStreamCreateWithPriority` been
//   ignored, the canary would have queued behind the furnace's own launches (≈ 280 ms each) and the
//   median would have gone there. The tail grew honestly instead: p99 5,17 → 7,07 ms, max 6,55 →
//   11,29 ms.
//
//   THE COST TO THE BURN IS NOT ZERO AND IS NOT HIDDEN: −2,93 % of the furnace's launches per second
//   (3,5711 → 3,4666), which is 6,3× the instrument's own scatter (0,462 % between two baseline
//   series), and −2,35 % of VRAM bytes read — two independent quantities naming one effect. The
//   CHECKSUM was identical across all four runs (`2fa22073660f99b5`, distinct=1, bad_launches=0), so
//   the oracle's verdict is untouched. ⚠️ But R4's THIRD observation — work per second, the
//   clock-stretching detector — moves by exactly those 2,93 %: a canary riding an edge search needs
//   its throughput golden captured WITH it, or the oracle sees a clock stretch that is not there.
//
//   CANDIDATE SETPOINT for input 5, by the SAME rule input 4 was derived with (from the CEILING of
//   health, never the middle of the gap — a false trip costs a rung, a missed one costs the machine):
//       ceiling of health under full load = 11,289 ms  (worst gap over 36 002 beats)
//       setpoint = 3 × ceiling = 33,9 ms               (the same ×3 as input 4: 3 × 515 = 1500)
//   Against input 4's ~1500 ms that is 44× on detection. ⚠️ CANDIDATE, not a decision: two series of
//   one evening, one load shape, and the worst gap is a SINGLE sample — the project has already paid
//   for a setpoint drawn from one observation (`bugs/126`, 455 ms). Arming is phase 4, and phase 3
//   must first say what a REALLY hung card does to the poll.
//
//   AND THE FINDING THAT OUTLIVES THE NUMBER: the bottleneck moved. Detection was 1500 ms against
//   282 ms of rescue hands, so the hands were rounding error; now it is 34 against 282, i.e. 89 % of
//   the rescue is spent by the HANDS. The owner's «milliseconds» is reached at the input and not yet
//   through the whole contour — and the next place to work is named by a number, not by a feeling.
// ---------------------------------------------------------------------------------------------

// One block, one thread — the kernel must PROVE the card accepts and retires work, not load it.
// Anything wider would start measuring occupancy, and a canary that competes with the burn for
// resources changes the very run it is watching (E95-AC6).
#define CANARY_BLOCKS  1
#define CANARY_THREADS 1

// Chain steps inside the one thread. Enough that the compiler cannot fold the kernel away and the
// launch has something to retire; small enough that the kernel itself is not the latency we измеряем.
#define CANARY_STEPS 64

// Launches spent bringing the CUDA context up before the clock starts. MEASURED, not chosen: the
// first run of this file put 97 142 µs of a 99 099 µs wall into launch #1 and 10 µs into the median
// of the other 63. One launch is enough to pay that cost; the second is there so a lazy module load
// behind the first cannot leak into the first MEASURED sample.
#define CANARY_WARMUP_LAUNCHES 2

// Histogram resolution: one bucket per microsecond up to 50 ms, plus an overflow bucket. Exact
// percentiles at 1 µs with no cap on the sample count and no allocation that grows with the run —
// a reservoir would have made the reported median depend on how long the run happened to be.
#define HIST_BUCKETS 50000u

// How many distinct checksums we bother to remember; we only need to know whether the count is 1.
#define MAX_DISTINCT 8

// The judge's one-byte protocol. 0x01 = driver liveness (the probe), 0x02 = burn progress
// (the progress relay), 0x03 = THE CARD RETIRED THE CANARY'S KERNEL. One namespace, three facts.
#define BEAT_CANARY 0x03

// ---------------------------------------------------------------------------------------------
// The kernel. Its output is a PURE FUNCTION OF A FIXED SEED — nothing about the launch, the clock,
// the grid geometry or the previous state leaks in. That is what makes every launch byte-identical
// and the self-proof checksum stable: the pipeline's determinism gate is then a statement about the
// CARD, which is the only thing worth asserting.
// ---------------------------------------------------------------------------------------------
__global__ void canary_tick(float *out) {
    float a = 1.0000001f;
    float b = 0.9999999f;
    // An FMA chain, the same amplifying shape sdc_fma's trust contract is paid for: a single flipped
    // mantissa bit early in the chain is visibly wrong by the end, so the checksum is a real witness
    // rather than a formality.
    for (int i = 0; i < CANARY_STEPS; ++i) {
        a = __fmaf_rn(a, b, 1.0e-7f);
        b = __fmaf_rn(b, a, -1.0e-7f);
    }
    out[0] = a + b;
}

static uint64_t fnv1a(const void *data, size_t nbytes) {
    const unsigned char *p = (const unsigned char *)data;
    uint64_t h = 1469598103934665603ULL;
    for (size_t i = 0; i < nbytes; ++i) { h ^= p[i]; h *= 1099511628211ULL; }
    return h;
}

static void no_spaces(char *dst, size_t cap, const char *src) {
    size_t i = 0;
    for (; src[i] && i + 1 < cap; ++i) dst[i] = (src[i] == ' ') ? '_' : src[i];
    dst[i] = '\0';
}

// The loud failure. Both halves matter: the machine line is what a harness parses, the human line is
// what the operator reads — and the non-zero code is what a caller can act on without parsing either.
#define CUDA_OK(call) do { \
    cudaError_t e_ = (call); \
    if (e_ != cudaSuccess) { \
        char msg[128]; no_spaces(msg, sizeof msg, cudaGetErrorString(e_)); \
        printf("KAGO-WORKLOAD name=canary error=%s at=%s\n", msg, #call); \
        fprintf(stderr, "canary: CUDA error: %s at %s\n", cudaGetErrorString(e_), #call); \
        return 2; \
    } \
} while (0)

// --------------------------------------------------------------------------------------------
// Host clock. QueryPerformanceCounter, not `timespec_get`: MSVC's implementation of the latter is
// tied to the coarse system time, and this file's entire subject is sub-millisecond.
// --------------------------------------------------------------------------------------------
static LARGE_INTEGER g_qpf;

static inline int64_t now_us(void) {
    LARGE_INTEGER c;
    QueryPerformanceCounter(&c);
    return (int64_t)((c.QuadPart * 1000000LL) / g_qpf.QuadPart);
}

// --------------------------------------------------------------------------------------------
// The histogram and its percentiles. `over` counts samples past the last bucket and `max` is tracked
// separately and exactly, so an outlier can never hide inside a saturating bucket — a percentile
// that silently clamps is the `bugs/124` class in miniature.
// --------------------------------------------------------------------------------------------
typedef struct {
    uint32_t *bucket;
    uint64_t count;
    uint64_t over;
    int64_t  max;
} hist_t;

static int hist_init(hist_t *h) {
    h->bucket = (uint32_t *)calloc(HIST_BUCKETS, sizeof(uint32_t));
    h->count = 0; h->over = 0; h->max = 0;
    return h->bucket != NULL;
}

static void hist_add(hist_t *h, int64_t us) {
    if (us < 0) us = 0;
    if (us > h->max) h->max = us;
    if ((uint64_t)us < HIST_BUCKETS) h->bucket[us]++; else h->over++;
    h->count++;
}

/** The value at quantile q (0..1). Samples past the last bucket answer with the exact max. */
static int64_t hist_q(const hist_t *h, double q) {
    if (h->count == 0) return 0;
    uint64_t want = (uint64_t)(q * (double)h->count);
    if (want >= h->count) want = h->count - 1;
    uint64_t seen = 0;
    for (uint32_t i = 0; i < HIST_BUCKETS; ++i) {
        seen += h->bucket[i];
        if (seen > want) return (int64_t)i;
    }
    return h->max;
}

// --------------------------------------------------------------------------------------------
// WAITING UNTIL `target_us` — CHOSEN BY MEASUREMENT, and the first shape written here was WRONG.
//
// The first draft slept the whole milliseconds with `Sleep` and spun the sub-millisecond tail. Its
// first live run beat 2001 of 2001 datagrams (delivery was never the problem) with gap median
// 4,94 ms — and p90 15,24 · p99 16,06 · max 20,37 ms, i.e. the Windows 15,6 ms quantum byte for
// byte, WHILE `timeBeginPeriod(1)` had returned success. The `bugs/128` signature exactly, and it
// is why this file reports observed gaps instead of asking the OS what resolution it thinks it has.
//
// Five shapes were then measured head to head on this machine, 600 samples each at a 5 ms tick,
// twice (the scratch probe is reproduced in `plans/96` step 1's record):
//
//   shape                          run 1 p99 / max        run 2 p99 / max
//   Sleep(5)                       16,004 / 16,642        6,487 / 6,751
//   Sleep + spin tail              16,617 / 25,065        5,354 / 5,499
//   HR waitable timer               7,065 /  8,727       12,249 / 20,091
//   HR timer + spin tail            9,536 / 14,741       11,570 / 16,492
//   HR + spin + TIME_CRITICAL       5,040 /  5,107        5,000 /  5,137
//   HR only + TIME_CRITICAL             —                 5,553 /  5,734
//
// THE READING, and it is not the one expected going in: at NORMAL priority every shape's TAIL wanders
// between 5,5 and 25 ms from run to run — so what buys stability is the THREAD PRIORITY, not the
// timer; the spin tail then collects the last half-millisecond. Only one shape held on both runs,
// and it is the one below. ⚠️ Honest border: two runs of 600 samples on a machine whose background
// moved between them is not a distribution — it is enough to CHOOSE a mechanism, and not enough to
// derive a setpoint. The setpoint comes from phase 2, under the furnace (`plans/95` §4).
//
// `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION` is Microsoft's own documented answer for sub-quantum
// waits (Windows 10 1803+), independent of the global `timeBeginPeriod` state — a mechanism found
// by consulting the platform rather than by tuning our own loop harder. When it is unavailable the
// fallback is the old Sleep shape, and the run SAYS which one it used: a canary whose cadence
// silently degraded would be an instrument lying about its own resolution.
//
// THE PRICE IS NAMED, NOT HIDDEN: the spin tail is at most 1 ms of every 5 ms tick, i.e. up to 20 %
// of ONE core of sixteen threads, and TIME_CRITICAL is priority 15 inside a NORMAL priority class —
// it cannot starve the system. Whether that price moves the burn's verdict is E95-AC6, measured in
// phase 2 where the burn actually runs.
// --------------------------------------------------------------------------------------------
static HANDLE g_hrtimer = NULL;   // NULL = unavailable, and the output line says so

static void wait_until(int64_t target_us) {
    for (;;) {
        const int64_t left = target_us - now_us();
        if (left <= 0) return;
        if (left > 1000) {
            if (g_hrtimer) {
                LARGE_INTEGER due;
                due.QuadPart = -(LONGLONG)((left - 1000) * 10LL);   // 100 ns units, negative = relative
                if (SetWaitableTimerEx(g_hrtimer, &due, 0, NULL, NULL, NULL, 0)) {
                    WaitForSingleObject(g_hrtimer, INFINITE);
                    continue;
                }
            }
            Sleep((DWORD)((left - 1000) / 1000));
        } else {
            YieldProcessor();
        }
    }
}

/** Has the process we were told to follow gone away? Absent `--parent-pid`, always false. */
static bool parent_gone(HANDLE hParent) {
    if (hParent == NULL) return false;
    return WaitForSingleObject(hParent, 0) == WAIT_OBJECT_0;
}

int main(int argc, char **argv) {
    QueryPerformanceFrequency(&g_qpf);

    int   port           = 0;        // 0 = no port = the self-proof mode the build pipeline runs
    int   tick_us        = 5000;     // the ORDERED cadence; the DELIVERED one is measured, not assumed
    int   seconds        = 0;        // duration; `--seconds` and `--sustain` are one number
    int   parent_pid     = 0;
    int   poll_timeout_ms = 5000;    // observation bound, never a setpoint (phase 3 measures the truth)

    for (int a = 1; a < argc; ++a) {
        if (strcmp(argv[a], "--port") == 0 && a + 1 < argc) { port = atoi(argv[++a]); continue; }
        if (strcmp(argv[a], "--tick") == 0 && a + 1 < argc) { tick_us = atoi(argv[++a]) * 1000; continue; }
        if (strcmp(argv[a], "--seconds") == 0 && a + 1 < argc) { seconds = atoi(argv[++a]); continue; }
        if (strcmp(argv[a], "--sustain") == 0 && a + 1 < argc) { seconds = atoi(argv[++a]); continue; }
        if (strcmp(argv[a], "--parent-pid") == 0 && a + 1 < argc) { parent_pid = atoi(argv[++a]); continue; }
        if (strcmp(argv[a], "--poll-timeout-ms") == 0 && a + 1 < argc) { poll_timeout_ms = atoi(argv[++a]); continue; }
        // An unknown argument is REFUSED, not ignored. A canary silently running with a mistyped
        // port would beat into the void and read, from the judge's side, exactly like a dead card.
        printf("KAGO-WORKLOAD name=canary error=unknown_argument at=%s\n", argv[a]);
        fprintf(stderr, "canary: unknown argument: %s\n", argv[a]);
        fprintf(stderr, "canary: usage: canary.exe [--sustain <s>] | --port <P> [--tick <ms>] "
                        "[--seconds <s>] [--parent-pid <pid>] [--poll-timeout-ms <ms>]\n");
        return 4;
    }
    if (port < 0 || port > 65535 || tick_us <= 0 || seconds < 0) {
        printf("KAGO-WORKLOAD name=canary error=argument_out_of_range at=validation\n");
        fprintf(stderr, "canary: argument out of range: port=%d tick_us=%d seconds=%d\n",
                port, tick_us, seconds);
        return 4;
    }

    HANDLE hParent = NULL;
    if (parent_pid > 0) {
        hParent = OpenProcess(SYNCHRONIZE, FALSE, (DWORD)parent_pid);
        if (hParent == NULL) {
            // The parent is already gone, or we may not look at it. Either way this is announced —
            // an orphan that quietly outlives its run is machinery nobody asked for.
            printf("KAGO-WORKLOAD name=canary error=parent_not_openable at=OpenProcess\n");
            fprintf(stderr, "canary: cannot open parent pid %d (err %lu)\n", parent_pid, GetLastError());
            return 4;
        }
    }

    // ---- the socket, before the card: a canary that can compute but cannot SPEAK is useless, and
    // finding that out after the card is armed would be the expensive order.
    SOCKET sock = INVALID_SOCKET;
    sockaddr_in dst;
    if (port > 0) {
        WSADATA wsa;
        const int werr = WSAStartup(MAKEWORD(2, 2), &wsa);
        if (werr != 0) {
            printf("KAGO-WORKLOAD name=canary error=wsastartup_failed at=WSAStartup\n");
            fprintf(stderr, "canary: WSAStartup failed: %d\n", werr);
            return 3;
        }
        sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
        if (sock == INVALID_SOCKET) {
            printf("KAGO-WORKLOAD name=canary error=socket_failed at=socket\n");
            fprintf(stderr, "canary: socket() failed: %d\n", WSAGetLastError());
            WSACleanup();
            return 3;
        }
        memset(&dst, 0, sizeof dst);
        dst.sin_family = AF_INET;
        dst.sin_port = htons((u_short)port);
        dst.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    }

    // ---- the cadence machinery. Requested, never trusted: what we PUBLISH is the observed gap.
    // `timeBeginPeriod(1)` stays because the fallback path needs it and it costs nothing; it is NOT
    // what holds the tick (the measurement above says the thread priority is).
    const bool period_ok = (timeBeginPeriod(1) == TIMERR_NOERROR);
    bool prio_critical = false;
    if (port > 0) {
        g_hrtimer = CreateWaitableTimerExW(NULL, NULL,
                                           CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
        // TIME_CRITICAL inside a NORMAL priority class — priority 15, not real-time: it cannot
        // starve the system, and it is the single thing that made the tick's TAIL reproducible
        // across runs. Only in beat mode: the self-proof run has no cadence to hold.
        prio_critical = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL) != 0;
        if (!g_hrtimer) {
            // Not fatal — the fallback works — but never silent: an instrument whose resolution
            // quietly degraded is an instrument lying about itself.
            fprintf(stderr, "canary: high-resolution waitable timer unavailable (err %lu), "
                            "falling back to Sleep — the tick's tail will be worse\n", GetLastError());
        }
    }

    // ---- the card. Ask it for its priority range rather than naming a number: a priority the
    // driver does not honour must show up as a FACT of the run, not as a silent assumption.
    int prio_lo = 0, prio_hi = 0;
    CUDA_OK(cudaDeviceGetStreamPriorityRange(&prio_lo, &prio_hi));
    cudaStream_t stream;
    // `cudaStreamNonBlocking`: without it the stream synchronises with the legacy default stream, and
    // the canary would queue behind whatever else the process touched — the queue-length trap again.
    CUDA_OK(cudaStreamCreateWithPriority(&stream, cudaStreamNonBlocking, prio_hi));

    float *d_out = nullptr;
    CUDA_OK(cudaMalloc(&d_out, sizeof(float)));
    float h_out = 0.0f;

    cudaEvent_t ev;
    // `cudaEventDisableTiming`: we time on the HOST, because the host clock is what the judge's
    // silence is measured against. A device-side timing event would answer a different question.
    CUDA_OK(cudaEventCreateWithFlags(&ev, cudaEventDisableTiming));

    hist_t lat, gap;
    if (!hist_init(&lat) || !hist_init(&gap)) {
        printf("KAGO-WORKLOAD name=canary error=host_alloc_failed at=hist_init\n");
        fprintf(stderr, "canary: host allocation failed\n");
        return 2;
    }

    // ---- WARM-UP, AND IT IS NOT HYGIENE — IT IS THE FIRST THING THIS FILE MEASURED.
    // The very first run of this binary reported median 10 µs and max 97 142 µs over 64 launches of
    // a 99 ms wall: ONE launch — the first — carried the whole CUDA context bring-up and was 97 ms
    // late. A canary that starts beating before that has finished is 97 ms silent AT BIRTH, which is
    // three orders of magnitude past its own tick and would trip the judge on a perfectly healthy
    // card. So the context is brought up OUTSIDE the histogram and outside the clock, and the run's
    // clock starts after it. (Same reason `furnace.cu` carries WARMUP_LAUNCHES; found here by
    // running the thing rather than by remembering that.)
    for (int w = 0; w < CANARY_WARMUP_LAUNCHES; ++w) {
        canary_tick<<<CANARY_BLOCKS, CANARY_THREADS, 0, stream>>>(d_out);
    }
    CUDA_OK(cudaGetLastError());
    CUDA_OK(cudaStreamSynchronize(stream));

    // Self-proof mode needs a bounded default; beat mode without `--seconds` would be unbounded, and
    // an unbounded canary is a loaded gun (the same reasoning `loop-guard --until` carries).
    const int64_t start_us = now_us();
    const int default_launches = 64;
    const int64_t deadline_us = (seconds > 0)
        ? start_us + (int64_t)seconds * 1000000LL
        : (port > 0 ? start_us + 10LL * 1000000LL : 0);

    uint64_t launches = 0, beats = 0;
    uint64_t first_sum = 0, seen[MAX_DISTINCT];
    int ndistinct = 0;
    int64_t last_beat_us = 0;
    int rc = 0;

    for (;;) {
        const int64_t tick_start_us = now_us();

        canary_tick<<<CANARY_BLOCKS, CANARY_THREADS, 0, stream>>>(d_out);
        CUDA_OK(cudaGetLastError());
        CUDA_OK(cudaEventRecord(ev, stream));

        // THE NON-BLOCKING POLL — the heart of the file. `cudaEventSynchronize` here would hand this
        // thread to the driver and the canary would vanish into the stall instead of timing it.
        const int64_t poll_deadline_us = tick_start_us + (int64_t)poll_timeout_ms * 1000LL;
        cudaError_t q;
        for (;;) {
            q = cudaEventQuery(ev);
            if (q != cudaErrorNotReady) break;
            if (now_us() >= poll_deadline_us) break;
            SwitchToThread();   // yield, do not spin the core: we are watching, not racing
        }
        if (q == cudaErrorNotReady) {
            // OBSERVATION, and it is reported as one. No setpoint is derived here — what a really
            // hung card does to this poll is measured in phase 3 of the epic (`plans/95` §4).
            printf("KAGO-WORKLOAD name=canary error=kernel_not_retired_within_poll_bound at=cudaEventQuery\n");
            fprintf(stderr, "canary: kernel did not retire within %d ms at launch %llu\n",
                    poll_timeout_ms, (unsigned long long)launches);
            rc = 5;
            break;
        }
        if (q != cudaSuccess) {
            char msg[128]; no_spaces(msg, sizeof msg, cudaGetErrorString(q));
            printf("KAGO-WORKLOAD name=canary error=%s at=cudaEventQuery\n", msg);
            fprintf(stderr, "canary: CUDA error: %s at cudaEventQuery\n", cudaGetErrorString(q));
            rc = 2;
            break;
        }

        const int64_t ready_us = now_us();
        hist_add(&lat, ready_us - tick_start_us);

        // The beat goes out AFTER the event reports the kernel retired — i.e. after the CARD has
        // answered. A beat sent at launch time would report our intention, not the card's progress;
        // that is the same line the furnace's progress heartbeat had to be moved below.
        if (port > 0) {
            const char b = (char)BEAT_CANARY;
            if (sendto(sock, &b, 1, 0, (sockaddr *)&dst, sizeof dst) == 1) {
                beats++;
                if (last_beat_us != 0) hist_add(&gap, ready_us - last_beat_us);
                last_beat_us = ready_us;
            }
            // A dropped loopback datagram is NOT fatal and NOT hidden: it shows up as `beats` below
            // `expected`, which is precisely the number P96-AC2 judges.
        }

        // The checksum is read back only in the self-proof mode: a `cudaMemcpy` per tick would add
        // a second synchronisation point to the very latency this file exists to measure.
        if (port == 0) {
            CUDA_OK(cudaMemcpy(&h_out, d_out, sizeof(float), cudaMemcpyDeviceToHost));
            const uint64_t sum = fnv1a(&h_out, sizeof h_out);
            if (launches == 0) first_sum = sum;
            bool known = false;
            for (int k = 0; k < ndistinct; ++k) { if (seen[k] == sum) { known = true; break; } }
            if (!known && ndistinct < MAX_DISTINCT) seen[ndistinct++] = sum;
        }

        launches++;

        if (parent_gone(hParent)) {
            fprintf(stderr, "canary: parent pid %d is gone — stopping\n", parent_pid);
            break;
        }
        if (deadline_us > 0) {
            if (now_us() >= deadline_us) break;
        } else if (launches >= (uint64_t)default_launches) {
            break;
        }

        // Tick boundaries are absolute, never «previous + tick»: a relative cadence accumulates its
        // own lateness and would report a drift of our making as a property of the card.
        if (port > 0) wait_until(start_us + (int64_t)(launches * (uint64_t)tick_us));
    }

    const int64_t wall_us = now_us() - start_us;
    // `+ 1` because the ticks are launched at t = 0, tick, 2·tick, … — the launch at zero is a beat
    // too. Without it the instrument reported 2001 delivered of 2000 expected, i.e. 100,05 %: a
    // meter that overshoots its own denominator is the `bugs/124` class in miniature, and a delivery
    // figure is exactly what P96-AC2 is judged on.
    const uint64_t expected = (port > 0 && tick_us > 0)
        ? (uint64_t)(wall_us / tick_us) + 1 : 0;

    printf("KAGO-CANARY tick_us=%d launches=%llu beats=%llu expected=%llu stream_priority=%d "
           "priority_range=%d..%d timer_period_1ms=%d hr_timer=%d thread_time_critical=%d wall_us=%lld "
           "lat_med_us=%lld lat_p90_us=%lld lat_p99_us=%lld lat_max_us=%lld "
           "gap_med_us=%lld gap_p90_us=%lld gap_p99_us=%lld gap_max_us=%lld\n",
           tick_us, (unsigned long long)launches, (unsigned long long)beats,
           (unsigned long long)expected, prio_hi, prio_lo, prio_hi, period_ok ? 1 : 0,
           g_hrtimer ? 1 : 0, prio_critical ? 1 : 0,
           (long long)wall_us,
           (long long)hist_q(&lat, 0.50), (long long)hist_q(&lat, 0.90),
           (long long)hist_q(&lat, 0.99), (long long)lat.max,
           (long long)hist_q(&gap, 0.50), (long long)hist_q(&gap, 0.90),
           (long long)hist_q(&gap, 0.99), (long long)gap.max);

    // The pipeline's line, and ONLY in the self-proof mode: in beat mode there is no per-tick
    // read-back, so a checksum printed there would be a number with nothing behind it.
    if (port == 0) {
        printf("KAGO-WORKLOAD name=canary checksum=%016llx launches=%llu distinct=%d ms=%lld\n",
               (unsigned long long)first_sum, (unsigned long long)launches,
               ndistinct, (long long)(wall_us / 1000));
    }

    fprintf(stderr, "canary: %llu launches, %llu beats of %llu expected, latency median %lld us, "
                    "max %lld us, priority %d of range %d..%d\n",
            (unsigned long long)launches, (unsigned long long)beats, (unsigned long long)expected,
            (long long)hist_q(&lat, 0.50), (long long)lat.max, prio_hi, prio_lo, prio_hi);

    free(lat.bucket); free(gap.bucket);
    cudaEventDestroy(ev);
    cudaFree(d_out);
    cudaStreamDestroy(stream);
    if (g_hrtimer) CloseHandle(g_hrtimer);
    if (period_ok) timeEndPeriod(1);
    if (sock != INVALID_SOCKET) { closesocket(sock); WSACleanup(); }
    if (hParent) CloseHandle(hParent);
    return rc;
}
