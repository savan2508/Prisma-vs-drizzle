// Orchestrator: verifies schema + result parity, then runs both ORMs in isolated processes,
// alternating order across rounds, resetting both databases from the seed snapshot each time.
//   bun src/run-all.ts --profile quick --rounds 3
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { SQL } from 'bun';
import { env } from './config';
import { aggregate, markdown, type Adapter } from './report';

const { values: a } = parseArgs({
  options: {
    profile: { type: 'string', default: 'standard' },
    rounds: { type: 'string', default: '3' },
    only: { type: 'string' },
    pool: { type: 'string' },
    levels: { type: 'string' },
    'skip-verify': { type: 'boolean', default: false },
    'with-pg-diagnostic': { type: 'boolean', default: false },
    name: { type: 'string' },
  },
});
const rounds = Number(a.rounds);
const runId = a.name ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = `results/${runId}`;
mkdirSync(dir, { recursive: true });

const sh = async (cmd: string[], opts: { quiet?: boolean } = {}) => {
  const p = Bun.spawn(cmd, { stdout: opts.quiet ? 'pipe' : 'inherit', stderr: 'inherit', env: process.env });
  const code = await p.exited;
  if (code !== 0) throw new Error(`${cmd.join(' ')} exited ${code}`);
};
const adapters: Adapter[] = a['with-pg-diagnostic'] ? ['drizzle', 'prisma', 'drizzle-pg'] : ['drizzle', 'prisma'];
const benchArgs = (adapter: Adapter, out: string, extra: string[] = []) => [
  'bun', 'src/bench.ts', '--adapter', adapter, '--profile', a.profile!, '--out', out,
  ...(a.only ? ['--only', a.only] : []), ...(a.pool ? ['--pool', a.pool] : []), ...(a.levels ? ['--levels', a.levels] : []), ...extra,
];

console.log(`\n=== run ${runId}: profile=${a.profile} rounds=${rounds} ===`);
console.log('\n--- 1/3 schema parity');
await sh(['bun', 'scripts/verify-schema.ts']);

let verifyNote = 'skipped (--skip-verify)';
if (!a['skip-verify']) {
  console.log('\n--- 2/3 result parity (deterministic sequential pass, both ORMs, fresh DBs)');
  await sh(['bun', 'scripts/reset-dbs.ts']);
  for (const ad of adapters) {
    await sh(['bun', 'scripts/reset-dbs.ts']);
    await sh(benchArgs(ad, `${dir}/verify-${ad}.json`, ['--verify']));
  }
  const ref = await Bun.file(`${dir}/verify-drizzle.json`).json();
  const bad: string[] = [];
  for (const ad of adapters.slice(1)) {
    const other = await Bun.file(`${dir}/verify-${ad}.json`).json();
    for (const k of Object.keys(ref.fingerprints)) if (JSON.stringify(ref.fingerprints[k]) !== JSON.stringify(other.fingerprints[k])) bad.push(`${ad} ${k}: drizzle=${JSON.stringify(ref.fingerprints[k])} ${ad}=${JSON.stringify(other.fingerprints[k])}`);
    for (const k of Object.keys(ref.state)) if (ref.state[k] !== other.state[k]) bad.push(`DB state ${k}: drizzle=${ref.state[k]} ${ad}=${other.state[k]}`);
  }
  const d = ref;
  if (bad.length) {
    console.error('\nPARITY FAILURE — the ORMs do not perform equivalent work:\n  ' + bad.join('\n  '));
    process.exit(2);
  }
  verifyNote = `✅ ${Object.keys(d.fingerprints).length} workloads returned identical results and left both databases in identical state (row counts, sums, HTML lengths, jsonb stamps).`;
  console.log(`parity OK (${Object.keys(d.fingerprints).length} workloads)`);
}

console.log('\n--- 3/3 benchmark');
const files: Partial<Record<Adapter, string[]>> = Object.fromEntries(adapters.map((x) => [x, [] as string[]]));
const order: string[] = [];
for (let r = 1; r <= rounds; r++) {
  const rot = (r - 1) % adapters.length;
  const seq: Adapter[] = [...adapters.slice(rot), ...adapters.slice(0, rot)];
  order.push(seq.map((s) => (s === 'drizzle-pg' ? 'Dpg' : s[0]!.toUpperCase())).join('→'));
  for (const adapter of seq) {
    console.log(`\n>>> round ${r}/${rounds}: ${adapter}`);
    await sh(['bun', 'scripts/reset-dbs.ts']);
    const out = `${dir}/${adapter}-r${r}.json`;
    await sh(benchArgs(adapter, out));
    files[adapter]!.push(out);
  }
}

const admin = new SQL({ url: env.adminUrl, max: 1 });
const [{ v }] = await admin`SELECT version() AS v`;
await admin.close();
const agg = aggregate(files);
const md = markdown(agg, { rounds, order, runId, verifyNote, pg: String(v).split(' on ')[0]! });
writeFileSync(`${dir}/report.md`, md);
writeFileSync(`${dir}/summary.json`, JSON.stringify(agg.rows, null, 2));
copyFileSync(`${dir}/report.md`, 'results/latest.md');
console.log(`\nreport: ${dir}/report.md (also results/latest.md)`);
