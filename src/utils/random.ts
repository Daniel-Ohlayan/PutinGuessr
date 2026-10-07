/**
 * Детерминированный ГПСЧ (mulberry32) и утилиты на его основе.
 * Нужен для сидированных игр: один и тот же сид — один и тот же
 * расклад панорам у обоих игроков дуэли.
 */

export type Rng = () => number;

/** FNV-1a (32 бита) — стабильный хэш строки сида в зерно ГПСЧ. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Классический mulberry32: быстрый и с хорошим распределением. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ГПСЧ по строковому сиду. Один сид — один и тот же поток чисел. */
export function createRng(seed: string): Rng {
  return mulberry32(hashSeed(seed));
}

const SEED_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // без похожих символов (i, l, o, 0, 1)

/** Случайный сид для дуэли: 8 символов из криптостойкого источника. */
export function randomSeed(length = 8): string {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  let seed = '';
  for (let i = 0; i < length; i++) {
    seed += SEED_ALPHABET[values[i] % SEED_ALPHABET.length];
  }
  return seed;
}

/** Копия массива, перемешанная по Фишеру-Йетсу с заданным ГПСЧ. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
