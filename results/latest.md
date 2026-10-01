# Drizzle (RC, Bun.SQL) vs Prisma 8 (RC, node-postgres) — results

- **Run**: `quick-diag` · profile `quick` · 2 round(s) per ORM (median reported; run order rotated: Dpg→D→P, D→P→Dpg)
- **Drizzle**: drizzle-orm 1.0.0-rc.4 on bun 1.3.14 (Bun.SQL)
- **Prisma**: @prisma/orm-postgres 8.0.0-rc.14 on pg 8.22.0 (node-postgres)
- **Host**: linux/x64, 4 CPUs, Bun 1.3.14, PostgreSQL 16; pool size 10 for both clients
- **Data**: users=2,000, products=1,000, orders=5,000, documents=100, events=20,000, accounts=200
- **Correctness gate**: ✅ 39 workloads returned identical results and left the databases in identical state (row counts, sums, HTML lengths, jsonb stamps).

> “Drizzle 2.00×” means Drizzle completed twice as many operations per second. A cell is called a **tie** when the ratio is within ±5% or when the per-round throughput ranges of the two ORMs overlap. Postgres runs on the same machine as the client, so they compete for CPU; read **CPU µs/op** as the client-side cost of ORM + driver.

## Summary — geometric mean of throughput ratio (Drizzle ÷ Prisma, >1 = Drizzle faster)

| group | c=1 | c=10 |
|---|---:|---:|
| overhead | **2.45×** | **1.86×** |
| read | **2.58×** | **2.54×** |
| jsonb | **1.22×** | **1.49×** |
| search | **1.35×** | **1.26×** |
| html | **1.36×** | **1.48×** |
| write | **2.42×** | **2.36×** |
| tx | **1.73×** | **2.14×** |
| mixed | **1.39×** | **1.24×** |

Overall geometric mean over 80 (workload, concurrency) cells: **1.81×**. Cells won: Drizzle **71**, Prisma **1**, ties **8**.

## Driver vs ORM (diagnostic)

`Drizzle (pg)` is the *same Drizzle workload code* run over `node-postgres`, the driver Prisma 8 uses. Geometric-mean throughput ratios:

| group | **driver effect**: Drizzle(Bun.SQL) ÷ Drizzle(pg) | **ORM effect**: Drizzle(pg) ÷ Prisma(pg) | **total**: Drizzle(Bun.SQL) ÷ Prisma |
|---|---:|---:|---:|
| overhead | **1.14×** | **1.87×** | **2.13×** |
| read | **1.22×** | **2.09×** | **2.56×** |
| jsonb | **1.01×** | **1.33×** | **1.35×** |
| search | **1.21×** | **1.08×** | **1.30×** |
| html | **1.18×** | **1.21×** | **1.42×** |
| write | **1.16×** | **2.06×** | **2.39×** |
| tx | 1.04× slower | **2.01×** | **1.93×** |
| mixed | **1.29×** | **1.02×** | **1.31×** |
| **all** | **1.12×** | **1.62×** | **1.81×** |

## Startup & footprint

| metric | Drizzle (Bun.SQL) | Prisma 8 | Drizzle (pg) |
|---|---:|---:|---:|
| import ORM (ms) | 83 | 481 | 84 |
| construct client (ms) | 2 | 23 | 1 |
| first query incl. connect (ms) | 24 | 56 | 31 |
| process start → ready (ms) | 141 | 594 | 148 |
| peak RSS across all workloads (MB) | 210 | 262 | 181 |

## overhead

| workload | c | Drizzle ops/s | Prisma ops/s | Drizzle(pg) ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|--:|---|--:|--:|--:|
| `overhead.ping` | 1 | 12,678 | 5,185 | 11,179 | Drizzle 2.45× | 0.06 / 0.13 | 0.47 / 1.79 | 82 / 301 |
| `overhead.ping` | 10 | 22,297 | 12,011 | 19,428 | Drizzle 1.86× | 0.39 / 0.66 | 1.65 / 3.25 | 58 / 131 |

## read

| workload | c | Drizzle ops/s | Prisma ops/s | Drizzle(pg) ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|--:|---|--:|--:|--:|
| `read.aggregate` | 1 | 814 | 661 | 751 | Drizzle 1.23× | 1.18 / 1.46 | 1.70 / 1.86 | 591 / 786 |
| `read.aggregate` | 10 | 2,145 | 1,516 | 2,159 | Drizzle 1.41× | 4.13 / 5.04 | 8.96 / 15.5 | 416 / 678 |
| `read.cursorPages` | 1 | 802 | 221 | 520 | Drizzle 3.64× | 1.09 / 4.19 | 2.79 / 7.35 | 1,114 / 4,714 |
| `read.cursorPages` | 10 | 1,108 | 281 | 1,034 | Drizzle 3.94× | 8.72 / 32.9 | 18.9 / 56.9 | 991 / 3,881 |
| `read.filterSortPage` | 1 | 1,669 | 817 | 1,613 | Drizzle 2.04× | 0.59 / 1.13 | 1.53 / 2.57 | 423 / 1,329 |
| `read.filterSortPage` | 10 | 4,520 | 1,293 | 3,836 | Drizzle 3.50× | 1.87 / 6.94 | 4.95 / 16.0 | 239 / 974 |
| `read.indexRange` | 1 | 3,116 | 1,010 | 1,865 | Drizzle 3.08× | 0.28 / 0.90 | 1.25 / 2.47 | 314 / 1,226 |
| `read.indexRange` | 10 | 4,682 | 1,900 | 4,544 | Drizzle 2.46× | 1.88 / 4.38 | 5.99 / 13.6 | 279 / 843 |
| `read.joinInclude` | 1 | 1,266 | 707 | 830 | Drizzle 1.79× | 0.71 / 1.28 | 1.94 / 3.12 | 865 / 1,394 |
| `read.joinInclude` | 10 | 2,102 | 1,462 | 1,916 | Drizzle 1.44× | 4.21 / 6.05 | 10.9 / 14.7 | 575 / 959 |
| `read.large20kNarrow` | 1 | 58 | 10 | 45 | Drizzle 5.98× | 16.2 / 101 | 22.6 / 115 | 21,577 / 116,773 |
| `read.large20kNarrow` | 10 | 73 | 9 | 48 | Drizzle 7.91× | 125 / 1050 | 193 / 1110 | 18,845 / 121,772 |
| `read.large5kWide` | 1 | 33 | 16 | 29 | Drizzle 2.01× | 29.8 / 59.2 | 38.7 / 86.7 | 42,518 / 79,403 |
| `read.large5kWide` | 10 | 38 | 17 | 31 | Drizzle 2.19× | 231 / 535 | 367 / 858 | 30,964 / 72,784 |
| `read.pk` | 1 | 4,003 | 1,501 | 3,211 | Drizzle 2.67× | 0.20 / 0.56 | 1.25 / 2.62 | 331 / 881 |
| `read.pk` | 10 | 6,599 | 3,807 | 5,473 | Drizzle 1.73× | 1.16 / 2.25 | 6.71 / 7.09 | 295 / 453 |
| `read.uniqueEmail` | 1 | 5,496 | 1,788 | 3,989 | Drizzle 3.07× | 0.15 / 0.46 | 1.02 / 2.11 | 233 / 740 |
| `read.uniqueEmail` | 10 | 8,014 | 3,776 | 7,641 | Drizzle 2.12× | 1.05 / 2.16 | 2.77 / 6.98 | 158 / 385 |

## jsonb

| workload | c | Drizzle ops/s | Prisma ops/s | Drizzle(pg) ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|--:|---|--:|--:|--:|
| `jsonb.aggregate` | 1 | 166 | 162 | 160 | tie (ranges overlap) | 5.85 / 6.09 | 7.82 / 6.99 | 918 / 1,282 |
| `jsonb.aggregate` | 10 | 635 | 536 | 629 | Drizzle 1.18× | 12.9 / 16.9 | 24.9 / 30.8 | 291 / 628 |
| `jsonb.contains` | 1 | 39 | 43 | 44 | Prisma 1.08× | 25.3 / 26.4 | 26.9 / 31.5 | 2,517 / 4,874 |
| `jsonb.contains` | 10 | 213 | 140 | 152 | Drizzle 1.52× | 37.6 / 64.9 | 82.5 / 101 | 590 / 2,860 |
| `jsonb.extract` | 1 | 498 | 262 | 459 | Drizzle 1.90× | 1.92 / 3.62 | 2.91 / 6.85 | 911 / 3,067 |
| `jsonb.extract` | 10 | 1,481 | 380 | 1,007 | Drizzle 3.89× | 5.90 / 23.7 | 12.3 / 51.7 | 624 / 2,864 |
| `jsonb.insert100k` | 1 | 56 | 54 | 79 | tie (±5%) | 10.2 / 10.8 | 236 / 234 | 3,934 / 5,315 |
| `jsonb.insert100k` | 10 | 94 | 86 | 200 | Drizzle 1.09× | 28.6 / 30.2 | 263 / 275 | 2,868 / 3,226 |
| `jsonb.insert1k` | 1 | 1,318 | 752 | 1,148 | Drizzle 1.75× | 0.76 / 1.20 | 1.71 / 2.89 | 447 / 965 |
| `jsonb.insert1k` | 10 | 5,743 | 3,262 | 5,368 | Drizzle 1.76× | 1.33 / 2.59 | 6.09 / 8.31 | 226 / 419 |
| `jsonb.insertBulk200` | 1 | 25 | 24 | 24 | Drizzle 1.07× | 21.9 / 24.4 | 162 / 172 | 13,120 / 17,904 |
| `jsonb.insertBulk200` | 10 | 38 | 41 | 45 | tie (ranges overlap) | 105 / 108 | 960 / 900 | 9,467 / 12,844 |
| `jsonb.pathFilter` | 1 | 208 | 179 | 202 | Drizzle 1.16× | 6.08 / 5.52 | 8.85 / 7.09 | 1,096 / 2,364 |
| `jsonb.pathFilter` | 10 | 820 | 659 | 920 | Drizzle 1.24× | 11.9 / 13.3 | 28.6 / 40.0 | 341 / 1,272 |
| `jsonb.update` | 1 | 1,308 | 1,094 | 1,062 | Drizzle 1.20× | 0.72 / 0.84 | 1.50 / 2.26 | 326 / 473 |
| `jsonb.update` | 10 | 8,321 | 5,236 | 6,151 | Drizzle 1.59× | 1.05 / 1.65 | 3.13 / 5.24 | 127 / 281 |

## search

| workload | c | Drizzle ops/s | Prisma ops/s | Drizzle(pg) ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|--:|---|--:|--:|--:|
| `search.faceted` | 1 | 2,340 | 1,237 | 1,390 | Drizzle 1.89× | 0.38 / 0.75 | 1.37 / 2.18 | 337 / 703 |
| `search.faceted` | 10 | 4,388 | 4,122 | 3,891 | Drizzle 1.06× | 1.87 / 1.98 | 5.61 / 6.34 | 232 / 263 |
| `search.fullText` | 1 | 61 | 58 | 63 | Drizzle 1.06× | 12.6 / 13.3 | 40.6 / 42.2 | 1,551 / 3,962 |
| `search.fullText` | 10 | 198 | 181 | 202 | tie (ranges overlap) | 37.2 / 39.5 | 115 / 134 | 550 / 2,484 |
| `search.fullTextHeadline` | 1 | 72 | 66 | 74 | Drizzle 1.10× | 14.7 / 17.3 | 29.1 / 28.2 | 1,502 / 3,643 |
| `search.fullTextHeadline` | 10 | 250 | 222 | 130 | Drizzle 1.12× | 33.5 / 45.8 | 83.7 / 86.0 | 463 / 1,324 |
| `search.ilike` | 1 | 1,039 | 696 | 988 | Drizzle 1.49× | 0.93 / 1.34 | 1.90 / 3.04 | 496 / 911 |
| `search.ilike` | 10 | 3,807 | 1,988 | 3,060 | Drizzle 1.92× | 2.22 / 4.00 | 5.98 / 12.9 | 181 / 758 |

## html

| workload | c | Drizzle ops/s | Prisma ops/s | Drizzle(pg) ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|--:|---|--:|--:|--:|
| `html.fetchByAuthor` | 1 | 1,620 | 871 | 1,042 | Drizzle 1.86× | 0.57 / 1.04 | 1.53 / 3.88 | 383 / 976 |
| `html.fetchByAuthor` | 10 | 4,469 | 1,850 | 3,173 | Drizzle 2.42× | 1.80 / 4.78 | 5.39 / 13.7 | 253 / 817 |
| `html.fetchBySlug` | 1 | 2,075 | 1,024 | 1,223 | Drizzle 2.03× | 0.45 / 0.88 | 1.20 / 2.35 | 296 / 881 |
| `html.fetchBySlug` | 10 | 4,388 | 2,832 | 3,452 | Drizzle 1.55× | 1.86 / 2.94 | 5.80 / 8.33 | 265 / 511 |
| `html.insertDoc` | 1 | 158 | 158 | 174 | tie (ranges overlap) | 6.23 / 6.39 | 10.5 / 9.27 | 2,474 / 2,873 |
| `html.insertDoc` | 10 | 530 | 492 | 487 | Drizzle 1.08× | 16.1 / 18.0 | 35.8 / 39.0 | 1,386 / 1,905 |
| `html.searchAndFetch` | 1 | 2 | 2 | 2 | tie (ranges overlap) | 446 / 448 | 500 / 507 | 6,126 / 18,857 |
| `html.searchAndFetch` | 10 | 9 | 7 | 9 | Drizzle 1.21× | 1099 / 1338 | 1323 / 1666 | 1,848 / 7,791 |
| `html.update` | 1 | 126 | 102 | 126 | Drizzle 1.23× | 5.45 / 7.40 | 110 / 107 | 1,828 / 4,051 |
| `html.update` | 10 | 598 | 411 | 589 | Drizzle 1.45× | 14.7 / 22.0 | 33.7 / 36.3 | 978 / 2,373 |

## write

| workload | c | Drizzle ops/s | Prisma ops/s | Drizzle(pg) ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|--:|---|--:|--:|--:|
| `write.insertBulk200` | 1 | 147 | 81 | 115 | Drizzle 1.82× | 6.94 / 13.0 | 9.64 / 21.7 | 5,773 / 9,603 |
| `write.insertBulk200` | 10 | 264 | 174 | 315 | Drizzle 1.51× | 34.0 / 48.6 | 87.5 / 109 | 5,490 / 7,141 |
| `write.insertDelete` | 1 | 825 | 260 | 849 | Drizzle 3.18× | 1.13 / 3.70 | 2.42 / 6.55 | 551 / 2,956 |
| `write.insertDelete` | 10 | 4,128 | 1,072 | 3,004 | Drizzle 3.85× | 2.04 / 9.85 | 5.09 / 17.1 | 369 / 1,400 |
| `write.insertOne` | 1 | 1,827 | 708 | 1,230 | Drizzle 2.58× | 0.53 / 1.36 | 1.23 / 3.51 | 336 / 1,153 |
| `write.insertOne` | 10 | 6,144 | 2,426 | 4,410 | Drizzle 2.53× | 1.38 / 4.00 | 3.95 / 10.6 | 184 / 566 |
| `write.updateMany` | 1 | 1,196 | 643 | 909 | Drizzle 1.86× | 0.75 / 1.50 | 2.03 / 3.06 | 260 / 858 |
| `write.updateMany` | 10 | 1,999 | 1,442 | 1,628 | Drizzle 1.39× | 3.56 / 5.88 | 9.16 / 13.8 | 250 / 395 |
| `write.updateOne` | 1 | 1,312 | 368 | 1,455 | Drizzle 3.57× | 0.61 / 2.60 | 1.60 / 5.63 | 376 / 2,350 |
| `write.updateOne` | 10 | 5,353 | 1,303 | 4,916 | Drizzle 4.11× | 1.55 / 8.01 | 5.53 / 16.0 | 203 / 1,168 |
| `write.upsert` | 1 | 1,204 | 597 | 986 | Drizzle 2.02× | 0.78 / 1.62 | 2.81 / 3.99 | 580 / 1,259 |
| `write.upsert` | 10 | 3,937 | 1,919 | 3,808 | Drizzle 2.05× | 2.12 / 4.82 | 5.09 / 12.0 | 270 / 661 |

## tx

| workload | c | Drizzle ops/s | Prisma ops/s | Drizzle(pg) ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|--:|---|--:|--:|--:|
| `tx.batch20` | 1 | 127 | 103 | 123 | tie (ranges overlap) | 5.48 / 9.10 | 108 / 16.9 | 3,812 / 9,934 |
| `tx.batch20` | 10 | 304 | 99 | 458 | Drizzle 3.09× | 18.4 / 35.2 | 124 / 241 | 2,597 / 5,959 |
| `tx.checkout` | 1 | 424 | 223 | 448 | Drizzle 1.90× | 2.15 / 4.84 | 4.60 / 10.1 | 1,372 / 4,305 |
| `tx.checkout` | 10 | 1,201 | 562 | 1,215 | Drizzle 2.14× | 8.16 / 19.4 | 15.7 / 33.8 | 1,108 / 2,733 |
| `tx.readOnly` | 1 | 1,071 | 354 | 1,089 | Drizzle 3.02× | 0.85 / 2.75 | 2.20 / 5.73 | 693 / 3,218 |
| `tx.readOnly` | 10 | 1,983 | 759 | 2,069 | Drizzle 2.61× | 4.38 / 13.1 | 10.4 / 26.5 | 576 / 1,703 |
| `tx.rollback` | 1 | 2,970 | 1,709 | 3,045 | Drizzle 1.74× | 0.28 / 0.52 | 1.25 / 2.67 | 274 / 617 |
| `tx.rollback` | 10 | 6,148 | 3,465 | 6,420 | Drizzle 1.77× | 1.32 / 2.53 | 3.91 / 7.15 | 306 / 352 |
| `tx.transfer` | 1 | 657 | 483 | 766 | Drizzle 1.36× | 1.41 / 2.06 | 3.66 / 5.24 | 982 / 1,988 |
| `tx.transfer` | 10 | 2,648 | 1,588 | 2,311 | Drizzle 1.67× | 3.46 / 6.19 | 6.89 / 13.4 | 411 / 805 |
| `tx.transferHot` | 1 | 834 | 512 | 844 | tie (ranges overlap) | 1.15 / 2.10 | 2.39 / 4.85 | 705 / 1,536 |
| `tx.transferHot` | 10 | 1,694 | 904 | 1,529 | Drizzle 1.87× | 5.01 / 8.76 | 22.8 / 47.1 | 469 / 1,004 |

## mixed

| workload | c | Drizzle ops/s | Prisma ops/s | Drizzle(pg) ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|--:|---|--:|--:|--:|
| `mixed.oltp` | 1 | 113 | 81 | 82 | Drizzle 1.39× | 0.62 / 1.06 | 441 / 448 | 697 / 1,622 |
| `mixed.oltp` | 10 | 269 | 217 | 223 | Drizzle 1.24× | 3.44 / 3.81 | 908 / 1034 | 552 / 1,324 |

## How each workload was expressed

| workload | what it does | Drizzle | Prisma 8 |
|---|---|---|---|
| `overhead.ping` | SELECT 1 via each client's raw lane: pure per-query client overhead | sql`` | raw sql |
| `read.aggregate` | Full-table GROUP BY status: count, sum(total_cents), avg(total_cents) over orders | query builder | ORM (groupBy.aggregate) |
| `read.cursorPages` | Keyset pagination session: 3 sequential pages of 100 orders | query builder | ORM |
| `read.filterSortPage` | Orders by status, ORDER BY created_at DESC, LIMIT 50 OFFSET n (index (status, created_at)) | query builder | ORM |
| `read.indexRange` | Composite index (category, price) equality + range, ordered, LIMIT 50 | query builder | ORM |
| `read.joinInclude` | A user's 5 latest orders + items + product (nested relation loading) | relational queries (RQB v2) | ORM (nested include) |
| `read.large20kNarrow` | 20,000 narrow rows (id, user_id, kind, created_at): row decode throughput | query builder | ORM |
| `read.large5kWide` | 5,000 events incl. ~1KB jsonb payload each (~5MB result) | query builder | ORM |
| `read.pk` | Fetch one user by primary key | query builder | ORM |
| `read.uniqueEmail` | Fetch one user by unique-indexed email | query builder | ORM |
| `jsonb.aggregate` | GROUP BY payload->device->>os with avg((payload->metrics->>ttfb)::int) for one kind | query builder + sql fragment | raw sql |
| `jsonb.contains` | GIN containment: payload @> {"device":{"os":..},"geo":{"country":..}} LIMIT 100 | query builder + sql fragment | raw sql (no jsonb operators in ORM) |
| `jsonb.extract` | Project jsonb fields (->, ->>, ::int) for 500 rows of one kind | query builder + sql fragment | raw sql |
| `jsonb.insert100k` | Insert one event with a ~100KB jsonb payload | query builder | ORM |
| `jsonb.insert1k` | Insert one event with ~1KB nested jsonb payload | query builder | ORM |
| `jsonb.insertBulk200` | Insert 200 events (~1KB jsonb each, ~200KB) in one statement | query builder | ORM (createAndCount) |
| `jsonb.pathFilter` | kind = X AND payload #>> {session,referrer} = Y (btree + jsonb filter), LIMIT 200 | query builder + sql fragment | raw sql |
| `jsonb.update` | Partial jsonb update with jsonb_set on one event | query builder + sql fragment | raw sql (jsonb_set) |
| `search.faceted` | Faceted product search: category IN (3) AND price range AND stock AND attributes @> {color} | query builder + sql fragment | raw sql (jsonb @>) |
| `search.fullText` | Full-text (GIN tsvector) websearch query, ranked top 20 | query builder + sql fragment | ORM (native fullText*) |
| `search.fullTextHeadline` | Full-text match + ts_headline snippets for top 10 (CPU heavy in Postgres) | query builder + sql fragment | SQL builder (fullTextHeadline) |
| `search.ilike` | Unindexed ILIKE '%term%' over products.name (seq scan), LIMIT 50 | query builder | ORM |
| `html.fetchByAuthor` | Fetch up to 10 full HTML documents for an author (index author_id) | query builder | ORM |
| `html.fetchBySlug` | Fetch one HTML document (20-60KB) by unique slug | query builder | ORM |
| `html.insertDoc` | Insert a ~30KB HTML article (+ plain text for FTS index maintenance) | query builder | ORM |
| `html.searchAndFetch` | Two-step: FTS top hit id, then fetch its full HTML | query builder + sql fragment | ORM (native fullText*) |
| `html.update` | Rewrite the HTML body of one existing document (~30KB UPDATE, FTS index maintained) | query builder | ORM |
| `write.insertBulk200` | Insert 200 order_items rows in one statement (FK + 2 indexes) | query builder | ORM (createAndCount) |
| `write.insertDelete` | Insert an event then delete it by id (2 round trips, no tx) | query builder | ORM |
| `write.insertOne` | Insert one user (unique email, small jsonb profile) RETURNING row | query builder | ORM |
| `write.updateMany` | UPDATE ... WHERE category = X (touches ~5% of products) | query builder | ORM (updateAndCount) |
| `write.updateOne` | Update one product row by primary key | query builder | ORM |
| `write.upsert` | Upsert product by unique sku (half hit existing, half insert) | query builder | ORM (upsert) |
| `tx.batch20` | One tx wrapping 20 single-row inserts (per-statement overhead inside a tx) | transaction + query builder | transaction + ORM |
| `tx.checkout` | Interactive tx: insert order, bulk-insert 4 items, decrement 4 product stocks, set total (8 statements) | transaction + query builder | transaction + ORM + raw sql (atomic arithmetic) |
| `tx.readOnly` | Read-only tx with 3 sequential reads (user, latest orders, order count) | transaction + query builder | transaction + ORM |
| `tx.rollback` | Tx that inserts then throws: measures rollback + error path | transaction + query builder | transaction + ORM |
| `tx.transfer` | Interactive tx: debit + credit two random accounts + insert ledger row (3 statements) | transaction + query builder | transaction + raw sql (atomic arithmetic) + ORM |
| `tx.transferHot` | Same transfer tx but over only 8 hot accounts: row-lock contention | transaction + query builder | transaction + raw sql (atomic arithmetic) + ORM |
| `mixed.oltp` | Weighted OLTP blend: 30% read.pk, 10% read.uniqueEmail, 8% read.indexRange, 7% read.joinInclude, 8% jsonb.insert1k, 4% write.insertOne, 7% write.updateOne, 4% jsonb.update, 4% html.fetchBySlug, 4% search.fullText, 8% tx.transfer, 3% tx.checkout, 3% jsonb.contains | blend of the above | blend of the above |

## Post-run integrity

Transfer transactions must conserve the total of all account balances (no lost updates under contention):

| ORM | round | sum(balance_cents) | rows in events | rows in transfers |
|---|--:|--:|--:|--:|
| drizzle-pg | 1 | 200000000 | 44116 | 586 |
| drizzle-pg | 2 | 200000000 | 44112 | 587 |
| drizzle | 1 | 200000000 | 44118 | 587 |
| drizzle | 2 | 200000000 | 44116 | 589 |
| prisma | 1 | 200000000 | 44112 | 588 |
| prisma | 2 | 200000000 | 44114 | 586 |
