import type { LatLng } from '../utils/geo';

/**
 * Пул предзаготовленных точек панорам: public/data/pools/<id>.json.
 * Собирается скриптом scripts/crawl-pool.mjs (см. README) — через публичный
 * HTTP-эндпоинт Яндекс.Панорам, поэтому сбор пула не тратит квоту JS API ключа.
 *
 * Зачем пул: в сидированной игре (дуэли) точка панорамы берётся из пула,
 * а в рантайме выполняется ровно один вызов locate по точной позиции —
 * вместо перебора до 30 попыток живого поиска. Точки у обоих игроков
 * гарантированно совпадают.
 */
export interface PanoramaPool {
  pool: string;
  version: number;
  updated?: string;
  /** Точные позиции панорам: [широта, долгота]. */
  points: LatLng[];
}

const cache = new Map<string, Promise<LatLng[] | null>>();

async function fetchPool(id: string): Promise<LatLng[] | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/pools/${id}.json`);
    if (!response.ok) return null;
    const pool = (await response.json()) as PanoramaPool;
    return Array.isArray(pool.points) && pool.points.length > 0 ? pool.points : null;
  } catch {
    return null;
  }
}

/** Точки пула или null, если пула нет/пуст (тогда игра ищет панорамы живым поиском). */
export function loadPool(id: string): Promise<LatLng[] | null> {
  let promise = cache.get(id);
  if (!promise) {
    promise = fetchPool(id);
    cache.set(id, promise);
    promise.catch(() => cache.delete(id));
  }
  return promise;
}
