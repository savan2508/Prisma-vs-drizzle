export interface LatencyStats {
  count: number;
  min: number;
  mean: number;
  stddev: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
  max: number;
}

/** Exact percentiles (we keep every sample; ops counts are small enough). Values in ms. */
export function summarize(samples: Float64Array): LatencyStats {
  const n = samples.length;
  if (n === 0) return { count: 0, min: 0, mean: 0, stddev: 0, p50: 0, p90: 0, p95: 0, p99: 0, p999: 0, max: 0 };
  const sorted = Float64Array.from(samples).sort();
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i]!;
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (sorted[i]! - mean) ** 2;
  const pct = (p: number) => sorted[Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))]!;
  return {
    count: n,
    min: sorted[0]!,
    mean,
    stddev: Math.sqrt(sq / n),
    p50: pct(50),
    p90: pct(90),
    p95: pct(95),
    p99: pct(99),
    p999: pct(99.9),
    max: sorted[n - 1]!,
  };
}
