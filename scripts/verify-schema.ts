// Proves both databases are physically equivalent (columns, indexes, FKs),
// ignoring index/constraint *names* and column order. Exit code 1 on drift.
import { SQL } from 'bun';

const urls = {
  drizzle: process.env.DRIZZLE_DATABASE_URL!,
  prisma: process.env.PRISMA_DATABASE_URL!,
};

async function describe(url: string) {
  const db = new SQL(url);
  const cols = await db`
    SELECT table_name, column_name, data_type, is_nullable,
           COALESCE(regexp_replace(column_default, '\\s+', '', 'g'), '') AS dflt
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name`;
  const idx = await db`
    SELECT tablename, regexp_replace(indexdef, 'INDEX \\S+ ON', 'INDEX <name> ON') AS def
    FROM pg_indexes WHERE schemaname = 'public'`;
  const fks = await db`
    SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`;
  await db.close();
  const out = new Set<string>();
  for (const c of cols) out.add(`COL ${c.table_name}.${c.column_name} ${c.data_type} null=${c.is_nullable} default=${c.dflt}`);
  for (const i of idx) out.add(`IDX ${i.tablename} ${i.def}`);
  for (const f of fks) out.add(`FK ${f.tbl} ${f.def}`);
  return out;
}

const [d, p] = await Promise.all([describe(urls.drizzle), describe(urls.prisma)]);
const onlyD = [...d].filter((x) => !p.has(x));
const onlyP = [...p].filter((x) => !d.has(x));
if (!onlyD.length && !onlyP.length) {
  console.log(`schema OK: ${d.size} identical column/index/fk facts in both databases`);
} else {
  console.error('SCHEMA DRIFT');
  onlyD.forEach((x) => console.error('  drizzle only:', x));
  onlyP.forEach((x) => console.error('  prisma  only:', x));
  process.exit(1);
}
