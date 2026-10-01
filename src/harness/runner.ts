import { summarize, type LatencyStats } from './stats';

export interface LoadOptions {
  concurrency: number;
  totalOps: number;
  warmupOps: number;
  maxSeconds: number;
  /** One logical operation. `worker` is stable per concurrent lane, `iter` is global per phase. */
  op: (worker: number, iter: number) => Promise<number>;
}

export interface LoadResult {
  concurrency: number;
  ops: number;
  errors: number;
  firstError?: string;
  /** true when maxSeconds cut the run short */
  capped: boolean;
  wallMs: number;
  opsPerSec: number;
  latency: LatencyStats;
  /** client-process CPU (user+system) per operation, in microseconds */
  cpuUsPerOp: number;
  /** client-process CPU utilisation relative to wall time (1.0 = one core) */
  cpuUtil: number;
  rssPeakMb: number;
  rssDeltaMb: number;
  /** total of the numbers returned by op() (rows/bytes) -- sanity signal only */
  checksum: number;
}

async function phase(opts: LoadOptions, total: number, record: boolean, deadline: number) {
  const lat = new Float64Array(record ? total : 0);
  let next = 0;
  let done = 0;
  let errors = 0;
  let firstError: string | undefined;
  let checksum = 0;
  let capped = false;
  const lanes = Math.min(opts.concurrency, total);
  const worker = async (w: number) => {
    for (;;) {
      if (performance.now() > deadline) {
        capped = true;
        return;
      }
      const i = next++;
      if (i >= total) return;
      const t0 = performance.now();
      try {
        checksum += await opts.op(w, i);
        if (record) lat[done] = performance.now() - t0;
        done++;
      } catch (e) {
        errors++;
        firstError ??= e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, (_, w) => worker(w)));
  return { lat: lat.subarray(0, record ? done : 0), done, errors, firstError, checksum, capped };
}

export async function runLoad(opts: LoadOptions): Promise<LoadResult> {
  if (opts.warmupOps > 0) await phase(opts, opts.warmupOps, false, performance.now() + opts.maxSeconds * 1000);
  Bun.gc(true);

  const rss0 = process.memoryUsage().rss;
  let rssPeak = rss0;
  const sampler = setInterval(() => {
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
  }, 25);
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  const r = await phase(opts, opts.totalOps, true, t0 + opts.maxSeconds * 1000);
  const wallMs = performance.now() - t0;
  const cpu = process.cpuUsage(cpu0);
  clearInterval(sampler);
  rssPeak = Math.max(rssPeak, process.memoryUsage().rss);

  const cpuUs = cpu.user + cpu.system;
  return {
    concurrency: opts.concurrency,
    ops: r.done,
    errors: r.errors,
    firstError: r.firstError,
    capped: r.capped,
    wallMs,
    opsPerSec: r.done / (wallMs / 1000),
    latency: summarize(r.lat),
    cpuUsPerOp: r.done ? cpuUs / r.done : 0,
    cpuUtil: cpuUs / 1000 / wallMs,
    rssPeakMb: rssPeak / 1048576,
    rssDeltaMb: (rssPeak - rss0) / 1048576,
    checksum: r.checksum,
  };
}
