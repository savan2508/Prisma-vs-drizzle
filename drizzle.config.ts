import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/drizzle/schema.ts',
  dbCredentials: { url: process.env.DRIZZLE_DATABASE_URL! },
});
