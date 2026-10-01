// Deterministically seeds BOTH databases with identical data, then snapshots each as
// a template (<db>_seed) so scripts/reset-dbs.ts can restore a pristine copy in ~seconds.
//   bun scripts/seed.ts --profile standard
import { SQL } from 'bun';
import { env, profiles } from '../src/config';
import { genDocument } from '../src/data/generate';

const profileName = process.argv.includes('--profile') ? process.argv[process.argv.indexOf('--profile') + 1]! : 'quick';
const profile = profiles[profileName];
if (!profile) throw new Error(`unknown profile ${profileName}`);
const n = profile.sizes;

const targets = [
  { name: 'bench_drizzle', url: env.drizzleUrl },
  { name: 'bench_prisma', url: env.prismaUrl },
];

const SQL_BLOCKS: ((db: SQL, from: number, to: number) => Promise<unknown>)[] = [];

const countries = `ARRAY['US','DE','FR','GB','IN','BR','JP','CA','AU','ES','IT','NL']`;
const statuses = `ARRAY['pending','paid','shipped','delivered','cancelled']`;
const kinds = `ARRAY['page_view','click','purchase','login','logout','search','add_to_cart','remove_from_cart','signup','error','share','download']`;
const oses = `ARRAY['ios','android','windows','macos','linux']`;

async function seedChunked(db: SQL, total: number, chunk: number, fn: (from: number, to: number) => string) {
  for (let from = 1; from <= total; from += chunk) {
    await db.unsafe(fn(from, Math.min(total, from + chunk - 1)));
  }
}

async function seed(target: { name: string; url: string }) {
  const db = new SQL({ url: target.url, max: 2 });
  const t0 = performance.now();
  await db.unsafe(`TRUNCATE users, products, orders, order_items, documents, events, accounts, transfers RESTART IDENTITY CASCADE`);

  await seedChunked(db, n.users, 50_000, (a, b) => `
    INSERT INTO users (email, name, country, age, profile, created_at)
    SELECT 'user' || i || '@example.com', 'User ' || i, (${countries})[1 + i % 12], 18 + (i * 7) % 60,
           jsonb_build_object('plan', (ARRAY['free','pro','team'])[1 + i % 3],
                              'tags', jsonb_build_array('t' || (i % 10), 't' || (i % 7)),
                              'prefs', jsonb_build_object('theme', (ARRAY['dark','light'])[1 + i % 2], 'notifications', i % 2 = 0)),
           timestamptz '2024-01-01' + (i % 100000) * interval '1 minute'
    FROM generate_series(${a}, ${b}) AS i`);

  await seedChunked(db, n.products, 50_000, (a, b) => `
    INSERT INTO products (sku, name, category, price_cents, stock, attributes, created_at)
    SELECT 'SKU-' || lpad(i::text, 7, '0'),
           (ARRAY['Deluxe','Compact','Ultra','Classic','Smart','Eco'])[1 + i % 6] || ' ' ||
           (ARRAY['Widget','Gadget','Gizmo','Doohickey','Sprocket'])[1 + i % 5] || ' ' || i,
           'cat-' || lpad((i % 20)::text, 2, '0'), 100 + (i * 37) % 50000, 100 + i % 900,
           jsonb_build_object('color', (ARRAY['red','green','blue','black','white','grey','pink','teal'])[1 + i % 8],
                              'size', (ARRAY['XS','S','M','L','XL'])[1 + i % 5],
                              'brand', 'brand-' || (i % 50),
                              'specs', jsonb_build_object('weight_g', 50 + i % 2000, 'warranty_months', 6 * (1 + i % 4)),
                              'tags', jsonb_build_array('tag' || (i % 13), 'tag' || (i % 17))),
           timestamptz '2024-01-01' + (i % 50000) * interval '1 minute'
    FROM generate_series(${a}, ${b}) AS i`);

  await seedChunked(db, n.orders, 50_000, (a, b) => `
    INSERT INTO orders (user_id, status, total_cents, metadata, created_at)
    SELECT 1 + (i * 7919) % ${n.users}, (${statuses})[1 + i % 5], 500 + (i * 131) % 100000,
           jsonb_build_object('channel', (ARRAY['web','ios','android','pos'])[1 + i % 4],
                              'coupon', CASE WHEN i % 5 = 0 THEN 'SAVE' || (i % 20) ELSE NULL END,
                              'ip', '10.' || (i % 255) || '.' || ((i / 255) % 255) || '.1'),
           timestamptz '2024-01-01' + i * interval '30 seconds'
    FROM generate_series(${a}, ${b}) AS i`);

  await seedChunked(db, n.orders * 3, 100_000, (a, b) => `
    INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
    SELECT 1 + (j - 1) / 3, 1 + (j * 104729) % ${n.products}, 1 + j % 5, 100 + (j % 900) * 10
    FROM generate_series(${a}, ${b}) AS j`);

  await seedChunked(db, n.events, 25_000, (a, b) => `
    INSERT INTO events (user_id, kind, payload, created_at)
    SELECT 1 + (i * 104729) % ${n.users}, (${kinds})[1 + i % 12],
           jsonb_build_object(
             'device', jsonb_build_object('os', (${oses})[1 + (i / 3) % 5], 'model', 'm-' || (i % 200), 'version', (i % 15) || '.' || (i % 10)),
             'geo', jsonb_build_object('country', (${countries})[1 + (i / 7) % 12], 'city', 'city-' || (i % 500), 'lat', (i % 18000) / 100.0 - 90, 'lon', (i % 36000) / 100.0 - 180),
             'session', jsonb_build_object('id', md5(i::text), 'referrer', (ARRAY['google','direct','twitter','newsletter'])[1 + i % 4], 'duration_ms', 10 + (i * 31) % 600000),
             'items', jsonb_build_array(
                jsonb_build_object('sku', 'SKU-' || lpad((1 + i % 9999)::text, 7, '0'), 'qty', 1 + i % 5, 'price', 100 + (i * 13) % 99000, 'tags', jsonb_build_array('promo', 'a')),
                jsonb_build_object('sku', 'SKU-' || lpad((1 + (i * 3) % 9999)::text, 7, '0'), 'qty', 1 + (i / 5) % 5, 'price', 100 + (i * 17) % 99000, 'tags', jsonb_build_array('new', 'b')),
                jsonb_build_object('sku', 'SKU-' || lpad((1 + (i * 7) % 9999)::text, 7, '0'), 'qty', 1 + (i / 7) % 5, 'price', 100 + (i * 19) % 99000, 'tags', jsonb_build_array('sale', 'c'))),
             'tags', jsonb_build_array((ARRAY['promo','organic','paid','vip'])[1 + i % 4], (ARRAY['mobile','desktop'])[1 + i % 2]),
             'metrics', jsonb_build_object('ttfb', 5 + i % 900, 'dom', 50 + (i * 3) % 4000, 'cls', (i % 100) / 100.0),
             'flags', jsonb_build_object('beta', i % 3 = 0, 'returning', i % 5 < 3, 'consent', i % 10 <> 0),
             'note', repeat('lorem ipsum dolor sit amet ', 1 + i % 8)),
           timestamptz '2024-01-01' + i * interval '1 second'
    FROM generate_series(${a}, ${b}) AS i`);

  await db.unsafe(`
    INSERT INTO accounts (owner, balance_cents)
    SELECT 'owner-' || i, 1000000 FROM generate_series(1, ${n.accounts}) AS i`);

  // HTML documents (bigger, generated in TS; deterministic per index).
  const batch = 25;
  for (let start = 1; start <= n.documents; start += batch) {
    const docs = [];
    for (let i = start; i < Math.min(n.documents + 1, start + batch); i++) {
      const g = genDocument(i, `doc-${i}`, 20_000 + (i % 5) * 10_000);
      docs.push({ slug: g.slug, title: g.title, author_id: 1 + (i * 31) % n.users, html: g.html, plain_text: g.plainText, word_count: g.wordCount });
    }
    await db`INSERT INTO documents ${db(docs, 'slug', 'title', 'author_id', 'html', 'plain_text', 'word_count')}`;
  }

  await db.unsafe('VACUUM (ANALYZE)');
  const [{ total }] = await db.unsafe(`SELECT pg_size_pretty(pg_database_size(current_database())) AS total`);
  await db.close();
  console.log(`seeded ${target.name} in ${((performance.now() - t0) / 1000).toFixed(1)}s (db size ${total})`);
}

console.log(`profile=${profile.name}`, n);
await Promise.all(targets.map(seed));

// snapshot templates
const admin = new SQL({ url: env.adminUrl, max: 1 });
for (const t of targets) {
  const tpl = `${t.name}_seed`;
  if ((await admin`SELECT 1 FROM pg_database WHERE datname = ${tpl}`).length) {
    await admin.unsafe(`ALTER DATABASE "${tpl}" WITH IS_TEMPLATE false ALLOW_CONNECTIONS true`);
    await admin.unsafe(`DROP DATABASE "${tpl}" WITH (FORCE)`);
  }
  await admin.unsafe(`CREATE DATABASE "${tpl}" TEMPLATE "${t.name}"`);
  await admin.unsafe(`ALTER DATABASE "${tpl}" WITH ALLOW_CONNECTIONS false IS_TEMPLATE true`);
  console.log(`snapshot -> ${tpl}`);
}
await admin.close();
