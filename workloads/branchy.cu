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
// Usage:  branchy.exe [steps] [blocks] [threads]
// Output: KAGO-WORKLOAD name=branchy checksum=<16 hex> elements=<n> steps=<n> ms=<n>
// Exit:   0 ran · 2 CUDA error
//
// [TESTED: 2026-08-09 · built through toolchain.mjs and run 5x by `npm run workloads:build`:
//  exactly ONE distinct checksum, 67e95c85bb6299a2, on an RTX 5070 Ti at stock, driver 610.88.
//  P1-AC1 satisfied. Divergence and the pointer chase are deterministic BECAUSE the table is built
//  on the host from a fixed xorshift seed — a table filled on the GPU would be produced by the very
//  hardware under test, and its corruption would look like ours.]

#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <chrono>
#include <cuda_runtime.h>

// A table the threads walk irregularly. Its size is a prime-ish stride target so the walk does not
// settle into a short cycle for most seeds.
#define TABLE_ELEMS 1048573u   // a prime just below 2^20

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
    const int steps   = (argc > 1) ? atoi(argv[1]) : 20000;
    const int blocks  = (argc > 2) ? atoi(argv[2]) : 256;
    const int threads = (argc > 3) ? atoi(argv[3]) : 256;
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

    const auto t0 = std::chrono::steady_clock::now();
    chase_and_branch<<<blocks, threads>>>(dout, dtable, steps);
    const cudaError_t err = cudaDeviceSynchronize();
    const auto t1 = std::chrono::steady_clock::now();

    if (err != cudaSuccess) {
        printf("KAGO-WORKLOAD name=branchy error=%s\n", cudaGetErrorString(err));
        cudaFree(dtable); cudaFree(dout); free(htable);
        return 2;
    }

    uint32_t *hout = (uint32_t *)malloc(n * sizeof(uint32_t));
    if (!hout) { cudaFree(dtable); cudaFree(dout); free(htable); return 2; }
    cudaMemcpy(hout, dout, n * sizeof(uint32_t), cudaMemcpyDeviceToHost);

    const uint64_t checksum = fnv1a(hout, n * sizeof(uint32_t));
    const long long ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    printf("KAGO-WORKLOAD name=branchy checksum=%016llx elements=%zu steps=%d ms=%lld\n",
           (unsigned long long)checksum, n, steps, ms);
    fprintf(stderr, "branchy: %zu threads, %d steps, %lld ms\n", n, steps, ms);

    free(hout); free(htable);
    cudaFree(dtable); cudaFree(dout);
    return 0;
}
