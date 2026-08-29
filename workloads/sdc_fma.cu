// workloads/sdc_fma.cu — the SDC-prone shape: fixed-loop, arithmetic-dense, exactly checkable.
//
// WHY THIS SHAPE EXISTS (researches/02 §2, Leng et al., MICRO 2015): of 57 programs measured on
// real cards, 37 were SDC-prone — they produce WRONG NUMBERS before they ever crash. Fixed-loop,
// regular, arithmetic-dense code is the shape that corrupts silently, and it is also the shape
// whose answer can be checked exactly. That combination is what makes this the oracle's workhorse:
// it fails in the dangerous way, and it tells you it failed.
//
// THE CONTRACT WITH THE HARNESS: this program is deterministic. Same inputs -> same checksum, on
// the same card at safe voltage, across runs and across compilers. A differing checksum with a
// zero exit code IS the SDC verdict — there is no other way to see one.
//
// Determinism is not free and the code below pays for it deliberately:
//   - no atomics, no reductions whose order depends on scheduling;
//   - every thread owns its own output slot;
//   - no fast-math contraction that could reassociate differently between builds — the harness
//     builds with -O2 and no -use_fast_math, and the checksum is over raw float BITS, not over a
//     printed decimal (printing rounds, and rounding hides a wrong low bit, which is exactly the
//     bit an undervolt flips first).
//
// SUSTAINED MODE (`--sustain <seconds>`), added 2026-08-10 for plans/03 §4.3.
//
// WHY IT EXISTS. One run used to be one PROCESS, and the process dominated: measured on this card
// at default arguments, 91 launches in 12 s = 132 ms per launch of which the kernel is 0–1 ms —
// 99.2 % of the wall time was spent starting up, and the card reached 8 % utilization. You cannot
// measure a power delta on a card that is idle, and you cannot measure a PRICE at all.
//
// AND THE PRICE IS NOT A CONVENIENCE — IT IS A DETECTOR (researches/04 §2). Clock stretching (the
// card skips instructions while still reporting the locked clock) and memory error replay (GDDR7
// carries internal ECC + CRC, so failed transfers are corrected or retried) BOTH produce a correct
// checksum and no crash. Work-per-second is the only observable either one moves. So this file's
// new numbers close a blind spot in the oracle, and happen to also be the "price" in the owner's
// «снижаем потребление, пока цена ≤ N» formula. One instrument, two jobs.
//
// THE DURATION IS A FLAG, NEVER A POSITIONAL. Positionals 0..2 keep meaning iters/blocks/threads
// exactly as they did before, so the default invocation runs the same code path that produced the
// checksum recorded in workloads/MANIFEST.json. This is also what keeps the run ARGUMENTS out of
// the golden's stamp: the harness passes the duration outside its `args` array, so the stamp
// comparison stays `[] vs []` and EXP-0011's false-SDC guard is left untouched.
//
// Usage:  sdc_fma.exe [iterations] [blocks] [threads] [--sustain <seconds>]
// Output: one machine-readable line, plus a human line on stderr. Durations are INTEGER
//   MICROSECONDS — never a float: this machine's PowerShell culture is ru-RU and a locale decimal
//   separator would corrupt every parsed number silently.
//   KAGO-WORKLOAD name=sdc_fma checksum=<16 hex> elements=<n> iters=<n> ms=<n> launches=<n>
//                 distinct=<n> gpu_us=<n> wall_us=<n> work_per_launch=<n>
// Exit:   0 ran · 2 CUDA error (the CRASH half — the harness also reads the Windows event log)
//
// [TESTED: 2026-08-09 · built through toolchain.mjs and run 5x by `npm run workloads:build`:
//  exactly ONE distinct checksum, e27ec24a82d509d7, on an RTX 5070 Ti at stock, driver 610.88.
//  P1-AC1 satisfied. The checksum is recorded in workloads/MANIFEST.json next to the sha-256 of
//  this source, so a later run that differs is either a changed source or a corrupting card.]
// [TESTED: 2026-08-10 · `npm run workloads:build` rebuilt it and the five determinism runs still
//  give e27ec24a82d509d7 — the edit is behaviour-preserving, which was the whole constraint.
//  `--sustain 12` → 15341 launches, distinct=1, gpu_us=6759026 of wall_us=12000036. Sampled by a
//  SEPARATE `npm run mon` process alongside: utilization 8 % → **57 %**, power 61.7 → 137.9 W,
//  clock 2670 → 2887 MHz, fan 0 → 34.
//  THE CROSS-CHECK THAT MAKES THE NUMBER TRUSTWORTHY: the program's self-reported duty factor
//  (gpu_us/wall_us = 56.3 %) and the card's independently reported utilization (57 %) agree. Two
//  instruments, one answer. The 43.7 % that is NOT kernel is the per-launch D2H + host hash — the
//  measured price of not going blind between launches, and it is why branchy (98.5 % duty) is the
//  saturation load while this one is the SDC sampler at 1286 launches/s against the old 7.6.]
// [TESTED: 2026-08-10 · the GRADED half, proven on a deliberately corrupted BUILD rather than by
//  argument. A copy of this source with one injected line — flip the lowest mantissa bit of element
//  123 on launch #5 — was compiled and run with `--sustain 2`. All five reported numbers came back
//  exactly as predicted: distinct=2 · bad_launches=1 · bad_elems_max=1 · bit_dist_min=1 ·
//  first_bad_index=123, over 2543 launches.
//  AND THE PART THAT MATTERS MOST: the burst's reported checksum was still e27ec24a82d509d7 and
//  still MATCHED the golden, so the old two-observation oracle would have returned PASS. The single
//  flipped bit was seen only by `distinct` and by this gradient. That is the blind spot of
//  researches/04 §2 reproduced on a real run, and the reason both exist.
//  Harness: scratchpad/prove-gradient.mjs — it builds the corrupt copy, runs it, and compares the
//  five numbers; the shipped binary carries no corruption hook of any kind.]

#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <chrono>
#include <cuda_runtime.h>

// Untimed launches before the timed window opens. Warming up is what makes a DIFFERENCE meaningful:
// the first launches pay for context creation, allocation and clock ramp, none of which is the work
// being measured.
static const int WARMUP_LAUNCHES = 10;

// How many distinct checksums we bother to remember. We only need to know whether the count is 1;
// beyond a handful the run is already condemned.
static const int MAX_DISTINCT = 8;

// The FMA chain. Each thread walks its own dependent multiply-add chain, so the arithmetic units
// stay saturated and the result depends on EVERY step: a single flipped bit anywhere in the chain
// propagates to the output instead of being averaged away.
//
// IDEMPOTENT BY CONSTRUCTION, and the sustained loop depends on it: `acc` is seeded from the thread
// index alone, nothing is read from `out`, and every slot is written by exactly one thread. So
// running this kernel N times in a row leaves the same bytes as running it once — which is why
// looping cannot change the checksum, and why a checksum that DOES change across launches inside
// one process is a real finding rather than an artefact of looping.
__global__ void fma_chain(float *out, int iters) {
    const int i = blockIdx.x * blockDim.x + threadIdx.x;
    // A per-thread starting value that is not a round number: round numbers hide mantissa errors.
    float acc = 1.0f + (float)(i % 7) * 0.001f;
    for (int k = 0; k < iters; ++k) {
        acc = acc * 1.0000001f + 0.0000001f;
    }
    out[i] = acc;
}

// FNV-1a over the raw bytes of the result. One number that changes if any bit changed.
// Deliberately computed on the HOST: a GPU-side reduction would have to survive the very
// corruption it is meant to detect.
static uint64_t fnv1a(const void *data, size_t bytes) {
    uint64_t hash = 1469598103934665603ULL;
    const unsigned char *p = (const unsigned char *)data;
    for (size_t b = 0; b < bytes; ++b) {
        hash ^= p[b];
        hash *= 1099511628211ULL;
    }
    return hash;
}

// CUDA error strings contain spaces ("unspecified launch failure"), and the harness splits the
// KAGO-WORKLOAD line on whitespace. A spaced value would silently become several bogus fields.
static void no_spaces(char *dst, size_t cap, const char *src) {
    size_t i = 0;
    for (; src[i] && i + 1 < cap; ++i) dst[i] = (src[i] == ' ') ? '_' : src[i];
    dst[i] = '\0';
}

/**
 * HOW WRONG, not merely WHETHER wrong — the graded half of the oracle.
 *
 * The checksum answers "did anything change" in one bit of information: one corrupted element and
 * sixty thousand corrupted elements produce the same verdict. For a search that walks DOWN toward
 * the failure edge that is the wrong instrument — it tells you only that you already fell off. The
 * count of differing elements is the gradient: each of the `elements` slots is one thread's own
 * independent chain, so the count IS the per-thread fault rate, the same quantity Leng et al.
 * measured going 3 % -> 90 % across two percent of voltage (researches/02 §2).
 *
 * The reference is the FIRST launch of THIS process, which is why no new file, no new stamp and no
 * new baseline format are needed. Whether launch #1 was itself correct is a separate question, and
 * the checksum-versus-golden comparison in the harness already answers it.
 *
 * WHAT IS DELIBERATELY NOT MEASURED: the numeric MAGNITUDE of the error. Both kernels are dependent
 * chains built to amplify — a bit flipped early propagates chaotically to the end, by design — so
 * |got - expected| carries no information about how large the fault was. The COUNT does; the SIZE
 * does not. Measuring it anyway would be a number with no meaning, which is worse than no number.
 *
 * Also returned: the smallest Hamming distance among the differing slots (1 means a genuine
 * single-bit flip; a large value means the value was destroyed rather than nudged), and the lowest
 * differing index, so a clustered failure points at a region of the die rather than at the run.
 */
static long long diff32(const void *gotv, const void *refv, size_t elems,
                        int *bitDistMin, long long *firstIdx) {
    const uint32_t *g = (const uint32_t *)gotv;
    const uint32_t *r = (const uint32_t *)refv;
    long long bad = 0;
    for (size_t i = 0; i < elems; ++i) {
        if (g[i] == r[i]) continue;
        uint32_t x = g[i] ^ r[i];
        int pc = 0;
        while (x) { pc += (int)(x & 1u); x >>= 1; }
        if (bad == 0) { *bitDistMin = pc; *firstIdx = (long long)i; }
        else if (pc < *bitDistMin) { *bitDistMin = pc; }
        bad++;
    }
    return bad;
}

int main(int argc, char **argv) {
    // Flags and positionals kept apart. An unknown token is treated as a positional exactly as
    // before, so nothing that used to work stops working.
    int sustain_s = 0;
    // ⚡ ВХОД 2 ПРЕДОХРАНИТЕЛЯ (эпик 51 фаза 5в, `plans/66`, разведка `researches/24`) — та же
    // правка, что в `furnace.cu` и `branchy.cu`. ⚠️ Такт этой формы — 0,78 мс на запуск (архив,
    // 6 прогонов): здесь сердцебиение выйдет в 400 раз чаще, чем у furnace, и порог M обязан
    // выводиться ИЗ ФОРМЫ, а не быть константой. БЕЗ АРГУМЕНТА — ни одного системного вызова.
    const char *progress_file = NULL;   // [NOT-TESTED]
    int pos[3] = { 100000, 256, 256 };
    int npos = 0;
    for (int a = 1; a < argc; ++a) {
        if (strcmp(argv[a], "--sustain") == 0 && a + 1 < argc) { sustain_s = atoi(argv[++a]); continue; }
        if (strcmp(argv[a], "--progress-file") == 0 && a + 1 < argc) { progress_file = argv[++a]; continue; }
        if (npos < 3) pos[npos++] = atoi(argv[a]);
    }
    const int iters   = pos[0];
    const int blocks  = pos[1];
    const int threads = pos[2];
    const size_t n = (size_t)blocks * threads;

    float *d = nullptr;
    if (cudaMalloc(&d, n * sizeof(float)) != cudaSuccess) {
        fprintf(stderr, "sdc_fma: cudaMalloc failed for %zu elements\n", n);
        return 2;
    }
    float *h = (float *)malloc(n * sizeof(float));
    if (!h) { cudaFree(d); return 2; }

    cudaEvent_t ev0, ev1;
    cudaEventCreate(&ev0);
    cudaEventCreate(&ev1);

    char errbuf[256];

    // Warm-up runs only in sustained mode: the default path must stay the one-launch program whose
    // checksum is recorded in the manifest, and a warm-up would make `npm run workloads:build`'s
    // five determinism runs needlessly slow for no gain.
    if (sustain_s > 0) {
        for (int w = 0; w < WARMUP_LAUNCHES; ++w) fma_chain<<<blocks, threads>>>(d, iters);
        const cudaError_t werr = cudaDeviceSynchronize();
        if (werr != cudaSuccess) {
            no_spaces(errbuf, sizeof(errbuf), cudaGetErrorString(werr));
            printf("KAGO-WORKLOAD name=sdc_fma error=%s\n", errbuf);
            free(h); cudaFree(d);
            return 2;
        }
    }

    long long launches = 0;
    long long gpu_us = 0;
    uint64_t first = 0;
    uint64_t seen[MAX_DISTINCT];
    int ndistinct = 0;

    // The graded half. `ref` holds the first launch's output; the element-wise diff runs ONLY when
    // the cheap checksum says something changed — a free gradient, because a clean run never pays
    // for it. bit_dist_min stays 0 while nothing has differed, which reads as "not applicable"
    // rather than as a suspiciously perfect zero.
    float *ref = (float *)malloc(n * sizeof(float));
    if (!ref) { free(h); cudaFree(d); return 2; }
    long long bad_launches = 0;
    long long bad_elems_max = 0;
    int bit_dist_min = 0;
    long long first_bad_index = -1;

    const auto t0 = std::chrono::steady_clock::now();
    for (;;) {
        cudaEventRecord(ev0);
        fma_chain<<<blocks, threads>>>(d, iters);
        cudaEventRecord(ev1);
        const cudaError_t err = cudaDeviceSynchronize();

        if (err != cudaSuccess) {
            // A CUDA error here is the CRASH half of the three-way verdict. It is reported on stdout
            // in the same machine-readable shape so the harness never has to parse two formats.
            no_spaces(errbuf, sizeof(errbuf), cudaGetErrorString(err));
            printf("KAGO-WORKLOAD name=sdc_fma error=%s launches=%lld\n", errbuf, launches);
            free(h); cudaFree(d);
            return 2;
        }

        float kernel_ms = 0.0f;
        cudaEventElapsedTime(&kernel_ms, ev0, ev1);
        gpu_us += (long long)(kernel_ms * 1000.0f + 0.5f);

        // Hashed EVERY launch, not once at the end. Every launch overwrites the whole buffer, so a
        // final-only hash would reflect the last launch alone and a corruption at launch #500 would
        // be invisible — the spawn-per-run shape caught those, and the sustained shape must not be
        // blinder than what it replaces.
        cudaMemcpy(h, d, n * sizeof(float), cudaMemcpyDeviceToHost);
        const uint64_t c = fnv1a(h, n * sizeof(float));
        if (launches == 0) {
            first = c;
            memcpy(ref, h, n * sizeof(float));
        } else if (c != first) {
            // Cheap detector said something moved — now pay for the diagnosis, and only now.
            bad_launches++;
            int bd = 0;
            long long fi = -1;
            const long long bad = diff32(h, ref, n, &bd, &fi);
            if (bad > bad_elems_max) bad_elems_max = bad;
            if (bit_dist_min == 0 || bd < bit_dist_min) bit_dist_min = bd;
            if (first_bad_index < 0 || (fi >= 0 && fi < first_bad_index)) first_bad_index = fi;
        }
        bool known = false;
        for (int k = 0; k < ndistinct; ++k) { if (seen[k] == c) { known = true; break; } }
        if (!known && ndistinct < MAX_DISTINCT) seen[ndistinct++] = c;
        launches++;

        // ⚡ Сердцебиение прогресса — после сверки запуска с эталоном (`plans/66`).
        if (progress_file) {
            FILE *pf = fopen(progress_file, "w");
            if (pf) { fprintf(pf, "%lld\n", launches); fclose(pf); }
        }

        if (sustain_s <= 0) break;
        const long long elapsed_us =
            std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - t0).count();
        if (elapsed_us >= (long long)sustain_s * 1000000LL) break;
    }
    const auto t1 = std::chrono::steady_clock::now();

    const long long wall_us = std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count();
    const long long ms = wall_us / 1000;
    const long long work_per_launch = (long long)n * (long long)iters;

    // The checksum reported is the FIRST launch's, so the golden comparison keeps its meaning even
    // when `distinct > 1` — and `distinct` is what tells the harness the run disagreed with itself.
    // ⚡ Удаление файла сердцебиения при штатном выходе — ПРИЗНАК «прожига нет» (`plans/66`).
    if (progress_file) remove(progress_file);

    printf("KAGO-WORKLOAD name=sdc_fma checksum=%016llx elements=%zu iters=%d ms=%lld "
           "launches=%lld distinct=%d gpu_us=%lld wall_us=%lld work_per_launch=%lld "
           "bad_launches=%lld bad_elems_max=%lld bit_dist_min=%d first_bad_index=%lld\n",
           (unsigned long long)first, n, iters, ms,
           launches, ndistinct, gpu_us, wall_us, work_per_launch,
           bad_launches, bad_elems_max, bit_dist_min, first_bad_index);
    fprintf(stderr, "sdc_fma: %zu elements, %d iterations, %lld launches, %lld us on the GPU of %lld us wall\n",
            n, iters, launches, gpu_us, wall_us);

    cudaEventDestroy(ev0);
    cudaEventDestroy(ev1);
    free(ref);
    free(h);
    cudaFree(d);
    return 0;
}
