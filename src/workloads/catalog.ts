import type { SeedInfo } from '../config';
import { CATEGORIES, COUNTRIES, EVENT_KINDS, OSES, STATUSES, VOCAB, genDocument, genPayload, type EventPayload } from '../data/generate';
import type { Rng } from '../data/rng';

export interface Ctx {
  sizes: SeedInfo;
  /** monotonically increasing unique number (process-wide) */
  seq(): number;
  /** short unique tag for this process, used to build collision-free unique keys */
  tag: string;
}

export interface WorkloadMeta<P> {
  group: 'read' | 'jsonb' | 'search' | 'html' | 'write' | 'tx' | 'overhead';
  description: string;
  /** op-count multiplier relative to Profile.baseOps (heavy ops < 1) */
  ops: number;
  /** max concurrency this workload is run at (heavy ops are not hammered at 200 lanes) */
  maxConc: number;
  params(rng: Rng, ctx: Ctx): P;
}

const def = <P>(m: WorkloadMeta<P>) => m;
const uid = (r: Rng, n: number) => r.int(1, n);

export interface OrderItemRow { orderId: number; productId: number; quantity: number; unitPriceCents: number }
export interface EventRow { userId: number; kind: string; payload: EventPayload }

export const catalog = {
  // ------------------------------------------------------------------ overhead
  'overhead.ping': def({
    group: 'overhead', description: 'SELECT 1 via each client\'s raw lane: pure per-query client overhead', ops: 4, maxConc: 200,
    params: () => ({}),
  }),

  // ------------------------------------------------------------------ reads
  'read.pk': def({
    group: 'read', description: 'Fetch one user by primary key', ops: 2, maxConc: 200,
    params: (r, c) => ({ id: uid(r, c.sizes.users) }),
  }),
  'read.uniqueEmail': def({
    group: 'read', description: 'Fetch one user by unique-indexed email', ops: 2, maxConc: 200,
    params: (r, c) => ({ email: `user${uid(r, c.sizes.users)}@example.com` }),
  }),
  'read.indexRange': def({
    group: 'read', description: 'Composite index (category, price) equality + range, ordered, LIMIT 50', ops: 1, maxConc: 200,
    params: (r) => { const min = r.int(100, 20_000); return { category: r.pick(CATEGORIES), min, max: min + r.int(500, 8_000) }; },
  }),
  'read.filterSortPage': def({
    group: 'read', description: 'Orders by status, ORDER BY created_at DESC, LIMIT 50 OFFSET n (index (status, created_at))', ops: 1, maxConc: 200,
    params: (r) => ({ status: r.pick(STATUSES), offset: r.int(0, 200) }),
  }),
  'read.joinInclude': def({
    group: 'read', description: 'A user\'s 5 latest orders + items + product (nested relation loading)', ops: 1, maxConc: 200,
    params: (r, c) => ({ userId: uid(r, c.sizes.users) }),
  }),
  'read.aggregate': def({
    group: 'read', description: 'Full-table GROUP BY status: count, sum(total_cents), avg(total_cents) over orders', ops: 0.05, maxConc: 10,
    params: () => ({}),
  }),
  'read.cursorPages': def({
    group: 'read', description: 'Keyset pagination session: 3 sequential pages of 100 orders', ops: 0.5, maxConc: 50,
    params: (r, c) => ({ after: r.int(0, Math.max(1, c.sizes.orders - 400)) }),
  }),
  'read.large5kWide': def({
    group: 'read', description: '5,000 events incl. ~1KB jsonb payload each (~5MB result)', ops: 0.04, maxConc: 10,
    params: (r, c) => ({ offset: r.int(0, Math.max(0, c.sizes.events - 5_000)) }),
  }),
  'read.large20kNarrow': def({
    group: 'read', description: '20,000 narrow rows (id, user_id, kind, created_at): row decode throughput', ops: 0.04, maxConc: 10,
    params: (r, c) => ({ offset: r.int(0, Math.max(0, c.sizes.events - 20_000)) }),
  }),

  // ------------------------------------------------------------------ jsonb
  'jsonb.insert1k': def({
    group: 'jsonb', description: 'Insert one event with ~1KB nested jsonb payload', ops: 1, maxConc: 200,
    params: (r, c): EventRow => ({ userId: uid(r, c.sizes.users), kind: r.pick(EVENT_KINDS), payload: genPayload(r, 1_000) }),
  }),
  'jsonb.insertBulk200': def({
    group: 'jsonb', description: 'Insert 200 events (~1KB jsonb each, ~200KB) in one statement', ops: 0.15, maxConc: 50,
    params: (r, c) => ({ rows: Array.from({ length: 200 }, (): EventRow => ({ userId: uid(r, c.sizes.users), kind: r.pick(EVENT_KINDS), payload: genPayload(r, 1_000) })) }),
  }),
  'jsonb.insert100k': def({
    group: 'jsonb', description: 'Insert one event with a ~100KB jsonb payload', ops: 0.1, maxConc: 50,
    params: (r, c): EventRow => ({ userId: uid(r, c.sizes.users), kind: 'blob', payload: genPayload(r, 100_000) }),
  }),
  'jsonb.contains': def({
    group: 'jsonb', description: 'GIN containment: payload @> {"device":{"os":..},"geo":{"country":..}} LIMIT 100', ops: 0.1, maxConc: 50,
    params: (r) => ({ os: r.pick(OSES), country: r.pick(COUNTRIES) }),
  }),
  'jsonb.pathFilter': def({
    group: 'jsonb', description: 'kind = X AND payload #>> {session,referrer} = Y (btree + jsonb filter), LIMIT 200', ops: 0.5, maxConc: 100,
    params: (r) => ({ kind: r.pick(EVENT_KINDS), referrer: r.pick(['google', 'direct', 'twitter', 'newsletter']) }),
  }),
  'jsonb.extract': def({
    group: 'jsonb', description: 'Project jsonb fields (->, ->>, ::int) for 500 rows of one kind', ops: 0.25, maxConc: 50,
    params: (r) => ({ kind: r.pick(EVENT_KINDS) }),
  }),
  'jsonb.update': def({
    group: 'jsonb', description: 'Partial jsonb update with jsonb_set on one event', ops: 1, maxConc: 200,
    params: (r, c) => ({ id: uid(r, c.sizes.events), stamp: r.int(1, 1_000_000) }),
  }),
  'jsonb.aggregate': def({
    group: 'jsonb', description: 'GROUP BY payload->device->>os with avg((payload->metrics->>ttfb)::int) for one kind', ops: 0.1, maxConc: 20,
    params: (r) => ({ kind: r.pick(EVENT_KINDS) }),
  }),

  // ------------------------------------------------------------------ search
  'search.fullText': def({
    group: 'search', description: 'Full-text (GIN tsvector) websearch query, ranked top 20', ops: 0.05, maxConc: 50,
    params: (r) => ({ q: ftsQuery(r) }),
  }),
  'search.fullTextHeadline': def({
    group: 'search', description: 'Full-text match + ts_headline snippets for top 10 (CPU heavy in Postgres)', ops: 0.03, maxConc: 20,
    params: (r) => ({ q: ftsQuery(r) }),
  }),
  'search.ilike': def({
    group: 'search', description: 'Unindexed ILIKE \'%term%\' over products.name (seq scan), LIMIT 50', ops: 0.25, maxConc: 50,
    params: (r) => ({ term: r.pick(['widget', 'gadget', 'deluxe', 'ultra', 'sprocket', 'eco']) + ' ' + r.int(1, 9) }),
  }),
  'search.faceted': def({
    group: 'search', description: 'Faceted product search: category IN (3) AND price range AND stock AND attributes @> {color}', ops: 0.5, maxConc: 100,
    params: (r) => ({ cats: [r.pick(CATEGORIES), r.pick(CATEGORIES), r.pick(CATEGORIES)], min: r.int(100, 10_000), max: r.int(20_000, 50_000), color: r.pick(['red', 'green', 'blue', 'black', 'white']) }),
  }),

  // ------------------------------------------------------------------ html
  'html.insertDoc': def({
    group: 'html', description: 'Insert a ~30KB HTML article (+ plain text for FTS index maintenance)', ops: 0.15, maxConc: 50,
    params: (r, c) => {
      const n = c.seq();
      const d = genDocument(n + 1_000_003, `gen-${c.tag}-${n}`, 20_000 + r.int(0, 20_000));
      return { slug: d.slug, title: d.title, authorId: uid(r, c.sizes.users), html: d.html, plainText: d.plainText, wordCount: d.wordCount };
    },
  }),
  'html.fetchBySlug': def({
    group: 'html', description: 'Fetch one HTML document (20-60KB) by unique slug', ops: 1, maxConc: 100,
    params: (r, c) => ({ slug: `doc-${uid(r, c.sizes.documents)}` }),
  }),
  'html.fetchByAuthor': def({
    group: 'html', description: 'Fetch up to 10 full HTML documents for an author (index author_id)', ops: 0.25, maxConc: 50,
    params: (r, c) => ({ authorId: 1 + ((uid(r, c.sizes.documents) * 31) % c.sizes.users) }),
  }),
  'html.update': def({
    group: 'html', description: 'Rewrite the HTML body of one existing document (~30KB UPDATE, FTS index maintained)', ops: 0.15, maxConc: 50,
    params: (r, c) => {
      const id = uid(r, c.sizes.documents);
      const d = genDocument(id + 7_000_000 + c.seq(), `doc-${id}`, 20_000 + r.int(0, 20_000));
      return { id, html: d.html, plainText: d.plainText, wordCount: d.wordCount };
    },
  }),
  'html.searchAndFetch': def({
    group: 'html', description: 'Two-step: FTS top hit id, then fetch its full HTML', ops: 0.05, maxConc: 50,
    params: (r) => ({ q: ftsQuery(r) }),
  }),

  // ------------------------------------------------------------------ writes
  'write.insertOne': def({
    group: 'write', description: 'Insert one user (unique email, small jsonb profile) RETURNING row', ops: 1, maxConc: 200,
    params: (r, c) => { const n = c.seq(); return { email: `b_${c.tag}_${n}@bench.io`, name: `Bench ${n}`, country: r.pick(COUNTRIES), age: r.int(18, 80), profile: { plan: r.pick(['free', 'pro']), tags: ['x', 'y'] } }; },
  }),
  'write.insertBulk200': def({
    group: 'write', description: 'Insert 200 order_items rows in one statement (FK + 2 indexes)', ops: 0.25, maxConc: 50,
    params: (r, c) => ({ rows: Array.from({ length: 200 }, (): OrderItemRow => ({ orderId: uid(r, c.sizes.orders), productId: uid(r, c.sizes.products), quantity: r.int(1, 5), unitPriceCents: r.int(100, 9_000) })) }),
  }),
  'write.updateOne': def({
    group: 'write', description: 'Update one product row by primary key', ops: 1, maxConc: 200,
    params: (r, c) => ({ id: uid(r, c.sizes.products), price: r.int(100, 50_000) }),
  }),
  'write.updateMany': def({
    group: 'write', description: 'UPDATE ... WHERE category = X (touches ~5% of products)', ops: 0.1, maxConc: 20,
    params: (r) => ({ category: r.pick(CATEGORIES), stock: r.int(50, 1_000) }),
  }),
  'write.upsert': def({
    group: 'write', description: 'Upsert product by unique sku (half hit existing, half insert)', ops: 0.5, maxConc: 100,
    params: (r, c) => {
      const existing = r.chance(0.5);
      const sku = existing ? `SKU-${String(uid(r, c.sizes.products)).padStart(7, '0')}` : `NEW-${c.tag}-${c.seq()}`;
      return { sku, name: `Upserted ${r.int(1, 1e6)}`, category: r.pick(CATEGORIES), price: r.int(100, 50_000), stock: r.int(0, 500), attributes: { color: r.pick(['red', 'blue']), upserted: true } };
    },
  }),
  'write.insertDelete': def({
    group: 'write', description: 'Insert an event then delete it by id (2 round trips, no tx)', ops: 0.5, maxConc: 100,
    params: (r, c): EventRow => ({ userId: uid(r, c.sizes.users), kind: 'tmp', payload: genPayload(r, 300) }),
  }),

  // ------------------------------------------------------------------ transactions
  'tx.transfer': def({
    group: 'tx', description: 'Interactive tx: debit + credit two random accounts + insert ledger row (3 statements)', ops: 0.5, maxConc: 100,
    params: (r, c) => { const a = uid(r, c.sizes.accounts); let b = uid(r, c.sizes.accounts); if (b === a) b = (a % c.sizes.accounts) + 1; return { from: a, to: b, amount: r.int(1, 500) }; },
  }),
  'tx.transferHot': def({
    group: 'tx', description: 'Same transfer tx but over only 8 hot accounts: row-lock contention', ops: 0.25, maxConc: 100,
    params: (r) => { const a = r.int(1, 8); let b = r.int(1, 8); if (b === a) b = (a % 8) + 1; return { from: a, to: b, amount: r.int(1, 50) }; },
  }),
  'tx.checkout': def({
    group: 'tx', description: 'Interactive tx: insert order, bulk-insert 4 items, decrement 4 product stocks, set total (8 statements)', ops: 0.25, maxConc: 100,
    params: (r, c) => ({ userId: uid(r, c.sizes.users), items: Array.from({ length: 4 }, () => ({ productId: uid(r, c.sizes.products), quantity: r.int(1, 3), unitPriceCents: r.int(100, 9_000) })) }),
  }),
  'tx.readOnly': def({
    group: 'tx', description: 'Read-only tx with 3 sequential reads (user, latest orders, order count)', ops: 0.5, maxConc: 100,
    params: (r, c) => ({ userId: uid(r, c.sizes.users) }),
  }),
  'tx.rollback': def({
    group: 'tx', description: 'Tx that inserts then throws: measures rollback + error path', ops: 0.5, maxConc: 100,
    params: (r, c) => ({ from: uid(r, c.sizes.accounts), to: uid(r, c.sizes.accounts) }),
  }),
  'tx.batch20': def({
    group: 'tx', description: 'One tx wrapping 20 single-row inserts (per-statement overhead inside a tx)', ops: 0.1, maxConc: 50,
    params: (r, c) => ({ rows: Array.from({ length: 20 }, (): EventRow => ({ userId: uid(r, c.sizes.users), kind: 'batch', payload: genPayload(r, 200) })) }),
  }),
} as const satisfies Record<string, WorkloadMeta<any>>;

function ftsQuery(r: Rng): string {
  // mix of rare single terms, ANDed pairs, OR pairs and a common-ish term
  const rare = () => VOCAB[r.int(4_000, 19_999)]!;
  const mid = () => VOCAB[r.int(800, 4_000)]!;
  switch (r.int(0, 3)) {
    case 0: return rare();
    case 1: return `${rare()} ${mid()}`;
    case 2: return `${rare()} OR ${rare()}`;
    default: return mid();
  }
}

export type WorkloadName = keyof typeof catalog;
export type ParamsOf<N extends WorkloadName> = ReturnType<(typeof catalog)[N]['params']>;
/** Every adapter must implement every workload. Returns a number fingerprint (rows / bytes) used for parity checks. */
export type Impl = { [N in WorkloadName]: (p: ParamsOf<N>) => Promise<number> };
export const workloadNames = Object.keys(catalog) as WorkloadName[];

/** Weighted blend used by the `mixed.oltp` scenario. */
export const mixedWeights: [WorkloadName, number][] = [
  ['read.pk', 30], ['read.uniqueEmail', 10], ['read.indexRange', 8], ['read.joinInclude', 7],
  ['jsonb.insert1k', 8], ['write.insertOne', 4], ['write.updateOne', 7], ['jsonb.update', 4],
  ['html.fetchBySlug', 4], ['search.fullText', 4], ['tx.transfer', 8], ['tx.checkout', 3], ['jsonb.contains', 3],
];
