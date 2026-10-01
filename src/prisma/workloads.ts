import { and } from '@prisma/orm-postgres/orm-client';
import { param } from '@prisma/orm-postgres/relational-core/expression';
import { websearchToTsquery } from '@prisma/orm-postgres/target/full-text';
import type { Impl, WorkloadName } from '../workloads/catalog';
import { createPrisma } from './db';

class Rollback extends Error {}

const JSONB = 'pg/jsonb@1';
const INT4 = 'pg/int4@1';
const TEXT = 'pg/text@1';
const NULLABLE_TEXT = { codecId: TEXT, nullable: true } as const;
const NULLABLE_INT4 = { codecId: INT4, nullable: true } as const;
const jsonb = (v: unknown) => param(v, { codecId: JSONB });

/** How each workload is expressed in Prisma 8 (reported alongside results). */
export const lanes: Record<WorkloadName, string> = {
  'overhead.ping': 'raw sql', 'read.pk': 'ORM', 'read.uniqueEmail': 'ORM', 'read.indexRange': 'ORM', 'read.filterSortPage': 'ORM',
  'read.joinInclude': 'ORM (nested include)', 'read.aggregate': 'ORM (groupBy.aggregate)', 'read.cursorPages': 'ORM', 'read.large5kWide': 'ORM', 'read.large20kNarrow': 'ORM',
  'jsonb.insert1k': 'ORM', 'jsonb.insertBulk200': 'ORM (createAndCount)', 'jsonb.insert100k': 'ORM',
  'jsonb.contains': 'raw sql (no jsonb operators in ORM)', 'jsonb.pathFilter': 'raw sql', 'jsonb.extract': 'raw sql', 'jsonb.update': 'raw sql (jsonb_set)', 'jsonb.aggregate': 'raw sql',
  'search.fullText': 'ORM (native fullText*)', 'search.fullTextHeadline': 'SQL builder (fullTextHeadline)', 'search.ilike': 'ORM', 'search.faceted': 'raw sql (jsonb @>)',
  'html.insertDoc': 'ORM', 'html.fetchBySlug': 'ORM', 'html.fetchByAuthor': 'ORM', 'html.update': 'ORM', 'html.searchAndFetch': 'ORM (native fullText*)',
  'write.insertOne': 'ORM', 'write.insertBulk200': 'ORM (createAndCount)', 'write.updateOne': 'ORM', 'write.updateMany': 'ORM (updateAndCount)', 'write.upsert': 'ORM (upsert)', 'write.insertDelete': 'ORM',
  'tx.transfer': 'transaction + raw sql (atomic arithmetic) + ORM', 'tx.transferHot': 'transaction + raw sql (atomic arithmetic) + ORM',
  'tx.checkout': 'transaction + ORM + raw sql (atomic arithmetic)', 'tx.readOnly': 'transaction + ORM', 'tx.rollback': 'transaction + ORM', 'tx.batch20': 'transaction + ORM',
};

export async function createPrismaImpl(url: string, poolSize: number) {
  const { db } = createPrisma(url, poolSize);
  const rt = () => db.runtime();
  const O = db.orm.public;

  const rawQuery = <S extends Record<string, string | { codecId: string; nullable?: boolean }>>(spec: S, plan: { returnsRow(s: S): { build(): any } }) =>
    rt().query(plan.returnsRow(spec).build()) as unknown as Promise<Record<string, any>[]>;

  const transfer = async (p: { from: number; to: number; amount: number }) =>
    db.transaction(async (tx) => {
      const legs = [{ id: p.from, delta: -p.amount }, { id: p.to, delta: p.amount }].sort((a, b) => a.id - b.id);
      for (const l of legs) {
        await tx.execute(db.raw.sql`UPDATE accounts SET balance_cents = balance_cents + ${l.delta}, version = version + 1 WHERE id = ${l.id}`.affectedCount().build());
      }
      await tx.orm.public.Transfer.createAndCount([{ fromId: p.from, toId: p.to, amountCents: p.amount }]);
      return 3;
    });

  const impl: Impl = {
    'overhead.ping': async () => (await rawQuery({ one: INT4 }, db.raw.sql`SELECT 1 AS one`)).length,

    'read.pk': async (p) => ((await O.User.first({ id: p.id })) ? 1 : 0),
    'read.uniqueEmail': async (p) => ((await O.User.where((u) => u.email.eq(p.email)).first()) ? 1 : 0),
    'read.indexRange': async (p) =>
      (await O.Product.where((x) => and(x.category.eq(p.category), x.priceCents.gte(p.min), x.priceCents.lte(p.max)))
        .orderBy([(x) => x.priceCents.asc(), (x) => x.id.asc()]).limit(50).all()).length,
    'read.filterSortPage': async (p) =>
      (await O.Order.where({ status: p.status }).orderBy([(o) => o.createdAt.desc(), (o) => o.id.desc()]).limit(50).offset(p.offset).all()).length,
    'read.joinInclude': async (p) => {
      const rows = await O.Order.where({ userId: p.userId })
        .orderBy((o) => o.id.desc())
        .limit(5)
        .include('items', (i) => i.include('product', (pr) => pr.select('id', 'sku', 'name')))
        .all();
      return rows.length * 1000 + rows.reduce((n, o) => n + o.items.length, 0);
    },
    'read.aggregate': async () => {
      const rows = await O.Order.groupBy('status').aggregate((a) => ({ n: a.count(), total: a.sum('totalCents'), avg: a.avg('totalCents') }));
      return rows.reduce((n, r) => n + Number(r.n), 0);
    },
    'read.cursorPages': async (p) => {
      let after = p.after, total = 0;
      for (let i = 0; i < 3; i++) {
        const page = await O.Order.where((o) => o.id.gt(after)).orderBy((o) => o.id.asc()).limit(100).all();
        total += page.length;
        after = page.at(-1)?.id ?? after;
      }
      return total;
    },
    'read.large5kWide': async (p) =>
      (await O.Event.select('id', 'userId', 'kind', 'payload', 'createdAt').where((e) => e.id.gt(p.offset)).orderBy((e) => e.id.asc()).limit(5000).all()).length,
    'read.large20kNarrow': async (p) =>
      (await O.Event.select('id', 'userId', 'kind', 'createdAt').where((e) => e.id.gt(p.offset)).orderBy((e) => e.id.asc()).limit(20000).all()).length,

    'jsonb.insert1k': async (p) => ((await O.Event.select('id').create(p)) ? 1 : 0),
    'jsonb.insertBulk200': async (p) => {
      await O.Event.createAndCount(p.rows);
      return p.rows.length;
    },
    'jsonb.insert100k': async (p) => ((await O.Event.select('id').create(p)) ? 1 : 0),
    'jsonb.contains': async (p) =>
      (await rawQuery({ id: INT4, kind: TEXT },
        db.raw.sql`SELECT id, kind FROM events WHERE payload @> ${jsonb({ device: { os: p.os }, geo: { country: p.country } })} ORDER BY id DESC LIMIT ${100}`)).length,
    'jsonb.pathFilter': async (p) =>
      (await rawQuery({ id: INT4 },
        db.raw.sql`SELECT id FROM events WHERE kind = ${p.kind} AND payload #>> '{session,referrer}' = ${p.referrer} ORDER BY id ASC LIMIT ${200}`)).length,
    'jsonb.extract': async (p) => {
      const rows = await rawQuery({ id: INT4, country: NULLABLE_TEXT, ttfb: NULLABLE_INT4, sku: NULLABLE_TEXT },
        db.raw.sql`SELECT id, payload->'geo'->>'country' AS country, (payload->'metrics'->>'ttfb')::int AS ttfb, payload->'items'->0->>'sku' AS sku FROM events WHERE kind = ${p.kind} ORDER BY id ASC LIMIT ${500}`);
      return rows.length + rows.reduce((n, r) => n + Number(r['ttfb']), 0);
    },
    'jsonb.update': async (p) =>
      (await rawQuery({ id: INT4 },
        db.raw.sql`UPDATE events SET payload = jsonb_set(payload, '{flags,stamp}', to_jsonb(${p.stamp}::int)) WHERE id = ${p.id} RETURNING id`)).length,
    'jsonb.aggregate': async (p) => {
      const rows = await rawQuery({ os: NULLABLE_TEXT, n: INT4, ttfb: { codecId: 'pg/numeric@1', nullable: true } },
        db.raw.sql`SELECT payload->'device'->>'os' AS os, count(*)::int AS n, avg((payload->'metrics'->>'ttfb')::int) AS ttfb FROM events WHERE kind = ${p.kind} GROUP BY 1 ORDER BY 1`);
      return rows.reduce((n, r) => n + Number(r['n']), 0);
    },

    'search.fullText': async (p) => {
      const q = websearchToTsquery(p.q);
      return (await O.Document.select('id', 'title').where((d) => d.plainText.fullTextMatches(q))
        .orderBy([(d) => d.plainText.fullTextRank(q).desc(), (d) => d.id.asc()]).limit(20).all()).length;
    },
    'search.fullTextHeadline': async (p) => {
      const q = websearchToTsquery(p.q);
      const plan = db.sql.public.documents
        .select('id')
        .select('snippet', (f, fns) => fns.fullTextHeadline(f.plain_text, q, { startSel: '<mark>', stopSel: '</mark>', maxWords: 20 }))
        .where((f, fns) => fns.fullTextMatches(f.plain_text, q))
        .orderBy((f) => f.id, { direction: 'asc' })
        .limit(10)
        .build();
      return (await rt().query(plan)).length;
    },
    'search.ilike': async (p) => (await O.Product.select('id', 'name').where((x) => x.name.ilike(`%${p.term}%`)).orderBy((x) => x.id.asc()).limit(50).all()).length,
    'search.faceted': async (p) =>
      (await rawQuery({ id: INT4, name: TEXT, price_cents: INT4 },
        db.raw.sql`SELECT id, name, price_cents FROM products WHERE category IN (${p.cats[0]!}, ${p.cats[1]!}, ${p.cats[2]!}) AND price_cents >= ${p.min} AND price_cents <= ${p.max} AND stock > ${100} AND attributes @> ${jsonb({ color: p.color })} ORDER BY price_cents ASC, id ASC LIMIT ${50}`)).length,

    'html.insertDoc': async (p) => ((await O.Document.select('id').create(p)) ? 1 : 0),
    'html.fetchBySlug': async (p) => (await O.Document.where({ slug: p.slug }).first())?.html.length ?? 0,
    'html.fetchByAuthor': async (p) => {
      const rows = await O.Document.where({ authorId: p.authorId }).orderBy((d) => d.id.asc()).limit(10).all();
      return rows.length + rows.reduce((n, d) => n + d.html.length, 0);
    },
    'html.update': async (p) => ((await O.Document.where({ id: p.id }).select('id').update({ html: p.html, plainText: p.plainText, wordCount: p.wordCount })) ? 1 : 0),
    'html.searchAndFetch': async (p) => {
      const q = websearchToTsquery(p.q);
      const top = await O.Document.select('id').where((d) => d.plainText.fullTextMatches(q))
        .orderBy([(d) => d.plainText.fullTextRank(q).desc(), (d) => d.id.asc()]).limit(1).first();
      if (!top) return 0;
      return (await O.Document.select('html').first({ id: top.id }))?.html.length ?? 0;
    },

    'write.insertOne': async (p) => ((await O.User.create(p)) ? 1 : 0),
    'write.insertBulk200': async (p) => {
      await O.OrderItem.createAndCount(p.rows);
      return p.rows.length;
    },
    'write.updateOne': async (p) => ((await O.Product.where({ id: p.id }).update({ priceCents: p.price })) ? 1 : 0),
    'write.updateMany': async (p) => {
      await O.Product.where({ category: p.category }).updateAndCount({ stock: p.stock });
      return 1;
    },
    'write.upsert': async (p) =>
      (await O.Product.upsert({
        create: { sku: p.sku, name: p.name, category: p.category, priceCents: p.price, stock: p.stock, attributes: p.attributes },
        update: { name: p.name, priceCents: p.price, stock: p.stock },
        conflictOn: { sku: p.sku },
      }))
        ? 1
        : 0,
    'write.insertDelete': async (p) => {
      const row = await O.Event.select('id').create(p);
      return (await O.Event.where({ id: row.id }).select('id').delete()) ? 2 : 1;
    },

    'tx.transfer': transfer,
    'tx.transferHot': transfer,
    'tx.checkout': async (p) =>
      db.transaction(async (tx) => {
        const order = await tx.orm.public.Order.select('id').create({ userId: p.userId, status: 'pending', totalCents: 0, metadata: { channel: 'bench' } });
        await tx.orm.public.OrderItem.createAndCount(p.items.map((i) => ({ orderId: order.id, ...i })));
        for (const i of [...p.items].sort((a, b) => a.productId - b.productId)) {
          await tx.execute(db.raw.sql`UPDATE products SET stock = stock - ${i.quantity} WHERE id = ${i.productId}`.affectedCount().build());
        }
        const total = p.items.reduce((n, i) => n + i.quantity * i.unitPriceCents, 0);
        await tx.orm.public.Order.where({ id: order.id }).updateAndCount({ totalCents: total });
        return p.items.length;
      }),
    'tx.readOnly': async (p) =>
      db.transaction(async (tx) => {
        const u = await tx.orm.public.User.first({ id: p.userId });
        const o = await tx.orm.public.Order.where({ userId: p.userId }).orderBy((x) => x.id.desc()).limit(5).all();
        const c = await tx.orm.public.Order.where({ userId: p.userId }).aggregate((a) => ({ n: a.count() }));
        return (u ? 1 : 0) + o.length + Number(c.n);
      }),
    'tx.rollback': async (p) => {
      try {
        await db.transaction(async (tx) => {
          await tx.orm.public.Transfer.createAndCount([{ fromId: p.from, toId: p.to, amountCents: 1 }]);
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
        for (const r of p.rows) n += (await tx.orm.public.Event.select('id').create(r)) ? 1 : 0;
        return n;
      }),
  };

  return { impl, close: () => db.close() };
}
