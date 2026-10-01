/** Small deterministic PRNG (mulberry32) so both ORMs see identical parameter streams. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
  /** Zipf-ish: low indexes much more likely. */
  skewed(n: number): number {
    return Math.min(n - 1, Math.floor(n * this.next() ** 3));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** FNV-1a string hash -> seed */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const c of parts.join('|')) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
