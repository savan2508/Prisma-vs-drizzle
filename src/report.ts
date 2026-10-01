import { readFileSync } from 'node:fs';

export type Adapter = 'drizzle' | 'prisma' | 'drizzle-pg';
interface RunFile {
  meta: any;
  startup: Record<string, number>;
  state: Record<string, string>;
  results: { workload: string; group: string; lane: string; description: string; level: number; result: any }[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export interface Cell {
  opsPerSec: number; opsMin: number; opsMax: number; p50: number; p95: number; p99: number; max: number;
  cpuUsPerOp: number; rssPeakMb: number; errors: number; capped: boolean; rounds: number; firstError?: string;
}
export interface Row {
  workload: string; group: string; level: number; description: string;
  lanes: Partial<Record<Adapter, string>>;
  cells: Partial<Record<Adapter, Cell>>;
}

export function aggregate(files: Partial<Record<Adapter, string[]>>) {
  const adapters = (Object.keys(files) as Adapter[]).filter((a) => files[a]?.length);
  const runs = Object.fromEntries(adapters.map((a) => [a, files[a]!.map((f) => JSON.parse(readFileSync(f, 'utf8')) as RunFile)])) as Record<Adapter, RunFile[]>;

  const rows = new Map<string, Row>();
  for (const a of adapters) {
    const bucket = new Map<string, { meta: RunFile['results'][number]; cells: any[] }>();
    for (const run of runs[a]) {
      for (const r of run.results) {
        const key = `${r.workload}@${r.level}`;
        const b = bucket.get(key) ?? { meta: r, cells: [] };
        b.cells.push(r.result);
        bucket.set(key, b);
      }
    }
    for (const [key, { meta, cells }] of bucket) {
      const row: Row = rows.get(key) ?? { workload: meta.workload, group: meta.group, level: meta.level, description: meta.description, lanes: {}, cells: {} };
      row.lanes[a] = meta.lane;
      const ops = cells.map((c) => c.opsPerSec);
      row.cells[a] = {
        opsPerSec: median(ops), opsMin: Math.min(...ops), opsMax: Math.max(...ops),
        p50: median(cells.map((c) => c.latency.p50)), p95: median(cells.map((c) => c.latency.p95)), p99: median(cells.map((c) => c.latency.p99)),
        max: Math.max(...cells.map((c) => c.latency.max)),
        cpuUsPerOp: median(cells.map((c) => c.cpuUsPerOp)), rssPeakMb: Math.max(...cells.map((c) => c.rssPeakMb)),
        errors: cells.reduce((n, c) => n + c.errors, 0), capped: cells.some((c) => c.capped), firstError: cells.find((c) => c.firstError)?.firstError,
        rounds: cells.length,
      };
      rows.set(key, row);
    }
  }
  const list = [...rows.values()];
  const order = ['overhead', 'read', 'jsonb', 'search', 'html', 'write', 'tx', 'mixed'];
  list.sort((x, y) => order.indexOf(x.group) - order.indexOf(y.group) || x.workload.localeCompare(y.workload) || x.level - y.level);
  return { adapters, runs, rows: list };
}

const geomean = (xs: number[]) => (xs.length ? Math.exp(xs.reduce((n, x) => n + Math.log(x), 0) / xs.length) : NaN);
const fmt = (n: number | undefined, d = 0) => (n === undefined || Number.isNaN(n) ? '–' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const ms = (n: number | undefined) => (n === undefined ? '–' : n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : n.toFixed(0));

/** throughput ratio a ÷ b (>1 => a faster) */
const ratio = (r: Row, a: Adapter, b: Adapter) => {
  const x = r.cells[a], y = r.cells[b];
  return x && y && y.opsPerSec > 0 ? x.opsPerSec / y.opsPerSec : NaN;
};
/** per-round ranges overlap => the difference is within run-to-run noise */
const overlaps = (r: Row, a: Adapter, b: Adapter) => {
  const x = r.cells[a], y = r.cells[b];
  return !!x && !!y && x.rounds > 1 && y.rounds > 1 && Math.max(x.opsMin, y.opsMin) <= Math.min(x.opsMax, y.opsMax);
};
const isTie = (r: Row, a: Adapter, b: Adapter) => {
  const x = ratio(r, a, b);
  return Number.isNaN(x) || (x < 1.05 && x > 1 / 1.05) || overlaps(r, a, b);
};
const verdict = (r: Row, a: Adapter, b: Adapter, names: [string, string]) => {
  const x = ratio(r, a, b);
  if (Number.isNaN(x)) return '–';
  if (isTie(r, a, b)) return `tie (${overlaps(r, a, b) ? 'ranges overlap' : '±5%'})`;
  return x > 1 ? `${names[0]} ${x.toFixed(2)}×` : `${names[1]} ${(1 / x).toFixed(2)}×`;
};

export function markdown(agg: ReturnType<typeof aggregate>, extra: { rounds: number; order: string[]; runId: string; verifyNote: string; pg: string }) {
  const { runs, rows, adapters } = agg;
  const hasPg = adapters.includes('drizzle-pg');
  const m = runs.drizzle[0]!.meta, mp = runs.prisma[0]!.meta;
  const out: string[] = [];
  out.push(`# Drizzle (RC, Bun.SQL) vs Prisma 8 (RC, node-postgres) — results`);
  out.push('');
  out.push(`- **Run**: \`${extra.runId}\` · profile \`${m.profile}\` · ${extra.rounds} round(s) per ORM (median reported; run order rotated: ${extra.order.join(', ')})`);
  out.push(`- **Drizzle**: drizzle-orm ${m.versions['drizzle-orm']} on ${m.versions.driver}`);
  out.push(`- **Prisma**: @prisma/orm-postgres ${mp.versions['@prisma/orm-postgres']} on ${mp.versions.driver}`);
  out.push(`- **Host**: ${m.platform}, ${m.cpus} CPUs, Bun ${m.bun}, ${extra.pg}; pool size ${m.poolSize} for both clients`);
  out.push(`- **Data**: ${Object.entries(m.sizes).map(([k, v]) => `${k}=${(v as number).toLocaleString('en-US')}`).join(', ')}`);
  out.push(`- **Correctness gate**: ${extra.verifyNote}`);
  out.push('');
  out.push('> “Drizzle 2.00×” means Drizzle completed twice as many operations per second. A cell is called a **tie** when the ratio is within ±5% or when the per-round throughput ranges of the two ORMs overlap. Postgres runs on the same machine as the client, so they compete for CPU; read **CPU µs/op** as the client-side cost of ORM + driver.');
  out.push('');

  // ---- summary
  out.push('## Summary — geometric mean of throughput ratio (Drizzle ÷ Prisma, >1 = Drizzle faster)');
  out.push('');
  const levels = [...new Set(rows.map((r) => r.level))].sort((a, b) => a - b);
  const groups = [...new Set(rows.map((r) => r.group))];
  out.push(`| group | ${levels.map((l) => `c=${l}`).join(' | ')} |`);
  out.push(`|---|${levels.map(() => '---:').join('|')}|`);
  for (const g of groups) {
    const cells = levels.map((l) => fmtRatio(geomean(rows.filter((r) => r.group === g && r.level === l).map((r) => ratio(r, 'drizzle', 'prisma')).filter((x) => !Number.isNaN(x)))));
    out.push(`| ${g} | ${cells.join(' | ')} |`);
  }
  const all = rows.map((r) => ratio(r, 'drizzle', 'prisma')).filter((x) => !Number.isNaN(x));
  const dWins = rows.filter((r) => !isTie(r, 'drizzle', 'prisma') && ratio(r, 'drizzle', 'prisma') > 1).length;
  const pWins = rows.filter((r) => !isTie(r, 'drizzle', 'prisma') && ratio(r, 'drizzle', 'prisma') < 1).length;
  out.push('');
  out.push(`Overall geometric mean over ${all.length} (workload, concurrency) cells: ${fmtRatio(geomean(all))}. Cells won: Drizzle **${dWins}**, Prisma **${pWins}**, ties **${all.length - dWins - pWins}**.`);
  out.push('');

  // ---- driver isolation
  if (hasPg) {
    out.push('## Driver vs ORM (diagnostic)');
    out.push('');
    out.push('`Drizzle (pg)` is the *same Drizzle workload code* run over `node-postgres`, the driver Prisma 8 uses. Geometric-mean throughput ratios:');
    out.push('');
    out.push('| group | **driver effect**: Drizzle(Bun.SQL) ÷ Drizzle(pg) | **ORM effect**: Drizzle(pg) ÷ Prisma(pg) | **total**: Drizzle(Bun.SQL) ÷ Prisma |');
    out.push('|---|---:|---:|---:|');
    for (const g of groups) {
      const sel = rows.filter((r) => r.group === g);
      const f = (a: Adapter, b: Adapter) => fmtRatio(geomean(sel.map((r) => ratio(r, a, b)).filter((x) => !Number.isNaN(x))));
      out.push(`| ${g} | ${f('drizzle', 'drizzle-pg')} | ${f('drizzle-pg', 'prisma')} | ${f('drizzle', 'prisma')} |`);
    }
    const f = (a: Adapter, b: Adapter) => fmtRatio(geomean(rows.map((r) => ratio(r, a, b)).filter((x) => !Number.isNaN(x))));
    out.push(`| **all** | ${f('drizzle', 'drizzle-pg')} | ${f('drizzle-pg', 'prisma')} | ${f('drizzle', 'prisma')} |`);
    out.push('');
  }

  // ---- startup
  out.push('## Startup & footprint');
  out.push('');
  out.push(`| metric | Drizzle (Bun.SQL) | Prisma 8 |${hasPg ? ' Drizzle (pg) |' : ''}`);
  out.push(`|---|---:|---:|${hasPg ? '---:|' : ''}`);
  const su = (a: Adapter, k: string) => median(runs[a].map((r) => r.startup[k]!));
  for (const [label, k] of [['import ORM (ms)', 'importMs'], ['construct client (ms)', 'createMs'], ['first query incl. connect (ms)', 'firstQueryMs'], ['process start → ready (ms)', 'readyMs']] as const) {
    out.push(`| ${label} | ${fmt(su('drizzle', k))} | ${fmt(su('prisma', k))} |${hasPg ? ` ${fmt(su('drizzle-pg', k))} |` : ''}`);
  }
  const peak = (a: Adapter) => Math.max(...rows.map((r) => r.cells[a]?.rssPeakMb ?? 0));
  out.push(`| peak RSS across all workloads (MB) | ${fmt(peak('drizzle'))} | ${fmt(peak('prisma'))} |${hasPg ? ` ${fmt(peak('drizzle-pg'))} |` : ''}`);
  out.push('');

  // ---- per group
  for (const g of groups) {
    out.push(`## ${g}`);
    out.push('');
    out.push(`| workload | c | Drizzle ops/s | Prisma ops/s |${hasPg ? ' Drizzle(pg) ops/s |' : ''} verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |`);
    out.push(`|---|--:|--:|--:|${hasPg ? '--:|' : ''}---|--:|--:|--:|`);
    for (const r of rows.filter((x) => x.group === g)) {
      const d = r.cells.drizzle, p = r.cells.prisma;
      const flag = (c?: Cell) => (c ? (c.errors ? ` ⚠${c.errors}err` : '') + (c.capped ? ' ⏱capped' : '') : '');
      out.push(
        `| \`${r.workload}\` | ${r.level} | ${fmt(d?.opsPerSec)}${flag(d)} | ${fmt(p?.opsPerSec)}${flag(p)} |${hasPg ? ` ${fmt(r.cells['drizzle-pg']?.opsPerSec)} |` : ''} ${verdict(r, 'drizzle', 'prisma', ['Drizzle', 'Prisma'])} | ${ms(d?.p50)} / ${ms(p?.p50)} | ${ms(d?.p99)} / ${ms(p?.p99)} | ${fmt(d?.cpuUsPerOp)} / ${fmt(p?.cpuUsPerOp)} |`,
      );
    }
    out.push('');
  }

  // ---- lanes
  out.push('## How each workload was expressed');
  out.push('');
  out.push('| workload | what it does | Drizzle | Prisma 8 |');
  out.push('|---|---|---|---|');
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.workload)) continue;
    seen.add(r.workload);
    out.push(`| \`${r.workload}\` | ${r.description} | ${r.lanes.drizzle ?? ''} | ${r.lanes.prisma ?? ''} |`);
  }
  out.push('');
  const errs = rows.flatMap((r) => adapters.map((a) => (r.cells[a]?.errors ? `${r.workload}@${r.level} ${a}: ${r.cells[a]!.errors} errors (${r.cells[a]!.firstError})` : ''))).filter(Boolean);
  if (errs.length) { out.push('## Errors'); out.push(''); errs.forEach((e) => out.push(`- ${e}`)); out.push(''); }

  out.push('## Post-run integrity');
  out.push('');
  out.push('Transfer transactions must conserve the total of all account balances (no lost updates under contention):');
  out.push('');
  out.push('| ORM | round | sum(balance_cents) | rows in events | rows in transfers |');
  out.push('|---|--:|--:|--:|--:|');
  for (const a of adapters) runs[a].forEach((r, i) => out.push(`| ${a} | ${i + 1} | ${r.state['sum_balance']} | ${r.state['events']} | ${r.state['transfers']} |`));
  out.push('');
  return out.join('\n');
}

function fmtRatio(x: number) {
  return Number.isNaN(x) ? '–' : x >= 1 ? `**${x.toFixed(2)}×**` : `${(1 / x).toFixed(2)}× slower`;
}
