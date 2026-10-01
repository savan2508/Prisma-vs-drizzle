// Restores both working databases from their pristine seed templates (fast file-level copy).
import { SQL } from 'bun';
import { env } from '../src/config';

const admin = new SQL({ url: env.adminUrl, max: 1 });
for (const name of ['bench_drizzle', 'bench_prisma']) {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${name}_seed"`);
}
await admin.close();
console.log('databases reset from templates');
