import postgres from '@prisma/orm-postgres/runtime';
import { Pool } from 'pg';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

/**
 * Prisma 8's recommended Postgres driver is node-postgres (`pg`), wrapped by the
 * `@prisma/orm-postgres/runtime` facade. We hand it a pool we own so `max` matches
 * the Drizzle/Bun SQL pool exactly (the facade only exposes timeouts by name).
 */
export function createPrisma(url: string, poolSize: number) {
  const pool = new Pool({ connectionString: url, max: poolSize });
  const db = postgres<Contract>({ contractJson, pg: pool });
  return { db, pool };
}
