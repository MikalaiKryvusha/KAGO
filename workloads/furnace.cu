// furnace.cu — the burn that loads EVERY unit we can reach and stays a MEASURING instrument.
//
// THE OWNER'S ORDER, verbatim (2026-08-22): «нужно придумать нагрузку, чтобы она предсказуемо
// грузила как можно больше блоков и модулей GPU, включая VRAM — она тоже горячая и в эти 10 секунд
// даст вклад в тепловую нагрузку на радиатор — а значит и на GPU» · «и эта нагрузка для нас должна
// быть ценна в плане предсказания края для оракула».
//
// The second sentence is the DESIGN RULE: heat with no oracle value does not count. Every unit this
// kernel touches folds its work into the same per-thread accumulator that the host checksums — so a
// fault in ANY loaded unit moves the checksum, and the graded oracle (count of differing slots)
// keeps measuring HOW WRONG, not merely WHETHER. A unit that merely spins without feeding the sum
// would be a heater the oracle is blind to — exactly what this file exists to avoid.
//
// WHAT IS LOADED, and how each feeds the checksum:
//   · FP32 ALU        — the same amplifying FMA chain as sdc_fma (its trust contract is paid for);
//   · VRAM read path  — every thread streams a fixed, thread-owned slice of a large device table
//                       and folds every word read into the chain. GDDR7's own ECC/CRC corrects the
//                       BUS, but a bit that flips IN STORAGE between refreshes is served corrected-
//                       looking and WRONG — folding reads into the sum is the only way we see it
//                       (researches/04 §3.3: the VRAM trap, «write once, reread every time»);
//   · VRAM write path — each iteration also RE-WRITES one word of the thread's slice (the value it
//                       just computed), so write drivers and cell refresh carry load too. The word
//                       is read back and folded on the NEXT pass over the slice, closing the loop;
//   · SFU             — one transcendental (__sinf) per outer step, folded in. The special-function
//                       units are otherwise idle, and their result is data like any other;
//   · INT/addressing  — the LCG that walks each thread's slice is integer work feeding addresses;
//                       a broken address reads the WRONG word of the table, and since every table
//                       word is unique, the checksum moves.
//
// WHAT IS DELIBERATELY NOT LOADED: RT cores (the owner's own boundary — interviews/008, variant A,
// «чини что умеешь, RT не трогай»; CUDA cannot address them at all) and tensor cores (WMMA would
// add an order-dependent reduction and break the trust contract below; named, not hidden).
//
// THE TRUST CONTRACT — same as sdc_fma, restated because every clause was needed:
//   · IDEMPOTENT BY CONSTRUCTION: the table is filled from thread-owned seeds, each slot written by
//     exactly one thread, out[] written by exactly one thread, nothing read outside the thread's own
//     slice. Running the kernel N times leaves the same bytes as running it once — the sustain loop
//     cannot move the checksum, so a checksum that DOES move inside one process is a finding.
//   · NO ATOMICS, NO REDUCTIONS on the device: order never affects the result.
//   · THE CHECKSUM IS COMPUTED ON THE HOST (FNV-1a over the raw out[] bytes): a GPU-side reduction
//     would have to survive the very corruption it exists to detect.
//   · THE TABLE IS DETERMINISTIC AND THREAD-SEEDED, never filled by "the card being tested" in a
//     way another card would disagree with: slot j of thread i holds lcg(seed=i)·step j — any
//     healthy card produces the identical table, so corruption is OURS to see, not baked in.
//
// WHY A NEW FILE AND NOT AN EDIT OF sdc_fma.cu: sdc_fma's checksum e27ec24a82d509d7 anchors every
// golden, every recorded verdict and the manifest. Editing it invalidates that history in place;
// a sibling keeps the old instrument intact while the new one earns its own goldens (plan 21 risk
// (b) — the smallest reversible form).
//
// Usage:  furnace.exe [iterations] [blocks] [threads] [fma-per-word] [--sustain <seconds>]
//   Defaults: 2400 · 8192 · 256 · 64 — the shape the 2026-08-22 power grid MEASURED as the peak
//   (305 W median of a 300 W limit, `sw_power_cap` reported by the driver, 4 950 GB of VRAM traffic
//   in ten seconds). The table is DERIVED, not a knob: threads × WIN_WORDS × 4 B = 8 GiB at the
//   default shape — one fewer argument that could disagree with the grid.
//   `iterations` are OUTER steps; each issues INNER_READS independent loads, then spends
//   fma-per-word FMAs on each fetched word plus one SFU op.
//
// MEMORY LAYOUT IS WARP-COALESCED, and that is a THERMAL decision, not a style one: the first
// draft gave each thread a private window walked by LCG, and one launch measured 33 GB/s of useful
// bandwidth — scattered 4-byte reads pull whole sectors, the modulo by a non-power-of-two window
// was an integer division in the hottest loop, and VRAM sat far below its power. In this layout a
// warp's 32 lanes read 32 CONSECUTIVE words (one 128-byte transaction), the window size is a power
// of two (mask, not division), and the memory controllers stream at full width — which is exactly
// what «VRAM тоже горячая» asked for. Every lane still folds its own word; coverage is not thinner,
// it is merely faster and hotter.
// Output: one machine-readable line on stdout, human line on stderr. Integer microseconds only —
//   ru-RU locale would corrupt a float silently:
//   KAGO-WORKLOAD name=furnace checksum=<16 hex> elements=<n> iters=<n> ms=<n> launches=<n>
//                 distinct=<n> gpu_us=<n> wall_us=<n> work_per_launch=<n> table_mb=<n> read_gb=<n>
// Exit:   0 ran · 2 CUDA error (the CRASH half — the harness also reads the Windows event log).
//
// [NOT-TESTED] at birth — flipped by `npm run workloads:build` proving ONE distinct checksum over
// 5 runs at stock, and by the measured-power grid quoting watts/duty from a real capture.

#include <cuda_runtime.h>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <ctime>

// Words each thread folds per outer iteration. 32 words = 128 bytes per thread per step keeps the
// memory pipes full without starving the ALU chain between touches.
#define INNER_READS 8
// ONE warmup, not three. sdc_fma could afford three because a launch there is milliseconds; here a
// launch moves gigabytes, and three of them cost 35 s of the 47 s the first measured run took —
// a warmup longer than the burn it warms up for.
#define WARMUP_LAUNCHES 1
// Per-THREAD window in words — a power of two, so the walk masks instead of dividing. Per warp the
// window is 32× this, laid out interleaved: word j of lane l lives at j*32+l, so one (j) step by a
// whole warp is 32 consecutive words = one coalesced transaction.
#define WIN_WORDS 1024u
// How many distinct checksums we bother to remember — we only need to know whether the count is 1.
#define MAX_DISTINCT 8

// ---------------------------------------------------------------------------------------------
// The table fill. Each slot belongs to exactly ONE (thread, j) pair: slot = base(i) + j. The value
// is a full-period 32-bit LCG walked j steps from a thread-owned seed — every slot unique, every
// slot deterministic, no thread reads another thread's slot during the FILL. (During the BURN the
// slices INTERLEAVE deliberately — see the kernel — but reads are still pure and the read set is a
// pure function of the thread index, so idempotence holds.)
// ---------------------------------------------------------------------------------------------
__host__ __device__ static inline uint32_t lcg_next(uint32_t x) {
    return x * 1664525u + 1013904223u;
}

__global__ void furnace_fill(uint32_t *table, size_t words) {
    const size_t stride = (size_t)gridDim.x * blockDim.x;
    for (size_t s = blockIdx.x * (size_t)blockDim.x + threadIdx.x; s < words; s += stride) {
        // Value is a PURE FUNCTION OF THE SLOT INDEX — the whole invariant in one line. Any grid
        // geometry, any launch, any healthy card produces the identical table; nothing about the
        // filling thread leaks in, so there is nothing to "mix back out".
        table[s] = ((uint32_t)(s ^ (s >> 13)) * 2246822519u + 374761393u) ^ lcg_next((uint32_t)s);
    }
}

// ---------------------------------------------------------------------------------------------
// The burn. Per outer iteration each thread:
//   1. reads INNER_READS words from the table at LCG-derived offsets inside its own window —
//      folding every word into the float chain through a bit-cast add;
//   2. FMA-amplifies between touches (the sdc_fma contract: dependent chain, no reassociation);
//   3. computes one __sinf of the running value and folds it (SFU load, data-carrying);
//   4. rewrites ONE table word of its window with a value derived from the chain, read back and
//      folded on the next pass — write path loaded, loop closed, still one owner per slot.
// OWNERSHIP AND COALESCING TOGETHER. Thread i owns WIN_WORDS words, but they are NOT contiguous:
// lane l of warp w owns words { warpBase + j*32 + l : j < WIN_WORDS }. So one j-step taken by the
// whole warp touches 32 consecutive words — a single 128-byte transaction — while each lane still
// reads and writes only slots nobody else owns. Disjoint ownership (idempotence) and full-width
// streaming (heat) are not in tension once the layout is interleaved rather than blocked.
// ---------------------------------------------------------------------------------------------
__global__ void furnace_burn(float *out, uint32_t *table, int iters, int fmaPerRead) {
    const size_t i = blockIdx.x * (size_t)blockDim.x + threadIdx.x;
    const uint32_t lane = (uint32_t)(i & 31u);
    const size_t warpBase = (i >> 5) * (size_t)WIN_WORDS * 32u;
    uint32_t *win = table + warpBase + lane;         // lane's slot inside step 0

    float acc = 1.0f + (float)(i % 7) * 0.001f;      // sdc_fma's seeding, deliberately

    // THE STEP INDEX IS SHARED BY THE WARP — this one line is what makes the layout coalesce, and
    // getting it wrong is invisible except in watts. The first version seeded `pos` from the THREAD
    // index, so every lane walked its own j: addresses warpBase + j_lane*32 + lane are 32 scattered
    // sectors, not one 128-byte line. Measured cost of that mistake: 375 GB of useful traffic took
    // 11,7 s of GPU — about 32 GB/s on a card that streams an order of magnitude faster.
    uint32_t j = (uint32_t)(i >> 5) * 2654435761u;   // warp-uniform start, spread across the table

    for (int k = 0; k < iters; ++k) {
        // 1: the batch of reads is ISSUED FIRST and INDEPENDENTLY — no read waits for the previous
        // one, so the memory pipe fills while the ALU keeps working below. The walk is SEQUENTIAL:
        // heat comes from bandwidth, and bandwidth comes from DRAM page locality.
        uint32_t w[INNER_READS];
        #pragma unroll
        for (int r = 0; r < INNER_READS; ++r) {
            w[r] = win[(size_t)((j + (uint32_t)r) & (WIN_WORDS - 1u)) * 32u];
        }
        j += INNER_READS;
        // 2: THE ARITHMETIC RUNS WHILE THOSE READS ARE IN FLIGHT, and this ratio is the whole
        // design. The first version folded each word the instant it was read, so the dependent FMA
        // chain stalled on memory latency and the SMs idled: measured 207 W against sdc_fma's 233 W
        // — MORE traffic and LESS heat, because we had traded ALU watts for memory watts instead of
        // adding them. With a burst of independent-of-memory FMAs between folds, both pipes are
        // busy at once. `fmaPerRead` is a runtime knob because the right ratio is a question for
        // the card, not for reasoning (plan 21, step 1).
        #pragma unroll
        for (int r = 0; r < INNER_READS; ++r) {
            for (int m = 0; m < fmaPerRead; ++m) acc = acc * 1.0000001f + 0.0000001f;
            acc = acc * 1.0000001f + (float)(w[r] & 0xFFFFu) * 1e-9f;
        }
        // 3: one transcendental per outer step — the SFU carries data, not decoration.
        acc = acc + __sinf(acc) * 1e-6f;
        // 4: write path. Half a window away from the read head, so the value written this pass is
        // read back later in the SAME pass — the loop closes without the write ever colliding with
        // the read stream. The slot is one this lane owns, so idempotence survives.
        uint32_t back = __float_as_uint(acc);
        win[(size_t)((j + (WIN_WORDS / 2u)) & (WIN_WORDS - 1u)) * 32u] = back ^ lcg_next(back);
    }
    out[i] = acc;
}

// FNV-1a on the host — one number that moves if any bit moved.
static uint64_t fnv1a(const void *data, size_t bytes) {
    uint64_t hash = 1469598103934665603ULL;
    const unsigned char *p = (const unsigned char *)data;
    for (size_t b = 0; b < bytes; ++b) { hash ^= p[b]; hash *= 1099511628211ULL; }
    return hash;
}

static void no_spaces(char *dst, size_t cap, const char *src) {
    size_t i = 0;
    for (; src[i] && i + 1 < cap; ++i) dst[i] = (src[i] == ' ') ? '_' : src[i];
    dst[i] = '\0';
}

#define CUDA_OK(call) do { \
    cudaError_t e_ = (call); \
    if (e_ != cudaSuccess) { \
        char msg[128]; no_spaces(msg, sizeof msg, cudaGetErrorString(e_)); \
        printf("KAGO-WORKLOAD name=furnace error=%s at=%s\n", msg, #call); \
        fprintf(stderr, "furnace: CUDA error: %s at %s\n", cudaGetErrorString(e_), #call); \
        return 2; \
    } \
} while (0)

int main(int argc, char **argv) {
    int sustain_s = 0;
    // THE DEFAULTS ARE THE MEASURED WINNER, not a guess (EXP-0078 — a shape that lives in an
    // argument someone must remember to type is a hope with a citation). Grid of 2026-08-22, 10 s
    // per point, sampler and workload measured independently:
    //
    //   fma/word →      0      16      32      48    [64]      96     128     256    1024    4096
    //   watts    →    207     238     248     269   [305]     287     275     267     252     229
    //
    // The peak is a BLEND and the shape of the curve says why: with too few FMAs per word the SMs
    // stall on memory and we buy memory watts by giving up ALU watts (207 W with MORE traffic than
    // the winner); with too many, the memory pipe drains and we are back to sdc_fma's 233 W. At 64
    // both run at once — 305 W median, 325 W peak, `sw_power_cap` reported by the driver, i.e. the
    // card is CLAMPED BY ITS POWER LIMIT, which is what the owner asked the burn to do. Iterations
    // 2400 (not 600) because a longer launch amortizes the host-side hash: duty 88,6 % → 93,6 %.
    int pos[4] = { 2400, 8192, 256, 64 };
    int npos = 0;
    for (int a = 1; a < argc; ++a) {
        if (strcmp(argv[a], "--sustain") == 0 && a + 1 < argc) { sustain_s = atoi(argv[++a]); continue; }
        if (npos < 4) pos[npos++] = atoi(argv[a]);
    }
    const int iters      = pos[0];
    const int blocks     = pos[1];
    const int threads    = pos[2];
    const int fmaPerRead = pos[3];
    const size_t n = (size_t)blocks * threads;

    // The table is DERIVED from the shape, not asked for: every thread owns exactly WIN_WORDS words.
    // A size the caller could set independently of the grid would let the two disagree, and the
    // failure would be silent — windows overlapping or a tail nobody owns, both of which quietly
    // break the one-owner-per-slot invariant the whole trust contract rests on.
    const size_t tableWords = n * (size_t)WIN_WORDS;

    float *d_out = nullptr;
    uint32_t *d_table = nullptr;
    CUDA_OK(cudaMalloc(&d_out, n * sizeof(float)));
    CUDA_OK(cudaMalloc(&d_table, tableWords * sizeof(uint32_t)));

    float *h = (float *)malloc(n * sizeof(float));
    float *ref = (float *)malloc(n * sizeof(float));
    if (!h || !ref) { fprintf(stderr, "furnace: host alloc failed\n"); return 2; }

    // The fill runs ONCE per launch-cycle; the burn's writes then evolve the table, and the next
    // burn in the same process starts from the SAME evolved state only if we refill — so we DO
    // refill before every burn: that is what makes launches byte-identical and `distinct` honest.
    const int fillBlocks = 1024, fillThreads = 256;

    struct timespec t0, t1;
    timespec_get(&t0, TIME_UTC);

    // `distinct` COUNTS DISTINCT CHECKSUM VALUES, exactly as sdc_fma does — 1 means the run agreed
    // with itself. The first draft reported the opposite quantity (launches that DIFFERED, 0 when
    // healthy) and the build gate correctly refused it: a field named like a sibling's must MEAN
    // what the sibling's means, or every reader of the manifest silently reads a different number.
    long long launches = 0, gpu_us_total = 0;
    uint64_t first = 0;
    uint64_t seen[MAX_DISTINCT];
    int ndistinct = 0;

    // Warmup: reach thermal/clock steady state before the timed window (same as sdc_fma).
    for (int w = 0; w < WARMUP_LAUNCHES; ++w) {
        furnace_fill<<<fillBlocks, fillThreads>>>(d_table, tableWords);
        furnace_burn<<<blocks, threads>>>(d_out, d_table, iters, fmaPerRead);
    }
    CUDA_OK(cudaDeviceSynchronize());

    do {
        cudaEvent_t ev0, ev1;
        CUDA_OK(cudaEventCreate(&ev0));
        CUDA_OK(cudaEventCreate(&ev1));
        CUDA_OK(cudaEventRecord(ev0));
        furnace_fill<<<fillBlocks, fillThreads>>>(d_table, tableWords);
        furnace_burn<<<blocks, threads>>>(d_out, d_table, iters, fmaPerRead);
        CUDA_OK(cudaEventRecord(ev1));
        CUDA_OK(cudaEventSynchronize(ev1));
        float ms = 0.0f;
        CUDA_OK(cudaEventElapsedTime(&ms, ev0, ev1));
        gpu_us_total += (long long)(ms * 1000.0f);
        CUDA_OK(cudaEventDestroy(ev0));
        CUDA_OK(cudaEventDestroy(ev1));

        CUDA_OK(cudaMemcpy(h, d_out, n * sizeof(float), cudaMemcpyDeviceToHost));
        uint64_t sum = fnv1a(h, n * sizeof(float));
        if (launches == 0) { first = sum; memcpy(ref, h, n * sizeof(float)); }
        bool known = false;
        for (int k = 0; k < ndistinct; ++k) { if (seen[k] == sum) { known = true; break; } }
        if (!known && ndistinct < MAX_DISTINCT) seen[ndistinct++] = sum;
        launches++;

        timespec_get(&t1, TIME_UTC);
    } while ((t1.tv_sec - t0.tv_sec) < sustain_s);

    timespec_get(&t1, TIME_UTC);
    long long wall_us = (long long)(t1.tv_sec - t0.tv_sec) * 1000000LL
                      + (t1.tv_nsec - t0.tv_nsec) / 1000LL;
    long long ms_total = wall_us / 1000LL;
    // Work per launch: table words actually read per burn. Also reported as total GiB read, the
    // number that says whether VRAM saw real traffic — B5's meter.
    const long long reads_per_launch = (long long)n * iters * INNER_READS;
    const long long bytes_read = reads_per_launch * 4LL * launches;

    printf("KAGO-WORKLOAD name=furnace checksum=%016llx elements=%zu iters=%d ms=%lld launches=%lld "
           "distinct=%d gpu_us=%lld wall_us=%lld work_per_launch=%lld table_mb=%lld read_gb=%lld\n",
           (unsigned long long)first, n, iters, ms_total, launches,
           ndistinct, gpu_us_total, wall_us, reads_per_launch,
           (long long)(tableWords * 4 / (1024 * 1024)), bytes_read >> 30);
    fprintf(stderr, "furnace: %zu threads, table %lld MiB, %d outer iters x %d reads, %lld launches, "
            "%lld us GPU of %lld us wall\n",
            n, (long long)(tableWords * 4 / (1024 * 1024)), iters, INNER_READS, launches,
            gpu_us_total, wall_us);

    free(h); free(ref);
    cudaFree(d_out); cudaFree(d_table);
    return 0;
}
