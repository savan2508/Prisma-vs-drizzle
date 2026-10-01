# Drizzle (RC, Bun.SQL) vs Prisma 8 (RC, node-postgres) — results

- **Run**: `2026-10-01T01-33-32` · profile `quick` · 2 round(s) per ORM (median reported; run order rotated: D→P, P→D)
- **Drizzle**: drizzle-orm 1.0.0-rc.4 on bun 1.4.2 (Bun.SQL)
- **Prisma**: @prisma/orm-postgres 8.0.0-rc.14 on pg 8.22.0 (node-postgres)
- **Host**: linux/x64, 12 CPUs, Bun 1.4.2, PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2); pool size 10 for both clients
- **Data**: users=2,000, products=1,000, orders=5,000, documents=100, events=20,000, accounts=200
- **Correctness gate**: ✅ 39 workloads returned identical results and left both databases in identical state (row counts, sums, HTML lengths, jsonb stamps).

> “Drizzle 2.00×” means Drizzle completed twice as many operations per second. A cell is called a **tie** when the ratio is within ±5% or when the per-round throughput ranges of the two ORMs overlap. Postgres runs on the same machine as the client, so they compete for CPU; read **CPU µs/op** as the client-side cost of ORM + driver.

## Summary — geometric mean of throughput ratio (Drizzle ÷ Prisma, >1 = Drizzle faster)

| group | c=1 | c=10 |
|---|---:|---:|
| overhead | **1.46×** | **1.08×** |
| read | **2.22×** | **2.31×** |
| jsonb | **1.13×** | **1.19×** |
| search | **1.11×** | **1.13×** |
| html | **1.06×** | **1.13×** |
| write | **1.70×** | **2.02×** |
| tx | **1.54×** | **1.32×** |
| mixed | **1.20×** | **2.16×** |

Overall geometric mean over 80 (workload, concurrency) cells: **1.49×**. Cells won: Drizzle **47**, Prisma **6**, ties **27**.

## Startup & footprint

| metric | Drizzle (Bun.SQL) | Prisma 8 |
|---|---:|---:|
| import ORM (ms) | 48 | 286 |
| construct client (ms) | 1 | 11 |
| first query incl. connect (ms) | 19 | 37 |
| process start → ready (ms) | 80 | 347 |
| peak RSS across all workloads (MB) | 274 | 404 |

## overhead

| workload | c | Drizzle ops/s | Prisma ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|---|--:|--:|--:|
| `overhead.ping` | 1 | 9,214 | 6,309 | Drizzle 1.46× | 0.10 / 0.14 | 0.31 / 0.49 | 94 / 196 |
| `overhead.ping` | 10 | 33,740 | 31,230 | tie (ranges overlap) | 0.25 / 0.30 | 0.84 / 0.93 | 45 / 60 |

## read

| workload | c | Drizzle ops/s | Prisma ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|---|--:|--:|--:|
| `read.aggregate` | 1 | 746 | 556 | Drizzle 1.34× | 1.37 / 1.73 | 1.99 / 2.70 | 387 / 607 |
| `read.aggregate` | 10 | 3,269 | 2,827 | tie (ranges overlap) | 2.39 / 2.75 | 4.98 / 6.00 | 434 / 453 |
| `read.cursorPages` | 1 | 797 | 249 | Drizzle 3.20× | 1.19 / 3.96 | 2.07 / 6.44 | 995 / 3,704 |
| `read.cursorPages` | 10 | 2,177 | 535 | Drizzle 4.07× | 4.13 / 16.9 | 9.69 / 36.7 | 517 / 2,186 |
| `read.filterSortPage` | 1 | 1,813 | 990 | Drizzle 1.83× | 0.53 / 0.97 | 1.04 / 1.97 | 327 / 864 |
| `read.filterSortPage` | 10 | 8,650 | 2,245 | Drizzle 3.85× | 1.13 / 3.94 | 3.22 / 10.8 | 140 / 630 |
| `read.indexRange` | 1 | 3,680 | 1,264 | Drizzle 2.91× | 0.24 / 0.76 | 0.65 / 1.51 | 255 / 700 |
| `read.indexRange` | 10 | 9,447 | 4,328 | Drizzle 2.18× | 0.82 / 1.96 | 3.64 / 6.01 | 175 / 486 |
| `read.joinInclude` | 1 | 1,671 | 875 | Drizzle 1.91× | 0.57 / 1.11 | 1.19 / 1.93 | 638 / 949 |
| `read.joinInclude` | 10 | 4,061 | 2,481 | Drizzle 1.64× | 2.21 / 3.77 | 6.69 / 11.5 | 349 / 660 |
| `read.large20kNarrow` | 1 | 61 | 13 | Drizzle 4.79× | 16.4 / 77.4 | 21.8 / 114 | 18,633 / 96,271 |
| `read.large20kNarrow` | 10 | 81 | 15 | Drizzle 5.36× | 115 / 578 | 222 / 1195 | 19,535 / 78,070 |
| `read.large5kWide` | 1 | 33 | 23 | Drizzle 1.43× | 31.8 / 42.0 | 41.7 / 56.7 | 34,155 / 55,012 |
| `read.large5kWide` | 10 | 49 | 21 | Drizzle 2.36× | 132 / 364 | 596 / 1545 | 31,846 / 64,988 |
| `read.pk` | 1 | 4,766 | 2,166 | Drizzle 2.20× | 0.19 / 0.43 | 0.48 / 1.13 | 331 / 541 |
| `read.pk` | 10 | 10,737 | 9,863 | tie (ranges overlap) | 0.82 / 0.79 | 2.53 / 3.62 | 131 / 273 |
| `read.uniqueEmail` | 1 | 4,782 | 2,451 | Drizzle 1.95× | 0.18 / 0.38 | 0.54 / 0.93 | 340 / 444 |
| `read.uniqueEmail` | 10 | 16,593 | 7,921 | Drizzle 2.09× | 0.54 / 0.90 | 1.82 / 3.98 | 117 / 229 |

## jsonb

| workload | c | Drizzle ops/s | Prisma ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|---|--:|--:|--:|
| `jsonb.aggregate` | 1 | 120 | 163 | Prisma 1.35× | 8.25 / 5.72 | 12.2 / 8.46 | 815 / 671 |
| `jsonb.aggregate` | 10 | 392 | 549 | Prisma 1.40× | 21.8 / 16.3 | 38.5 / 24.6 | 582 / 823 |
| `jsonb.contains` | 1 | 71 | 57 | Drizzle 1.24× | 18.9 / 20.9 | 25.1 / 33.9 | 604 / 1,363 |
| `jsonb.contains` | 10 | 386 | 373 | tie (ranges overlap) | 23.4 / 28.1 | 44.5 / 38.4 | 396 / 1,057 |
| `jsonb.extract` | 1 | 425 | 252 | Drizzle 1.69× | 2.39 / 4.00 | 3.10 / 8.78 | 821 / 2,498 |
| `jsonb.extract` | 10 | 1,773 | 668 | Drizzle 2.65× | 5.17 / 13.6 | 10.9 / 29.9 | 634 / 1,911 |
| `jsonb.insert100k` | 1 | 70 | 53 | Drizzle 1.32× | 8.11 / 12.0 | 183 / 236 | 2,236 / 3,443 |
| `jsonb.insert100k` | 10 | 103 | 92 | tie (ranges overlap) | 18.1 / 21.6 | 255 / 282 | 2,138 / 2,560 |
| `jsonb.insert1k` | 1 | 1,332 | 1,245 | tie (ranges overlap) | 0.69 / 0.78 | 1.44 / 1.54 | 396 / 435 |
| `jsonb.insert1k` | 10 | 6,652 | 6,098 | Drizzle 1.09× | 1.21 / 1.21 | 3.45 / 4.62 | 180 / 246 |
| `jsonb.insertBulk200` | 1 | 35 | 30 | tie (ranges overlap) | 15.3 / 19.2 | 135 / 164 | 6,672 / 9,610 |
| `jsonb.insertBulk200` | 10 | 50 | 48 | tie (ranges overlap) | 60.0 / 68.8 | 894 / 929 | 8,416 / 9,401 |
| `jsonb.pathFilter` | 1 | 188 | 199 | tie (ranges overlap) | 6.23 / 5.03 | 9.82 / 6.64 | 561 / 949 |
| `jsonb.pathFilter` | 10 | 1,232 | 988 | Drizzle 1.25× | 8.93 / 9.42 | 17.2 / 18.7 | 327 / 989 |
| `jsonb.update` | 1 | 1,424 | 1,343 | tie (ranges overlap) | 0.67 / 0.72 | 1.38 / 1.17 | 284 / 261 |
| `jsonb.update` | 10 | 8,800 | 7,010 | Drizzle 1.26× | 1.05 / 1.36 | 2.57 / 2.83 | 129 / 219 |

## search

| workload | c | Drizzle ops/s | Prisma ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|---|--:|--:|--:|
| `search.faceted` | 1 | 2,602 | 1,390 | Drizzle 1.87× | 0.36 / 0.70 | 0.67 / 1.21 | 292 / 489 |
| `search.faceted` | 10 | 7,964 | 5,603 | tie (ranges overlap) | 1.18 / 1.58 | 3.29 / 4.71 | 142 / 195 |
| `search.fullText` | 1 | 50 | 67 | Prisma 1.34× | 15.8 / 10.3 | 55.7 / 37.9 | 591 / 1,285 |
| `search.fullText` | 10 | 268 | 305 | tie (ranges overlap) | 29.8 / 22.1 | 79.2 / 60.2 | 328 / 975 |
| `search.fullTextHeadline` | 1 | 61 | 72 | Prisma 1.18× | 17.3 / 15.3 | 35.3 / 28.1 | 573 / 1,328 |
| `search.fullTextHeadline` | 10 | 361 | 395 | tie (ranges overlap) | 24.5 / 22.1 | 45.5 / 41.3 | 262 / 748 |
| `search.ilike` | 1 | 794 | 622 | Drizzle 1.28× | 1.25 / 1.65 | 1.71 / 2.18 | 317 / 599 |
| `search.ilike` | 10 | 5,793 | 4,061 | Drizzle 1.43× | 1.39 / 2.09 | 3.43 / 5.34 | 158 / 597 |

## html

| workload | c | Drizzle ops/s | Prisma ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|---|--:|--:|--:|
| `html.fetchByAuthor` | 1 | 1,197 | 893 | Drizzle 1.34× | 0.81 / 1.05 | 2.87 / 2.34 | 463 / 679 |
| `html.fetchByAuthor` | 10 | 4,096 | 2,670 | Drizzle 1.53× | 1.93 / 3.33 | 4.28 / 9.07 | 280 / 450 |
| `html.fetchBySlug` | 1 | 1,396 | 1,287 | tie (ranges overlap) | 0.70 / 0.75 | 1.62 / 1.50 | 403 / 488 |
| `html.fetchBySlug` | 10 | 4,580 | 4,527 | tie (ranges overlap) | 1.80 / 1.77 | 5.80 / 9.39 | 225 / 311 |
| `html.insertDoc` | 1 | 143 | 165 | Prisma 1.15× | 6.88 / 6.00 | 9.82 / 8.87 | 2,216 / 1,817 |
| `html.insertDoc` | 10 | 688 | 813 | Prisma 1.18× | 12.7 / 11.2 | 21.6 / 20.4 | 1,546 / 1,396 |
| `html.searchAndFetch` | 1 | 3 | 2 | tie (ranges overlap) | 375 / 398 | 534 / 547 | 3,994 / 8,300 |
| `html.searchAndFetch` | 10 | 10 | 10 | tie (ranges overlap) | 911 / 894 | 1123 / 1088 | 1,528 / 2,940 |
| `html.update` | 1 | 122 | 118 | tie (ranges overlap) | 5.83 / 6.76 | 110 / 86.0 | 1,453 / 2,306 |
| `html.update` | 10 | 939 | 675 | Drizzle 1.39× | 10.3 / 13.3 | 17.4 / 18.6 | 998 / 1,602 |

## write

| workload | c | Drizzle ops/s | Prisma ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|---|--:|--:|--:|
| `write.insertBulk200` | 1 | 136 | 107 | tie (ranges overlap) | 7.64 / 9.72 | 10.5 / 15.6 | 3,589 / 4,779 |
| `write.insertBulk200` | 10 | 612 | 256 | Drizzle 2.39× | 15.7 / 39.4 | 33.5 / 100 | 1,815 / 4,689 |
| `write.insertDelete` | 1 | 791 | 388 | Drizzle 2.04× | 1.12 / 2.51 | 3.36 / 5.46 | 517 / 1,467 |
| `write.insertDelete` | 10 | 4,283 | 1,215 | Drizzle 3.53× | 2.05 / 7.78 | 4.65 / 15.2 | 403 / 972 |
| `write.insertOne` | 1 | 1,626 | 1,071 | Drizzle 1.52× | 0.61 / 0.91 | 0.98 / 1.48 | 424 / 508 |
| `write.insertOne` | 10 | 7,507 | 4,829 | tie (ranges overlap) | 1.17 / 1.87 | 3.22 / 5.44 | 140 / 286 |
| `write.updateMany` | 1 | 1,057 | 782 | tie (ranges overlap) | 0.90 / 1.28 | 2.31 / 1.92 | 251 / 403 |
| `write.updateMany` | 10 | 2,823 | 2,182 | tie (ranges overlap) | 2.90 / 3.83 | 6.73 / 8.63 | 180 / 451 |
| `write.updateOne` | 1 | 1,409 | 522 | Drizzle 2.70× | 0.66 / 1.78 | 2.35 / 4.42 | 339 / 1,189 |
| `write.updateOne` | 10 | 7,004 | 2,670 | Drizzle 2.62× | 1.15 / 4.41 | 4.25 / 11.1 | 160 / 570 |
| `write.upsert` | 1 | 1,380 | 834 | Drizzle 1.66× | 0.68 / 1.20 | 1.85 / 2.29 | 347 / 733 |
| `write.upsert` | 10 | 6,184 | 4,064 | tie (ranges overlap) | 1.30 / 4.76 | 5.45 / 13.2 | 171 / 490 |

## tx

| workload | c | Drizzle ops/s | Prisma ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|---|--:|--:|--:|
| `tx.batch20` | 1 | 153 | 98 | Drizzle 1.55× | 6.50 / 10.00 | 8.51 / 13.5 | 3,756 / 6,621 |
| `tx.batch20` | 10 | 567 | 580 | tie (ranges overlap) | 15.8 / 14.3 | 28.6 / 30.1 | 2,089 / 2,016 |
| `tx.checkout` | 1 | 428 | 244 | Drizzle 1.75× | 2.13 / 3.77 | 6.82 / 8.70 | 1,195 / 2,661 |
| `tx.checkout` | 10 | 1,406 | 847 | Drizzle 1.66× | 7.08 / 10.5 | 12.3 / 24.7 | 1,067 / 1,341 |
| `tx.readOnly` | 1 | 928 | 494 | Drizzle 1.88× | 0.97 / 1.95 | 2.77 / 3.73 | 694 / 1,715 |
| `tx.readOnly` | 10 | 2,744 | 1,930 | tie (ranges overlap) | 3.62 / 5.27 | 8.00 / 11.6 | 432 / 763 |
| `tx.rollback` | 1 | 2,109 | 1,487 | Drizzle 1.42× | 0.45 / 0.65 | 1.02 / 1.53 | 294 / 487 |
| `tx.rollback` | 10 | 6,447 | 7,058 | tie (ranges overlap) | 1.32 / 1.52 | 3.56 / 3.34 | 206 / 177 |
| `tx.transfer` | 1 | 742 | 599 | tie (ranges overlap) | 1.11 / 1.62 | 10.0 / 2.89 | 742 / 980 |
| `tx.transfer` | 10 | 3,376 | 2,118 | Drizzle 1.59× | 2.74 / 4.37 | 5.22 / 8.50 | 321 / 581 |
| `tx.transferHot` | 1 | 920 | 622 | Drizzle 1.48× | 1.03 / 1.53 | 1.88 / 3.90 | 598 / 801 |
| `tx.transferHot` | 10 | 2,006 | 1,277 | Drizzle 1.57× | 3.64 / 6.32 | 14.7 / 23.0 | 433 / 711 |

## mixed

| workload | c | Drizzle ops/s | Prisma ops/s | verdict | p50 ms D / P | p99 ms D / P | CPU µs/op D / P |
|---|--:|--:|--:|---|--:|--:|--:|
| `mixed.oltp` | 1 | 102 | 85 | Drizzle 1.20× | 0.50 / 1.03 | 372 / 420 | 387 / 942 |
| `mixed.oltp` | 10 | 349 | 162 | Drizzle 2.16× | 0.71 / 2.79 | 782 / 1171 | 356 / 1,189 |

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
| drizzle | 1 | 200000000 | 44114 | 585 |
| drizzle | 2 | 200000000 | 44116 | 587 |
| prisma | 1 | 200000000 | 44115 | 586 |
| prisma | 2 | 200000000 | 44113 | 587 |
