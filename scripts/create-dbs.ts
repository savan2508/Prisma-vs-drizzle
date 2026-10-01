// Creates (or recreates with --reset) one empty database per ORM.
import { SQL } from 'bun';

const admin = new SQL(process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres');
const reset = process.argv.includes('--reset');

for (const name of ['bench_drizzle', 'bench_prisma']) {
  const exists = (await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`).length > 0;
  if (exists && reset) {
    await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  if (!exists || reset) {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    console.log(`created ${name}`);
  } else {
    console.log(`${name} already exists (use --reset to recreate)`);
  }
}
await admin.close();
