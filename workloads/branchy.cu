// workloads/branchy.cu — the CRASH-prone shape: control-heavy, divergent, irregular memory.
//
// WHY THIS SHAPE EXISTS (researches/02 §2): the same measurement that found 37 of 57 programs
// SDC-prone found the other 20 CRASH-prone, and the split is not random — control-heavy code with
// irregular memory access CRASHES, while fixed-loop arithmetic corrupts silently. A harness that
// runs only the arithmetic shape tests only half the failure space, and it is the half that never
// reaches the Windows event log.
//
// So this program is written to be nasty in the specific ways real engines are nasty:
//   - WARP DIVERGENCE: neighbouring threads take different branches every iteration, so the
//     scheduler cannot coalesce them and the control path itself becomes the load;
//   - POINTER CHASE: each step's address depends on the previous step's VALUE, which defeats
//     prefetching and keeps the memory subsystem waiting on dependent loads — the pattern that
//     stresses the parts an undervolt destabilises first;
//   - NO shared-memory staging, on purpose: the point is irregular global traffic.
//
// It is ALSO checksummed. That is not redundancy with sdc_fma: a crash-prone workload that happens
// to survive can still have corrupted its output, and "it didn't crash" is not a stability result
// (researches/02 §2.1). The two shapes differ in what they PROVOKE, not in how they are judged.
//
// Determinism: the chase is seeded from the thread index only, the walk is integer arithmetic, and
// every thread writes its own slot. No atomics, no float reassociation, no timing dependence.
//
// SUSTAINED MODE (`--sustain <seconds>`), added 2026-08-10 for plans/03 §4.3 — the same change as
// sdc_fma.cu, for the same reasons, which are written out in full in that file's header: one run
// used to be one PROCESS and the process dominated (132 ms per launch against a 0–1 ms kernel,
// 8 % utilization), and the resulting work-per-second number is not a convenience but the ONLY
// detector of clock stretching and memory error replay (researches/04 §2). The duration is a FLAG,
// never a positional, so the default invocation still runs the code path that produced the checksum
// in workloads/MANIFEST.json.
//
// Usage:  branchy.exe [steps] [blocks] [threads] [--sustain <seconds>]
// Output: KAGO-WORKLOAD name=branchy checksum=<16 hex> elements=<n> steps=<n> ms=<n> launches=<n>
//         distinct=<n> gpu_us=<n> wall_us=<n> work_per_launch=<n>   (durations: integer microseconds)
// Exit:   0 ran · 2 CUDA error
//
// [TESTED: 2026-08-09 · built through toolchain.mjs and run 5x by `npm run workloads:build`:
//  exactly ONE distinct checksum, 67e95c85bb6299a2, on an RTX 5070 Ti at stock, driver 610.88.
//  P1-AC1 satisfied. Divergence and the pointer chase are deterministic BECAUSE the table is built
//  on the host from a fixed xorshift seed — a table filled on the GPU would be produced by the very
//  hardware under test, and its corruption would look like ours.]
// [TESTED: 2026-08-10 · rebuilt by `npm run workloads:build`; the five determinism runs still give
//  67e95c85bb6299a2, so the edit is behaviour-preserving. `--sustain 12` → 466 launches, distinct=1,
//  gpu_us=11822909 of wall_us=12005410 = 98.5 % duty. Sampled by a separate `npm run mon`:
//  **utilization 97 % (max 99), power 194.8 W, clock 2887 MHz, 60 °C, fan 31** — against 8 % / 61.7 W
//  for the spawn-per-run shape. THIS is the saturating load; sdc_fma pays 43 % of its wall time to
//  hashing every launch and reaches 57 %.
//  A FINDING FOR PHASE 2 THAT FALLS OUT OF THIS: saturated, the card draws 194.8 W against a 300 W
//  limit — so a 250 W power limit cannot bite on this workload, and Silent Cold's power reduction
//  will have to come from the clock lock rather than from `-pl`.]

#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <chrono>
#include <cuda_runtime.h>

// A table the threads walk irregularly. Its size is a prime-ish stride target so the walk does not
// settle into a short cycle for most seeds.
#define TABLE_ELEMS 1048573u   // a prime just below 2^20

static const int WARMUP_LAUNCHES = 10;   // untimed; see sdc_fma.cu for why the timed window excludes them
static const int MAX_DISTINCT = 8;       // we only need to know whether the count is 1

// CUDA error strings contain spaces, and the harness splits the KAGO-WORKLOAD line on whitespace.
static void no_spaces(char *dst, size_t cap, const char *src) {
    size_t i = 0;
    for (; src[i] && i + 1 < cap; ++i) dst[i] = (src[i] == ' ') ? '_' : src[i];
    dst[i] = '\0';
}

__global__ void chase_and_branch(uint32_t *out, const uint32_t *table, int steps) {
    const unsigned i = blockIdx.x * blockDim.x + threadIdx.x;
    uint32_t x = 2166136261u ^ (i * 16777619u);
    uint32_t idx = x % TABLE_ELEMS;
    uint32_t acc = i;

    for (int k = 0; k < steps; ++k) {
        // The dependent load: the NEXT address comes from THIS value, so nothing can be prefetched.
        const uint32_t v = table[idx];

        // Divergence on purpose: adjacent threads take different arms nearly every iteration,
        // because the arm is chosen from a value that differs per thread.
        if ((v & 3u) == 0u) {
            acc = acc * 31u + (v >> 3);
        } else if ((v & 3u) == 1u) {
            acc ^= (v << 7) | (acc >> 25);
        } else if ((v & 3u) == 2u) {
            acc = (acc + v) ^ (acc >> 11);
        } else {
            // A short inner loop only some threads run: the warp waits for its slowest arm.
            for (int j = 0; j < 4; ++j) acc = acc * 1664525u + 1013904223u + (v & 0xFFu);
        }

        idx = (v ^ acc) % TABLE_ELEMS;
    }
    out[i] = acc;
}

static uint64_t fnv1a(const void *data, size_t bytes) {
    uint64_t hash = 1469598103934665603ULL;
    const unsigned char *p = (const unsigned char *)data;
    for (size_t b = 0; b < bytes; ++b) { hash ^= p[b]; hash *= 1099511628211ULL; }
    return hash;
}

int main(int argc, char **argv) {
    // Flags and positionals kept apart; positionals 0..2 keep their old meaning exactly.
    int sustain_s = 0;
    int pos[3] = { 20000, 256, 256 };
    int npos = 0;
    for (int a = 1; a < argc; ++a) {
        if (strcmp(argv[a], "--sustain") == 0 && a + 1 < argc) { sustain_s = atoi(argv[++a]); continue; }
        if (npos < 3) pos[npos++] = atoi(argv[a]);
    }
    const int steps   = pos[0];
    const int blocks  = pos[1];
    const int threads = pos[2];
    const size_t n = (size_t)blocks * threads;

    // Build the table on the host so its contents are identical on every run and every machine —
    // a table filled on the GPU would be produced by the very hardware under test.
    uint32_t *htable = (uint32_t *)malloc(TABLE_ELEMS * sizeof(uint32_t));
    if (!htable) return 2;
    uint32_t s = 123456789u;
    for (uint32_t k = 0; k < TABLE_ELEMS; ++k) {
        s ^= s << 13; s ^= s >> 17; s ^= s << 5;   // xorshift32: reproducible, no library RNG
        htable[k] = s;
    }

    uint32_t *dtable = nullptr, *dout = nullptr;
    if (cudaMalloc(&dtable, TABLE_ELEMS * sizeof(uint32_t)) != cudaSuccess ||
        cudaMalloc(&dout, n * sizeof(uint32_t)) != cudaSuccess) {
        fprintf(stderr, "branchy: cudaMalloc failed\n");
        free(htable);
        return 2;
    }
    cudaMemcpy(dtable, htable, TABLE_ELEMS * sizeof(uint32_t), cudaMemcpyHostToDevice);

    uint32_t *hout = (uint32_t *)malloc(n * sizeof(uint32_t));
    if (!hout) { cudaFree(dtable); cudaFree(dout); free(htable); return 2; }

    cudaEvent_t ev0, ev1;
    cudaEventCreate(&ev0);
    cudaEventCreate(&ev1);
    char errbuf[256];

    // Warm-up only in sustained mode — the default path stays the one-launch program whose checksum
    // the manifest records, and `npm run workloads:build` runs it five times.
    if (sustain_s > 0) {
        for (int w = 0; w < WARMUP_LAUNCHES; ++w) chase_and_branch<<<blocks, threads>>>(dout, dtable, steps);
        const cudaError_t werr = cudaDeviceSynchronize();
        if (werr != cudaSuccess) {
            no_spaces(errbuf, sizeof(errbuf), cudaGetErrorString(werr));
            printf("KAGO-WORKLOAD name=branchy error=%s\n", errbuf);
            free(hout); free(htable); cudaFree(dtable); cudaFree(dout);
            return 2;
        }
    }

    long long launches = 0;
    long long gpu_us = 0;
    uint64_t first = 0;
    uint64_t seen[MAX_DISTINCT];
    int ndistinct = 0;

    const auto t0 = std::chrono::steady_clock::now();
    for (;;) {
        cudaEventRecord(ev0);
        chase_and_branch<<<blocks, threads>>>(dout, dtable, steps);
        cudaEventRecord(ev1);
        const cudaError_t err = cudaDeviceSynchronize();

        if (err != cudaSuccess) {
            no_spaces(errbuf, sizeof(errbuf), cudaGetErrorString(err));
            printf("KAGO-WORKLOAD name=branchy error=%s launches=%lld\n", errbuf, launches);
            free(hout); free(htable); cudaFree(dtable); cudaFree(dout);
            return 2;
        }

        float kernel_ms = 0.0f;
        cudaEventElapsedTime(&kernel_ms, ev0, ev1);
        gpu_us += (long long)(kernel_ms * 1000.0f + 0.5f);

        // Hashed every launch: the kernel overwrites the whole buffer, so a final-only hash would
        // hide a corruption that happened earlier in the run.
        cudaMemcpy(hout, dout, n * sizeof(uint32_t), cudaMemcpyDeviceToHost);
        const uint64_t c = fnv1a(hout, n * sizeof(uint32_t));
        if (launches == 0) first = c;
        bool known = false;
        for (int k = 0; k < ndistinct; ++k) { if (seen[k] == c) { known = true; break; } }
        if (!known && ndistinct < MAX_DISTINCT) seen[ndistinct++] = c;
        launches++;

        if (sustain_s <= 0) break;
        const long long elapsed_us =
            std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - t0).count();
        if (elapsed_us >= (long long)sustain_s * 1000000LL) break;
    }
    const auto t1 = std::chrono::steady_clock::now();

    const long long wall_us = std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count();
    const long long ms = wall_us / 1000;
    const long long work_per_launch = (long long)n * (long long)steps;

    printf("KAGO-WORKLOAD name=branchy checksum=%016llx elements=%zu steps=%d ms=%lld "
           "launches=%lld distinct=%d gpu_us=%lld wall_us=%lld work_per_launch=%lld\n",
           (unsigned long long)first, n, steps, ms,
           launches, ndistinct, gpu_us, wall_us, work_per_launch);
    fprintf(stderr, "branchy: %zu threads, %d steps, %lld launches, %lld us on the GPU of %lld us wall\n",
            n, steps, launches, gpu_us, wall_us);

    cudaEventDestroy(ev0);
    cudaEventDestroy(ev1);
    free(hout); free(htable);
    cudaFree(dtable); cudaFree(dout);
    return 0;
}
