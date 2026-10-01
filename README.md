# Prisma vs Drizzle — Postgres stress benchmark on Bun

A reproducible stress/performance comparison of

| | ORM | Driver |
|---|---|---|
| **Drizzle** | `drizzle-orm@1.0.0-rc.4` (the `rc` dist-tag) | Bun's native Postgres client, `Bun.SQL` (`drizzle-orm/bun-sql`) |
| **Prisma** | Prisma ORM 8 RC — `prisma@8.0.0-rc.19`, `@prisma/orm-postgres@8.0.0-rc.14` | `node-postgres` (`pg@8.22`), Prisma 8's own Postgres driver, wrapped by `@prisma/orm-postgres/runtime` |

on **PostgreSQL 16**, with **Bun** as the runtime. It covers point reads, indexed range/sort/pagination,
nested relation loading, aggregates, 5 MB / 20 000-row reads, single/bulk/100 KB **JSONB** inserts,
**GIN** containment and path queries, jsonb updates, **full-text search**, **HTML documents** (20–60 KB
rows: insert / fetch / rewrite / search), upserts, bulk writes, and **interactive transactions**
(including a hot-row lock contention test and a rollback path), plus a mixed OLTP blend — each at several
concurrency levels, with latency percentiles, throughput, client CPU per operation and memory.

> **Prisma 8 is a ground-up rebuild** (no Rust query engine, no `schema.prisma`/`@prisma/client`
> generator). It uses a *contract* (`contract.prisma`), a `db.orm` fluent API, a `db.sql` builder and a
> `db.raw` lane. All Prisma code here is written against that new API; see
> [Prisma 8 RC notes](#prisma-8-rc-notes--gotchas-found-while-building-this).

---

## Quick start

Requirements: [Bun](https://bun.sh) ≥ 1.3, PostgreSQL ≥ 15 (Docker file provided).

```bash
bun install
docker compose up -d            # tuned Postgres 16 on :5432  (or point .env at your own server)
cp .env.example .env            # connection strings + POOL_SIZE

bun run setup                   # create 2 DBs, apply each ORM's native schema tooling, diff the schemas
bun scripts/seed.ts --profile standard   # seed identical data into both + snapshot as templates

bun run bench:quick             # ~10 min smoke run  (profile quick, 2 rounds)
bun src/run-all.ts --profile standard --rounds 3            # the real thing
bun src/run-all.ts --profile stress   --rounds 3 --with-pg-diagnostic
```

Reports land in `results/<run-id>/report.md` (+ `summary.json`, raw per-round JSON) and `results/latest.md`.

### Profiles

| profile | users | products | orders (×3 items) | HTML docs | events (jsonb) | concurrency levels |
|---|--:|--:|--:|--:|--:|---|
| `quick` | 2 k | 1 k | 5 k | 100 | 20 k | 1, 10 |
| `standard` | 50 k | 10 k | 100 k | 2 k | 300 k | 1, 10, 50 |
| `stress` | 200 k | 50 k | 500 k | 10 k | 2 M | 1, 10, 50, 200 |

Useful flags for `src/run-all.ts`: `--only <regex>` (e.g. `--only '^(jsonb|search)\.'`), `--levels 1,32`,
`--pool 20`, `--rounds N`, `--with-pg-diagnostic`, `--skip-verify`. A single adapter can be run directly:
`bun src/bench.ts --adapter prisma --profile quick --only '^tx\.'`.

---

## What is measured

Every workload is defined **once** in [`src/workloads/catalog.ts`](src/workloads/catalog.ts) (name, description,
deterministic parameter generator, op-count weight, max concurrency). Both adapters are typed against
that catalog (`Impl`), so neither can skip a workload or drift in parameters.

| group | workloads |
|---|---|
| overhead | `overhead.ping` (`SELECT 1`: pure per-query client overhead) |
| read | `read.pk`, `read.uniqueEmail`, `read.indexRange` (composite index), `read.filterSortPage`, `read.joinInclude` (nested relations), `read.aggregate`, `read.cursorPages` (keyset), `read.large5kWide` (≈5 MB), `read.large20kNarrow` |
| jsonb | `jsonb.insert1k`, `jsonb.insertBulk200`, `jsonb.insert100k`, `jsonb.contains` (GIN `@>`), `jsonb.pathFilter`, `jsonb.extract`, `jsonb.update` (`jsonb_set`), `jsonb.aggregate` |
| search | `search.fullText` (GIN tsvector, ranked), `search.fullTextHeadline` (`ts_headline`), `search.ilike` (seq scan), `search.faceted` (btree + GIN jsonb) |
| html | `html.insertDoc`, `html.fetchBySlug`, `html.fetchByAuthor` (10 × ~30 KB), `html.update`, `html.searchAndFetch` |
| write | `write.insertOne`, `write.insertBulk200`, `write.updateOne`, `write.updateMany`, `write.upsert`, `write.insertDelete` |
| tx | `tx.transfer`, `tx.transferHot` (8 hot rows → lock contention), `tx.checkout` (8-statement interactive tx), `tx.readOnly`, `tx.rollback`, `tx.batch20` |
| mixed | `mixed.oltp` — weighted blend of the above (reads 55 %, writes ≈ 25 %, search/jsonb/tx the rest) |

Schema (identical in both databases, see [`src/drizzle/schema.ts`](src/drizzle/schema.ts) and
[`src/prisma/contract.prisma`](src/prisma/contract.prisma)): `users`, `products` (jsonb `attributes` + GIN),
`orders`, `order_items`, `documents` (HTML + plain text, GIN `to_tsvector('english', plain_text)`),
`events` (jsonb `payload` + GIN, btree `(kind, created_at)`), `accounts`, `transfers`.

The generated HTML contains headings, tables, lists, inline styles/scripts, entities, quotes, emoji and
non-BMP characters, so escaping/encoding paths are exercised.

---

## Sample results (read this before quoting any number)

A **small smoke run** (`--profile quick --rounds 2 --with-pg-diagnostic`, 39 workloads × concurrency 1 and 10)
on a 4-vCPU sandbox with Postgres 16 on the *same* machine and default Postgres settings. Full report:
[`results/quick-diag/report.md`](results/quick-diag/report.md). Treat it as a demonstration of the tool,
not as a verdict: tiny dataset, two rounds, shared CPUs, release-candidate software. Run `standard` /
`stress` on your own hardware for numbers that mean something.

Throughput ratio, geometric mean over the workloads in each group (>1 = Drizzle faster):

| group | c=1 | c=10 |
|---|---:|---:|
| overhead (`SELECT 1`) | 2.45× | 1.86× |
| read | 2.58× | 2.54× |
| jsonb | 1.22× | 1.49× |
| search | 1.35× | 1.26× |
| html | 1.36× | 1.48× |
| write | 2.42× | 2.36× |
| tx | 1.73× | 2.14× |
| mixed OLTP | 1.39× | 1.24× |

Overall 1.81× (Drizzle ahead in 71 of 80 cells, Prisma in 1, 8 ties). **Where does the gap come from?**
The diagnostic adapter (same Drizzle code over `node-postgres`) splits it into a driver part and an ORM part:

| | driver effect (Bun.SQL ÷ pg) | ORM effect (Drizzle ÷ Prisma, both on pg) | total |
|---|---:|---:|---:|
| all workloads (geo-mean) | 1.12× | 1.62× | 1.81× |

What the data says in this run:

* Most of the gap is **client-side ORM overhead**, not the driver. On small queries Prisma spends ~2–3× more
  client CPU per operation (e.g. `read.pk` ≈ 880 µs vs 330 µs at c=1).
* Row decoding is where it's largest: `read.large20kNarrow` (20 000 rows) is ~6–8× faster on Drizzle
  (≈ 20 ms vs ≈ 115 ms CPU per call).
* When **Postgres dominates** the gap disappears: 100 KB jsonb inserts, GIN containment at c=1, full-text
  search, bulk jsonb inserts are ties or within ~10 %.
* Bun.SQL's own advantage over `pg` is real but modest (~1.1–1.3× on reads/writes, ≈ 0 for jsonb).
* Startup: importing Prisma 8 takes ~480 ms vs ~80 ms for Drizzle (peak RSS 262 MB vs 210 MB here).
* No errors, and the account-balance conservation check passed in every run (no lost updates).

---

## Methodology (what makes the comparison fair)

* **Process isolation** – each ORM runs in its **own Bun process** (`src/bench.ts`); nothing from one ORM's
  code, pool or heap can affect the other.
* **Separate databases, identical state** – `bench_drizzle` / `bench_prisma` are created with each ORM's
  *native* tooling (`drizzle-kit push`, `prisma db init`) and then diffed by
  [`scripts/verify-schema.ts`](scripts/verify-schema.ts) (columns, types, defaults, indexes, FKs; names
  ignored). Data is seeded deterministically into both and snapshotted as Postgres templates; **both DBs are
  restored from the snapshot before every adapter run**, so every run starts from byte-identical state.
* **Parity gate** – before measuring, `run-all` runs every workload sequentially with a deterministic
  parameter stream on both ORMs and refuses to continue unless **every result fingerprint (rows / bytes)
  and the final database state** (row counts, sums, HTML lengths, jsonb stamps) are identical. This already
  caught a real bug in this project (see the Bun.SQL jsonb gotcha below).
* **Same inputs** – parameters come from a seeded PRNG per concurrent lane; Drizzle and Prisma receive the
  same sequence.
* **Fixed op counts, not fixed time** – write-heavy workloads grow the tables; with a fixed number of
  operations both databases see the same growth, so later workloads are not easier for the faster ORM.
  (`maxSeconds` is only a safety cap and flags results `⏱capped`.)
* **Closed-loop load** at concurrency 1 / 10 / 50 / 200 with a per-workload cap for heavy operations.
  Warm-up operations are discarded. Latencies are exact (every sample kept): p50/p95/p99/p99.9/max.
* **Same pool size** on both clients (`POOL_SIZE`, default 10): `Bun.SQL({ max })` vs `pg.Pool({ max })`.
* **Rotating run order** and **median of N rounds**; a cell is only a win if the ratio exceeds ±5 % *and*
  the per-round ranges don't overlap.
* **Client-side cost** is measured as process CPU time per operation (`process.cpuUsage()`), plus peak RSS.
* **Timestamps are strings on both sides** (`mode: 'string'` / `TimestamptzString`) because Bun has no
  `Temporal` (Prisma 8's default temporal codec needs it) and Date construction would otherwise differ.
* **Lanes are reported.** Where an ORM can't express a query natively the workload uses its escape hatch and
  the report says so (table at the bottom of every report).
* **`--with-pg-diagnostic`** adds a third adapter: the *same Drizzle workload code* over `node-postgres`.
  Drizzle(Bun.SQL) ÷ Drizzle(pg) is the **driver effect**; Drizzle(pg) ÷ Prisma(pg) is the **ORM effect**.

### Caveats

* Single machine: client and Postgres share CPUs. Use a dedicated DB host for production-grade numbers.
* Both ORMs are **release candidates**; numbers describe these exact versions only.
* `search.*` and the large jsonb operations are dominated by Postgres time, so ORM differences there are
  expected to vanish. That is a result, not a bug.
* Micro-benchmarks of ORMs say little about end-to-end latency in a networked app.

---

## Prisma 8 RC notes / gotchas found while building this

1. **Duplicate toolchain breaks `contract emit`.** With plain `bun add prisma @prisma/orm-postgres` the CLI
   ships its own nested `@prisma/orm-toolchain` (rc.13) next to the one `@prisma/orm-postgres` pulls (rc.14)
   and `prisma contract emit` (and therefore `prisma orm init`) fails with
   `CONTRACT.PACK_CONTRIBUTION_INVALID … "enum"`. Fixed here via `overrides` in `package.json`
   (`@prisma/orm-toolchain` and `@prisma/orm-framework` pinned to rc.14).
2. **Contract files need `// use prisma-8`** on the first line.
3. **PSL `Json` is Postgres `json`, not `jsonb`.** A GIN index on it fails
   (`data type json has no default operator class for access method "gin"`). Use **`Jsonb`**.
4. **Timestamps:** `DateTime`-style types decode to `Temporal` objects (no global `Temporal` on Bun/Node ≤ 24);
   this repo uses `TimestamptzString`.
5. **No atomic increments / jsonb operators in the ORM or SQL-builder lanes** – `update({ balance: balance + 5 })`,
   `@>`, `->>`, `jsonb_set` all need the raw lane (``db.raw.sql`…`.returnsRow({...})`` /
   `.affectedCount()`), with jsonb params wrapped in `param(value, { codecId: 'pg/jsonb@1' })`.
6. **Native full-text search is built in** (`fullTextMatches/Rank/Headline`, `@@fullTextIndex`) — a
   genuine ergonomic win over hand-written SQL.
7. The Prisma docs sites were unreachable from the build sandbox; the API was learned from the skill docs
   and `.d.ts` files bundled in `@prisma/orm-postgres` and by probing a live database.

## Drizzle RC / Bun.SQL gotchas

* **Silent wrong results with JSON strings bound to `jsonb` params on `Bun.SQL`.**
  ``sql`${col} @> ${JSON.stringify(x)}::jsonb` `` is *double-encoded* (the parameter becomes a JSON string
  scalar) and simply matches nothing — no error. Bind through the column encoder instead:
  ``sql`${col} @> ${sql.param(x, col)}` ``. (The parity gate caught this.)

---

## Layout

```
src/
  config.ts              profiles + env
  bench.ts               one adapter, one process (measure | --verify)
  run-all.ts             orchestrator: schema gate → parity gate → rounds → report
  report.ts              aggregation + markdown
  harness/               exact-percentile stats, closed-loop runner, CPU/RSS sampling
  data/                  deterministic PRNG, HTML / jsonb / text generators
  workloads/catalog.ts   the single source of truth for workloads
  drizzle/               schema.ts, db.ts, workloads.ts
  prisma/                contract.prisma, db.ts, workloads.ts (contract.json/.d.ts are emitted artefacts)
scripts/                 create-dbs, seed, reset-dbs, verify-schema
```

### Adding a workload

1. Add an entry to `catalog` (params generator, `ops`, `maxConc`).
2. TypeScript now forces you to implement it in `src/drizzle/workloads.ts` **and** `src/prisma/workloads.ts`
   (return a deterministic number — rows / bytes — as the parity fingerprint) and to describe the lane.
3. `bun run typecheck && bun src/run-all.ts --profile quick --rounds 1 --only '^your\.workload$'`.
