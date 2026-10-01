import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { relations } from './schema';

const makeBun = (client: SQL) => drizzle({ client, relations });
export type Db = ReturnType<typeof makeBun>;

/** Drizzle RC on Bun's native Postgres driver (`Bun.SQL`). */
export function createDrizzle(url: string, poolSize: number) {
  const client = new SQL({ url, max: poolSize });
  return { db: makeBun(client), close: () => client.close() };
}

/**
 * DIAGNOSTIC ONLY: the same Drizzle query-builder code over node-postgres, i.e. the exact driver
 * Prisma 8 uses. Comparing drizzle(bun) vs drizzle(pg) isolates the driver; drizzle(pg) vs prisma
 * isolates the ORM layer. The builder API is driver-agnostic, hence the cast.
 */
export function createDrizzleOnPg(url: string, poolSize: number) {
  const pool = new Pool({ connectionString: url, max: poolSize });
  const db = drizzlePg({ client: pool, relations });
  return { db: db as unknown as Db, close: () => pool.end() };
}
