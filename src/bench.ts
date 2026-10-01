// Runs ONE adapter (drizzle | prisma) in its own process so neither ORM's code, pool or
// memory can influence the other. Invoked by src/run-all.ts; usable standalone:
//   bun src/bench.ts --adapter prisma --profile quick --out results/x.json [--only regex] [--verify]
import { SQL } from 'bun';
import { parseArgs } from 'node:util';
import { env, profiles } from './config';
import { Rng, hashSeed } from './data/rng';
import { runLoad, type LoadResult } from './harness/runner';
import { catalog, mixedWeights, workloadNames, type Ctx, type Impl, type WorkloadName } from './workloads/catalog';

const { values: args } = parseArgs({
  options: {
    adapter: { type: 'string' },
    profile: { type: 'string', default: 'quick' },
    out: { type: 'string' },
    only: { type: 'string' },
    levels: { type: 'string' },
    verify: { type: 'boolean', default: false },
    pool: { type: 'string' },
  },
});
const adapter = args.adapter as 'drizzle' | 'prisma' | 'drizzle-pg';
if (adapter !== 'drizzle' && adapter !== 'prisma' && adapter !== 'drizzle-pg') throw new Error('--adapter drizzle|prisma|drizzle-pg');
const profile = profiles[args.profile!]!;
if (!profile) throw new Error(`unknown profile ${args.profile}`);
const poolSize = Number(args.pool ?? env.poolSize);
const url = adapter === 'prisma' ? env.prismaUrl : env.drizzleUrl;
const only = args.only ? new RegExp(args.only) : undefined;
const levels = args.levels ? args.levels.split(',').map(Number) : profile.levels;

async function digest(): Promise<Record<string, number | string>> {
  const db = new SQL({ url, max: 1 });
  const [r] = await db.unsafe(`
    SELECT
      (SELECT count(*) FROM users)::text AS users, (SELECT count(*) FROM products)::text AS products,
      (SELECT count(*) FROM orders)::text AS orders, (SELECT count(*) FROM order_items)::text AS order_items,
      (SELECT count(*) FROM documents)::text AS documents, (SELECT count(*) FROM events)::text AS events,
      (SELECT count(*) FROM transfers)::text AS transfers,
      (SELECT sum(stock) FROM products)::text AS sum_stock, (SELECT sum(price_cents) FROM products)::text AS sum_price,
      (SELECT sum(balance_cents) FROM accounts)::text AS sum_balance, (SELECT sum(version) FROM accounts)::text AS sum_version,
      (SELECT sum(total_cents) FROM orders)::text AS sum_order_total,
      (SELECT sum(length(html)) FROM documents)::text AS sum_html_len,
      (SELECT sum(((payload->'flags'->>'stamp')::int)) FROM events)::text AS sum_stamp`);
  await db.close();
  return { ...r };
}

const bootMs = performance.now(); // ~ time from process start until main module body runs
const tImport = performance.now();
const { createImpl, lanes, versions } =
  adapter === 'prisma'
    ? await import('./prisma/workloads').then((m) => ({ createImpl: m.createPrismaImpl, lanes: m.lanes, versions: { '@prisma/orm-postgres': pkg('@prisma/orm-postgres'), driver: `pg ${pkg('pg')} (node-postgres)` } }))
    : await import('./drizzle/workloads').then((m) => ({
        createImpl: (u: string, n: number) => m.createDrizzleImpl(u, n, adapter === 'drizzle' ? 'bun' : 'pg'),
        lanes: m.lanes,
        versions: { 'drizzle-orm': pkg('drizzle-orm'), driver: adapter === 'drizzle' ? `bun ${Bun.version} (Bun.SQL)` : `pg ${pkg('pg')} (node-postgres)` },
      }));
const importMs = performance.now() - tImport;

function pkg(name: string): string {
  return JSON.parse(require('node:fs').readFileSync(`${process.cwd()}/node_modules/${name}/package.json`, 'utf8')).version;
}

const tCreate = performance.now();
const { impl, close } = (await createImpl(url, poolSize)) as { impl: Impl; close: () => Promise<unknown> | unknown };
const createMs = performance.now() - tCreate;

const tag = args.verify ? 'verify' : Math.random().toString(36).slice(2, 8);
let seqN = 0;
const ctx: Ctx = { sizes: profile.sizes, seq: () => ++seqN, tag };

const tFirst = performance.now();
await impl['read.pk']({ id: 1 });
const firstQueryMs = performance.now() - tFirst;
const readyMs = performance.now();

type Row = { workload: string; group: string; lane: string; description: string; level: number; result: LoadResult };
const results: Row[] = [];
const fingerprints: Record<string, number[]> = {};

const call = (name: WorkloadName, p: any) => (impl[name] as (p: unknown) => Promise<number>)(p);

if (args.verify) {
  // Sequential, deterministic, identical parameter streams for both adapters.
  for (const name of workloadNames) {
    if (only && !only.test(name)) continue;
    const rng = new Rng(hashSeed(name, 'verify'));
    seqN = 0;
    fingerprints[name] = [];
    for (let i = 0; i < 6; i++) {
      try {
        fingerprints[name]!.push(await call(name, catalog[name].params(rng, ctx)));
      } catch (e) {
        fingerprints[name]!.push(-1);
        console.error(`[verify ${adapter}] ${name} failed:`, e instanceof Error ? e.message : e);
      }
    }
  }
} else {
  const plan: { name: string; ops: number; maxConc: number; op: (rng: Rng) => Promise<number> }[] = [];
  for (const name of workloadNames) {
    if (only && !only.test(name)) continue;
    const m = catalog[name];
    plan.push({ name, ops: m.ops, maxConc: m.maxConc, op: (rng) => call(name, m.params(rng, ctx)) });
  }
  if (!only || only.test('mixed.oltp')) {
    const total = mixedWeights.reduce((n, [, w]) => n + w, 0);
    plan.push({
      name: 'mixed.oltp', ops: 1, maxConc: 200,
      op: (rng) => {
        let x = rng.next() * total;
        for (const [n, w] of mixedWeights) if ((x -= w) < 0) return call(n, catalog[n].params(rng, ctx));
        const [n] = mixedWeights[0]!;
        return call(n, catalog[n].params(rng, ctx));
      },
    });
  }

  for (const w of plan) {
    const seen = new Set<number>();
    for (const lvl of levels) {
      const c = Math.min(lvl, w.maxConc);
      if (seen.has(c)) continue;
      seen.add(c);
      const rngs = Array.from({ length: c }, (_, i) => new Rng(hashSeed(w.name, c, i)));
      const totalOps = Math.max(c * 3, 20, Math.round(profile.baseOps * w.ops));
      const result = await runLoad({
        concurrency: c, totalOps, warmupOps: Math.max(c, Math.min(profile.warmupOps, Math.round(totalOps / 5))), maxSeconds: profile.maxSeconds,
        op: (worker) => w.op(rngs[worker]!),
      });
      const meta = (catalog as Record<string, { group: string; description: string }>)[w.name];
      results.push({
        workload: w.name, group: meta?.group ?? 'mixed',
        lane: (lanes as Record<string, string>)[w.name] ?? 'blend of the above',
        description: meta?.description ?? `Weighted OLTP blend: ${mixedWeights.map(([n, x]) => `${x}% ${n}`).join(', ')}`,
        level: c, result,
      });
      const l = result.latency;
      console.log(
        `[${adapter}] ${w.name.padEnd(24)} c=${String(c).padStart(3)} ${result.opsPerSec.toFixed(0).padStart(7)} ops/s  p50=${l.p50.toFixed(2)}ms p99=${l.p99.toFixed(2)}ms` +
          `  cpu=${(result.cpuUtil * 100).toFixed(0)}%${result.errors ? `  ERRORS=${result.errors} (${result.firstError})` : ''}${result.capped ? '  CAPPED' : ''}`,
      );
    }
  }
}

const state = await digest();
await close();

const out = {
  meta: {
    adapter, profile: profile.name, poolSize, sizes: profile.sizes, levels, verify: args.verify,
    date: new Date().toISOString(), bun: Bun.version, platform: `${process.platform}/${process.arch}`,
    cpus: require('node:os').cpus().length, versions,
  },
  startup: { bootMs, importMs, createMs, firstQueryMs, readyMs },
  state,
  fingerprints,
  results,
};
if (args.out) await Bun.write(args.out, JSON.stringify(out, null, 2));
console.log(`[${adapter}] done. startup: import ${importMs.toFixed(0)}ms, client ${createMs.toFixed(0)}ms, first query ${firstQueryMs.toFixed(0)}ms`);
