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
// Usage:  sdc_fma.exe [iterations] [blocks] [threads]
// Output: one machine-readable line, plus a human line on stderr.
//   KAGO-WORKLOAD name=sdc_fma checksum=<16 hex> elements=<n> iters=<n> ms=<n>
// Exit:   0 ran · 2 CUDA error (the CRASH half — the harness also reads the Windows event log)
//
// [TESTED: 2026-08-09 · built through toolchain.mjs and run 5x by `npm run workloads:build`:
//  exactly ONE distinct checksum, e27ec24a82d509d7, on an RTX 5070 Ti at stock, driver 610.88.
//  P1-AC1 satisfied. The checksum is recorded in workloads/MANIFEST.json next to the sha-256 of
//  this source, so a later run that differs is either a changed source or a corrupting card.]

#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <chrono>
#include <cuda_runtime.h>

// The FMA chain. Each thread walks its own dependent multiply-add chain, so the arithmetic units
// stay saturated and the result depends on EVERY step: a single flipped bit anywhere in the chain
// propagates to the output instead of being averaged away.
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

int main(int argc, char **argv) {
    const int iters   = (argc > 1) ? atoi(argv[1]) : 100000;
    const int blocks  = (argc > 2) ? atoi(argv[2]) : 256;
    const int threads = (argc > 3) ? atoi(argv[3]) : 256;
    const size_t n = (size_t)blocks * threads;

    float *d = nullptr;
    if (cudaMalloc(&d, n * sizeof(float)) != cudaSuccess) {
        fprintf(stderr, "sdc_fma: cudaMalloc failed for %zu elements\n", n);
        return 2;
    }

    const auto t0 = std::chrono::steady_clock::now();
    fma_chain<<<blocks, threads>>>(d, iters);
    const cudaError_t err = cudaDeviceSynchronize();
    const auto t1 = std::chrono::steady_clock::now();

    if (err != cudaSuccess) {
        // A CUDA error here is the CRASH half of the three-way verdict. It is reported on stdout in
        // the same machine-readable shape so the harness never has to parse two formats.
        printf("KAGO-WORKLOAD name=sdc_fma error=%s\n", cudaGetErrorString(err));
        cudaFree(d);
        return 2;
    }

    float *h = (float *)malloc(n * sizeof(float));
    if (!h) { cudaFree(d); return 2; }
    cudaMemcpy(h, d, n * sizeof(float), cudaMemcpyDeviceToHost);

    const uint64_t checksum = fnv1a(h, n * sizeof(float));
    const long long ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    printf("KAGO-WORKLOAD name=sdc_fma checksum=%016llx elements=%zu iters=%d ms=%lld\n",
           (unsigned long long)checksum, n, iters, ms);
    fprintf(stderr, "sdc_fma: %zu elements, %d iterations, %lld ms\n", n, iters, ms);

    free(h);
    cudaFree(d);
    return 0;
}
