import { Rng } from './rng';

export const COUNTRIES = ['US', 'DE', 'FR', 'GB', 'IN', 'BR', 'JP', 'CA', 'AU', 'ES', 'IT', 'NL'] as const;
export const CATEGORIES = Array.from({ length: 20 }, (_, i) => `cat-${String(i).padStart(2, '0')}`);
export const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'] as const;
export const EVENT_KINDS = [
  'page_view', 'click', 'purchase', 'login', 'logout', 'search',
  'add_to_cart', 'remove_from_cart', 'signup', 'error', 'share', 'download',
] as const;
export const OSES = ['ios', 'android', 'windows', 'macos', 'linux'] as const;

// --- text -----------------------------------------------------------------
const COMMON = ('the of and to in is that for it as with was on are by this be from or have an they which one you ' +
  'were all we can her has there been if more when will would who so no what up out about into than them only other ' +
  'new some could time these two may then do first any my now such like our over man me even most made after also did ' +
  'many before must through back years where much your way well down should because each just those people how too').split(' ');

const SYL = ['ka', 'zo', 'ri', 'mu', 'te', 'va', 'lo', 'ne', 'qui', 'dra', 'sho', 'pel', 'fin', 'gar', 'bex', 'yo'];
/**
 * 20,000 unique pseudo-words (5 base-16 syllable digits, injective => unique). Low indexes are the
 * "common" end of the Zipf-ish distribution used by genDocument(); high indexes are rare terms.
 */
export const VOCAB: string[] = Array.from({ length: 20_000 }, (_, i) => {
  let w = '';
  for (let d = 0, x = i; d < 5; d++, x >>= 4) w += SYL[x & 15];
  return w;
});

export function sentence(rng: Rng, words = rng.int(8, 18)): string {
  const w: string[] = [];
  for (let i = 0; i < words; i++) w.push(rng.chance(0.45) ? rng.pick(COMMON) : VOCAB[rng.skewed(VOCAB.length)]!);
  const s = w.join(' ');
  return s[0]!.toUpperCase() + s.slice(1) + '.';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface GeneratedDoc {
  slug: string;
  title: string;
  html: string;
  plainText: string;
  wordCount: number;
}

/**
 * A realistic-ish CMS article: headings, paragraphs with inline markup/entities/quotes/unicode,
 * lists, a table, links, an inline <style> + <script> block. `targetBytes` controls HTML size.
 */
export function genDocument(seedKey: number, slug: string, targetBytes = 30_000): GeneratedDoc {
  const rng = new Rng(Math.imul(seedKey + 1, 2654435761));
  const title = sentence(rng, 6).replace(/\.$/, '');
  const html: string[] = [];
  const text: string[] = [title];
  html.push(`<article lang="en" data-doc="${esc(slug)}"><style>.lead{font:16px/1.5 "Inter",sans-serif}</style>`);
  html.push(`<h1 class="lead">${esc(title)}</h1>`);
  let bytes = html.join('').length;
  let n = 0;
  while (bytes < targetBytes) {
    const kind = n++ % 6;
    let chunk = '';
    if (kind === 0) {
      const h = sentence(rng, 5).replace(/\.$/, '');
      chunk = `<h2 id="s${n}">${esc(h)}</h2>`;
      text.push(h);
    } else if (kind === 3) {
      const items = Array.from({ length: rng.int(3, 7) }, () => sentence(rng, 6));
      chunk = `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
      text.push(...items);
    } else if (kind === 4) {
      const rows = Array.from({ length: rng.int(3, 6) }, () => [sentence(rng, 2), String(rng.int(1, 9999))] as const);
      chunk = `<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>${rows
        .map(([a, b]) => `<tr><td>${esc(a)}</td><td>${b}</td></tr>`)
        .join('')}</tbody></table>`;
      text.push(...rows.map(([a, b]) => `${a} ${b}`));
    } else {
      const s1 = sentence(rng), s2 = sentence(rng), s3 = sentence(rng, 5);
      chunk =
        `<p>${esc(s1)} <strong>${esc(s3)}</strong> ${esc(s2)} ` +
        `<a href="https://example.com/${rng.int(1, 99999)}?a=1&amp;b=2" title="“quoted”">link → café</a> ` +
        `<img src="/img/${rng.int(1, 999)}.png" alt="${esc(s3)}" loading="lazy"/> &copy; ☃ 🚀</p>`;
      text.push(s1, s3, s2);
    }
    html.push(chunk);
    bytes += chunk.length;
  }
  html.push(`<script type="application/json">{"doc":"${esc(slug)}","n":${n}}</script></article>`);
  const plainText = text.join('\n');
  return { slug, title, html: html.join('\n'), plainText, wordCount: plainText.split(/\s+/).length };
}

// --- jsonb payloads ---------------------------------------------------------
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type EventPayload = { [k: string]: Json };

/** `approxBytes` ~ serialized JSON size (1_000 = typical event, 100_000 = large blob). */
export function genPayload(rng: Rng, approxBytes = 1_000): EventPayload {
  const p: EventPayload = {
    device: { os: rng.pick(OSES), model: `m-${rng.int(1, 200)}`, version: `${rng.int(1, 15)}.${rng.int(0, 9)}` },
    geo: { country: rng.pick(COUNTRIES), city: `city-${rng.int(1, 500)}`, lat: rng.int(-9000, 9000) / 100, lon: rng.int(-18000, 18000) / 100 },
    session: { id: rng.int(1, 1e9).toString(36) + rng.int(1, 1e9).toString(36), referrer: rng.pick(['google', 'direct', 'twitter', 'newsletter']), duration_ms: rng.int(10, 600_000) },
    items: Array.from({ length: 3 }, () => ({
      sku: `SKU-${String(rng.int(1, 9999)).padStart(7, '0')}`,
      qty: rng.int(1, 5),
      price: rng.int(100, 99_999),
      tags: [rng.pick(['promo', 'new', 'sale', 'gift']), rng.pick(['a', 'b', 'c'])],
    })),
    tags: [rng.pick(['promo', 'organic', 'paid', 'vip']), rng.pick(['mobile', 'desktop'])],
    metrics: { ttfb: rng.int(5, 900), dom: rng.int(50, 4000), cls: rng.int(0, 100) / 100 },
    flags: { beta: rng.chance(0.3), returning: rng.chance(0.6), consent: rng.chance(0.9) },
    note: '',
  };
  let size = JSON.stringify(p).length;
  const blob: Json[] = [];
  while (size < approxBytes) {
    const entry = { id: rng.int(1, 1e9), label: sentence(rng, 5), vals: [rng.int(0, 999), rng.int(0, 999), rng.int(0, 999)], nested: { k: sentence(rng, 3) } };
    blob.push(entry);
    size += JSON.stringify(entry).length + 1;
  }
  if (blob.length) p['blob'] = blob;
  return p;
}
