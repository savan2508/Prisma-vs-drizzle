import { index, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { defineRelations } from 'drizzle-orm';

// Timestamps use string mode on both sides (Prisma: TimestamptzString) so neither
// ORM pays for Date/Temporal construction and the decoded shapes are comparable.
const createdAt = (name = 'created_at') =>
  timestamp(name, { withTimezone: true, mode: 'string' }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    country: text('country').notNull(),
    age: integer('age').notNull(),
    profile: jsonb('profile').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('users_country_idx').on(t.country)],
);

export const products = pgTable(
  'products',
  {
    id: serial('id').primaryKey(),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    priceCents: integer('price_cents').notNull(),
    stock: integer('stock').notNull(),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('products_category_price_cents_idx').on(t.category, t.priceCents),
    index('products_attributes_gin').using('gin', t.attributes),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull(),
    totalCents: integer('total_cents').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('orders_user_id_idx').on(t.userId), index('orders_status_created_at_idx').on(t.status, t.createdAt)],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
  },
  (t) => [index('order_items_order_id_idx').on(t.orderId), index('order_items_product_id_idx').on(t.productId)],
);

export const documents = pgTable(
  'documents',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    authorId: integer('author_id')
      .notNull()
      .references(() => users.id),
    html: text('html').notNull(),
    plainText: text('plain_text').notNull(),
    wordCount: integer('word_count').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [
    index('documents_author_id_idx').on(t.authorId),
    index('documents_published_at_idx').on(t.publishedAt),
    index('documents_plain_text_fts').using('gin', sql`to_tsvector('english', ${t.plainText})`),
  ],
);

export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('events_kind_created_at_idx').on(t.kind, t.createdAt),
    index('events_user_id_idx').on(t.userId),
    index('events_payload_gin').using('gin', t.payload),
  ],
);

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  owner: text('owner').notNull(),
  balanceCents: integer('balance_cents').notNull(),
  version: integer('version').notNull().default(0),
});

export const transfers = pgTable(
  'transfers',
  {
    id: serial('id').primaryKey(),
    fromId: integer('from_id').notNull(),
    toId: integer('to_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('transfers_from_id_idx').on(t.fromId), index('transfers_to_id_idx').on(t.toId)],
);

export const schema = { users, products, orders, orderItems, documents, events, accounts, transfers };

export const relations = defineRelations(schema, (r) => ({
  users: {
    orders: r.many.orders({ from: r.users.id, to: r.orders.userId }),
    documents: r.many.documents({ from: r.users.id, to: r.documents.authorId }),
  },
  orders: {
    user: r.one.users({ from: r.orders.userId, to: r.users.id }),
    items: r.many.orderItems({ from: r.orders.id, to: r.orderItems.orderId }),
  },
  orderItems: {
    order: r.one.orders({ from: r.orderItems.orderId, to: r.orders.id }),
    product: r.one.products({ from: r.orderItems.productId, to: r.products.id }),
  },
  documents: {
    author: r.one.users({ from: r.documents.authorId, to: r.users.id }),
  },
}));
