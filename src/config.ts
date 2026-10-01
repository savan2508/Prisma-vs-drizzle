export interface Profile {
  name: string;
  /** Row counts used by scripts/seed.ts */
  sizes: { users: number; products: number; orders: number; documents: number; events: number; accounts: number };
  /** Concurrency levels every workload is run at (capped per workload). */
  levels: number[];
  /** Base number of operations per (workload, level). Multiplied by each workload's `ops` factor. */
  baseOps: number;
  warmupOps: number;
  /** Safety cap per (workload, level) in seconds. If hit the result is flagged `capped`. */
  maxSeconds: number;
}

export const profiles: Record<string, Profile> = {
  quick: {
    name: 'quick',
    sizes: { users: 2_000, products: 1_000, orders: 5_000, documents: 100, events: 20_000, accounts: 200 },
    levels: [1, 10],
    baseOps: 300,
    warmupOps: 30,
    maxSeconds: 30,
  },
  standard: {
    name: 'standard',
    sizes: { users: 50_000, products: 10_000, orders: 100_000, documents: 2_000, events: 300_000, accounts: 1_000 },
    levels: [1, 10, 50],
    baseOps: 2_000,
    warmupOps: 200,
    maxSeconds: 90,
  },
  stress: {
    name: 'stress',
    sizes: { users: 200_000, products: 50_000, orders: 500_000, documents: 10_000, events: 2_000_000, accounts: 5_000 },
    levels: [1, 10, 50, 200],
    baseOps: 5_000,
    warmupOps: 500,
    maxSeconds: 180,
  },
};

export type SeedInfo = Profile['sizes'];

export const env = {
  poolSize: Number(process.env.POOL_SIZE ?? 10),
  drizzleUrl: process.env.DRIZZLE_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/bench_drizzle',
  prismaUrl: process.env.PRISMA_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/bench_prisma',
  adminUrl: process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres',
};
