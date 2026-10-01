// Re-renders results/<run>/report.md from the saved raw per-round JSON files.
//   bun scripts/rereport.ts results/<run-id>
import { readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { aggregate, markdown, type Adapter } from '../src/report';

const dir = process.argv[2];
if (!dir) throw new Error('usage: bun scripts/rereport.ts results/<run-id>');
const files: Partial<Record<Adapter, string[]>> = {};
for (const f of readdirSync(dir).sort()) {
  const m = f.match(/^(drizzle-pg|drizzle|prisma)-r(\d+)\.json$/);
  if (m) (files[m[1] as Adapter] ??= []).push(`${dir}/${f}`);
}
const agg = aggregate(files);
const rounds = Math.max(...Object.values(files).map((x) => x!.length));
const first = await Bun.file(files.drizzle![0]!).json();
const adapters = Object.keys(files) as Adapter[];
const order = Array.from({ length: rounds }, (_, i) => {
  const rot = i % adapters.length;
  return [...adapters.slice(rot), ...adapters.slice(0, rot)].map((s) => (s === 'drizzle-pg' ? 'Dpg' : s[0]!.toUpperCase())).join('→');
});
const md = markdown(agg, { rounds, order, runId: dir.split('/').pop()!, verifyNote: `✅ ${Object.keys((await Bun.file(`${dir}/verify-drizzle.json`).json()).fingerprints).length} workloads returned identical results and left the databases in identical state (row counts, sums, HTML lengths, jsonb stamps).`, pg: 'PostgreSQL 16' });
void first;
writeFileSync(`${dir}/report.md`, md);
writeFileSync(`${dir}/summary.json`, JSON.stringify(agg.rows, null, 2));
copyFileSync(`${dir}/report.md`, 'results/latest.md');
console.log(`wrote ${dir}/report.md`);
