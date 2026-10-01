import { and, asc, desc, eq, gt, gte, ilike, inArray, lte, sql } from 'drizzle-orm';
import type { Impl, WorkloadName } from '../workloads/catalog';
import { createDrizzle, createDrizzleOnPg } from './db';
import { accounts, documents, events, orderItems, orders, products, transfers, users } from './schema';

class Rollback extends Error {}

// NOTE: under Bun.SQL a JSON *string* bound to a jsonb parameter is double-encoded (`${JSON.stringify(x)}::jsonb`
// silently matches nothing). Bind via `sql.param(obj, column)` instead. See README "Gotchas".

/** How each workload is expressed in Drizzle (reported alongside results). */
export const lanes: Record<WorkloadName, string> = {
  'overhead.ping': 'sql``', 'read.pk': 'query builder', 'read.uniqueEmail': 'query builder', 'read.indexRange': 'query builder',
  'read.filterSortPage': 'query builder', 'read.joinInclude': 'relational queries (RQB v2)', 'read.aggregate': 'query builder',
  'read.cursorPages': 'query builder', 'read.large5kWide': 'query builder', 'read.large20kNarrow': 'query builder',
  'jsonb.insert1k': 'query builder', 'jsonb.insertBulk200': 'query builder', 'jsonb.insert100k': 'query builder',
  'jsonb.contains': 'query builder + sql fragment', 'jsonb.pathFilter': 'query builder + sql fragment', 'jsonb.extract': 'query builder + sql fragment',
  'jsonb.update': 'query builder + sql fragment', 'jsonb.aggregate': 'query builder + sql fragment',
  'search.fullText': 'query builder + sql fragment', 'search.fullTextHeadline': 'query builder + sql fragment', 'search.ilike': 'query builder',
  'search.faceted': 'query builder + sql fragment', 'html.insertDoc': 'query builder', 'html.fetchBySlug': 'query builder',
  'html.fetchByAuthor': 'query builder', 'html.update': 'query builder', 'html.searchAndFetch': 'query builder + sql fragment',
  'write.insertOne': 'query builder', 'write.insertBulk200': 'query builder', 'write.updateOne': 'query builder', 'write.updateMany': 'query builder',
  'write.upsert': 'query builder', 'write.insertDelete': 'query builder', 'tx.transfer': 'transaction + query builder', 'tx.transferHot': 'transaction + query builder',
  'tx.checkout': 'transaction + query builder', 'tx.readOnly': 'transaction + query builder', 'tx.rollback': 'transaction + query builder', 'tx.batch20': 'transaction + query builder',
};

export async function createDrizzleImpl(url: string, poolSize: number, driver: 'bun' | 'pg' = 'bun') {
  const { db, close } = driver === 'bun' ? createDrizzle(url, poolSize) : createDrizzleOnPg(url, poolSize);

  const tsv = sql`to_tsvector('english', ${documents.plainText})`;
  const match = (q: string) => {
    const tq = sql`websearch_to_tsquery('english', ${q})`;
    return { where: sql`${tsv} @@ ${tq}`, rank: sql`ts_rank(${tsv}, ${tq})`, tq };
  };

  const transfer = async (p: { from: number; to: number; amount: number }) =>
    db.transaction(async (tx) => {
      // lock in ascending id order so concurrent opposing transfers cannot deadlock
      const legs = [{ id: p.from, delta: -p.amount }, { id: p.to, delta: p.amount }].sort((a, b) => a.id - b.id);
      for (const l of legs) {
        await tx.update(accounts).set({ balanceCents: sql`${accounts.balanceCents} + ${l.delta}`, version: sql`${accounts.version} + 1` }).where(eq(accounts.id, l.id));
      }
      await tx.insert(transfers).values({ fromId: p.from, toId: p.to, amountCents: p.amount });
      return 3;
    });

  const impl: Impl = {
    'overhead.ping': async () => {
      const r: any = await db.execute(sql`SELECT 1 AS one`);
      return Array.isArray(r) ? r.length : r.rows.length; // Bun.SQL returns rows, node-postgres a Result
    },

    'read.pk': async (p) => (await db.select().from(users).where(eq(users.id, p.id)).limit(1)).length,
    'read.uniqueEmail': async (p) => (await db.select().from(users).where(eq(users.email, p.email)).limit(1)).length,
    'read.indexRange': async (p) =>
      (await db.select().from(products).where(and(eq(products.category, p.category), gte(products.priceCents, p.min), lte(products.priceCents, p.max))).orderBy(asc(products.priceCents), asc(products.id)).limit(50)).length,
    'read.filterSortPage': async (p) =>
      (await db.select().from(orders).where(eq(orders.status, p.status)).orderBy(desc(orders.createdAt), desc(orders.id)).limit(50).offset(p.offset)).length,
    'read.joinInclude': async (p) => {
      const rows = await db.query.orders.findMany({
        where: { userId: p.userId },
        orderBy: { id: 'desc' },
        limit: 5,
        with: { items: { with: { product: { columns: { id: true, sku: true, name: true } } } } },
      });
      return rows.length * 1000 + rows.reduce((n, o) => n + o.items.length, 0);
    },
    'read.aggregate': async () => {
      const rows = await db
        .select({ status: orders.status, n: sql<number>`count(*)::int`, total: sql<number>`sum(${orders.totalCents})::bigint`, avg: sql<number>`avg(${orders.totalCents})` })
        .from(orders)
        .groupBy(orders.status);
      return rows.reduce((n, r) => n + Number(r.n), 0);
    },
    'read.cursorPages': async (p) => {
      let after = p.after, total = 0;
      for (let i = 0; i < 3; i++) {
        const page = await db.select().from(orders).where(gt(orders.id, after)).orderBy(asc(orders.id)).limit(100);
        total += page.length;
        after = page.at(-1)?.id ?? after;
      }
      return total;
    },
    'read.large5kWide': async (p) =>
      (await db.select({ id: events.id, userId: events.userId, kind: events.kind, payload: events.payload, createdAt: events.createdAt }).from(events).where(gt(events.id, p.offset)).orderBy(asc(events.id)).limit(5000)).length,
    'read.large20kNarrow': async (p) =>
      (await db.select({ id: events.id, userId: events.userId, kind: events.kind, createdAt: events.createdAt }).from(events).where(gt(events.id, p.offset)).orderBy(asc(events.id)).limit(20000)).length,

    'jsonb.insert1k': async (p) => (await db.insert(events).values(p).returning({ id: events.id })).length,
    'jsonb.insertBulk200': async (p) => {
      await db.insert(events).values(p.rows);
      return p.rows.length;
    },
    'jsonb.insert100k': async (p) => (await db.insert(events).values(p).returning({ id: events.id })).length,
    'jsonb.contains': async (p) =>
      (await db.select({ id: events.id, kind: events.kind }).from(events)
        .where(sql`${events.payload} @> ${sql.param({ device: { os: p.os }, geo: { country: p.country } }, events.payload)}`)
        .orderBy(desc(events.id)).limit(100)).length,
    'jsonb.pathFilter': async (p) =>
      (await db.select({ id: events.id }).from(events)
        .where(and(eq(events.kind, p.kind), sql`${events.payload} #>> '{session,referrer}' = ${p.referrer}`))
        .orderBy(asc(events.id)).limit(200)).length,
    'jsonb.extract': async (p) => {
      const rows = await db
        .select({
          id: events.id,
          country: sql<string>`${events.payload}->'geo'->>'country'`,
          ttfb: sql<number>`(${events.payload}->'metrics'->>'ttfb')::int`,
          sku: sql<string>`${events.payload}->'items'->0->>'sku'`,
        })
        .from(events).where(eq(events.kind, p.kind)).orderBy(asc(events.id)).limit(500);
      return rows.length + rows.reduce((n, r) => n + Number(r.ttfb), 0);
    },
    'jsonb.update': async (p) =>
      (await db.update(events).set({ payload: sql`jsonb_set(${events.payload}, '{flags,stamp}', to_jsonb(${p.stamp}::int))` }).where(eq(events.id, p.id)).returning({ id: events.id })).length,
    'jsonb.aggregate': async (p) => {
      const rows = await db
        .select({ os: sql<string>`${events.payload}->'device'->>'os'`, n: sql<number>`count(*)::int`, ttfb: sql<number>`avg((${events.payload}->'metrics'->>'ttfb')::int)` })
        .from(events).where(eq(events.kind, p.kind)).groupBy(sql`1`).orderBy(sql`1`);
      return rows.reduce((n, r) => n + Number(r.n), 0);
    },

    'search.fullText': async (p) => {
      const m = match(p.q);
      return (await db.select({ id: documents.id, title: documents.title }).from(documents).where(m.where).orderBy(desc(m.rank), asc(documents.id)).limit(20)).length;
    },
    'search.fullTextHeadline': async (p) => {
      const m = match(p.q);
      return (await db.select({ id: documents.id, snippet: sql<string>`ts_headline('english', ${documents.plainText}, ${m.tq}, 'StartSel=<mark>, StopSel=</mark>, MaxWords=20')` }).from(documents).where(m.where).orderBy(asc(documents.id)).limit(10)).length;
    },
    'search.ilike': async (p) => (await db.select({ id: products.id, name: products.name }).from(products).where(ilike(products.name, `%${p.term}%`)).orderBy(asc(products.id)).limit(50)).length,
    'search.faceted': async (p) =>
      (await db.select({ id: products.id, name: products.name, priceCents: products.priceCents }).from(products)
        .where(and(inArray(products.category, p.cats), gte(products.priceCents, p.min), lte(products.priceCents, p.max), gt(products.stock, 100), sql`${products.attributes} @> ${sql.param({ color: p.color }, products.attributes)}`))
        .orderBy(asc(products.priceCents), asc(products.id)).limit(50)).length,

    'html.insertDoc': async (p) => (await db.insert(documents).values(p).returning({ id: documents.id })).length,
    'html.fetchBySlug': async (p) => (await db.select().from(documents).where(eq(documents.slug, p.slug)).limit(1)).reduce((n, d) => n + d.html.length, 0),
    'html.fetchByAuthor': async (p) => {
      const rows = await db.select().from(documents).where(eq(documents.authorId, p.authorId)).orderBy(asc(documents.id)).limit(10);
      return rows.length + rows.reduce((n, d) => n + d.html.length, 0);
    },
    'html.update': async (p) =>
      (await db.update(documents).set({ html: p.html, plainText: p.plainText, wordCount: p.wordCount }).where(eq(documents.id, p.id)).returning({ id: documents.id })).length,
    'html.searchAndFetch': async (p) => {
      const m = match(p.q);
      const [top] = await db.select({ id: documents.id }).from(documents).where(m.where).orderBy(desc(m.rank), asc(documents.id)).limit(1);
      if (!top) return 0;
      const [doc] = await db.select({ html: documents.html }).from(documents).where(eq(documents.id, top.id));
      return doc?.html.length ?? 0;
    },

    'write.insertOne': async (p) => (await db.insert(users).values(p).returning()).length,
    'write.insertBulk200': async (p) => {
      await db.insert(orderItems).values(p.rows);
      return p.rows.length;
    },
    'write.updateOne': async (p) => (await db.update(products).set({ priceCents: p.price }).where(eq(products.id, p.id)).returning()).length,
    'write.updateMany': async (p) => {
      await db.update(products).set({ stock: p.stock }).where(eq(products.category, p.category));
      return 1;
    },
    'write.upsert': async (p) =>
      (await db.insert(products).values({ sku: p.sku, name: p.name, category: p.category, priceCents: p.price, stock: p.stock, attributes: p.attributes })
        .onConflictDoUpdate({ target: products.sku, set: { name: p.name, priceCents: p.price, stock: p.stock } }).returning()).length,
    'write.insertDelete': async (p) => {
      const [row] = await db.insert(events).values(p).returning({ id: events.id });
      return (await db.delete(events).where(eq(events.id, row!.id)).returning({ id: events.id })).length + 1;
    },

    'tx.transfer': transfer,
    'tx.transferHot': transfer,
    'tx.checkout': async (p) =>
      db.transaction(async (tx) => {
        const [order] = await tx.insert(orders).values({ userId: p.userId, status: 'pending', totalCents: 0, metadata: { channel: 'bench' } }).returning({ id: orders.id });
        await tx.insert(orderItems).values(p.items.map((i) => ({ orderId: order!.id, ...i })));
        for (const i of [...p.items].sort((a, b) => a.productId - b.productId)) {
          await tx.update(products).set({ stock: sql`${products.stock} - ${i.quantity}` }).where(eq(products.id, i.productId));
        }
        const total = p.items.reduce((n, i) => n + i.quantity * i.unitPriceCents, 0);
        await tx.update(orders).set({ totalCents: total }).where(eq(orders.id, order!.id));
        return p.items.length;
      }),
    'tx.readOnly': async (p) =>
      db.transaction(async (tx) => {
        const u = await tx.select().from(users).where(eq(users.id, p.userId)).limit(1);
        const o = await tx.select().from(orders).where(eq(orders.userId, p.userId)).orderBy(desc(orders.id)).limit(5);
        const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.userId, p.userId));
        return u.length + o.length + Number(c!.n);
      }, { accessMode: 'read only' }),
    'tx.rollback': async (p) => {
      try {
        await db.transaction(async (tx) => {
          await tx.insert(transfers).values({ fromId: p.from, toId: p.to, amountCents: 1 });
          throw new Rollback();
        });
      } catch (e) {
        if (e instanceof Rollback) return 1;
        throw e;
      }
      throw new Error('tx.rollback: transaction unexpectedly committed');
    },
    'tx.batch20': async (p) =>
      db.transaction(async (tx) => {
        let n = 0;
        for (const r of p.rows) n += (await tx.insert(events).values(r).returning({ id: events.id })).length;
        return n;
      }),
  };

  return { impl, close };
}
