import { loadPool } from '../data/pools';
import { distanceMeters, type LatLng } from '../utils/geo';
import { createRng, shuffled, type Rng } from '../utils/random';
import { TOTAL_ROUNDS } from './gameSession';
import type { GameRegion } from './region';

/** Точек-кандидатов при живом поиске закладываем с запасом: раунд может не разрезолвиться с первой точки. */
const FALLBACK_CANDIDATES = 60;
const FALLBACK_SAMPLES = 600;

/**
 * План раундов для сидированной игры (дуэли): один сид — один и тот же
 * набор точек у обоих игроков.
 *
 * Приоритет: точки из пула предзаготовленных панорам (быстро, один вызов
 * API на раунд, точки навсегда одинаковые). Если пула нет или он пуст —
 * детерминированные точки от сидированного ГПСЧ, каждая из которых потом
 * разрезолвивается в панораму живым поиском (findPanoramaAt).
 */
export async function createRoundPlan(region: GameRegion, seed: string): Promise<LatLng[]> {
  const rng = createRng(seed);
  if (region.poolId) {
    const pool = await loadPool(region.poolId);
    if (pool && pool.length >= TOTAL_ROUNDS) {
      const picked = pickSeparated(pool, rng, TOTAL_ROUNDS, region.minSeparation);
      if (picked.length >= TOTAL_ROUNDS) return picked;
    }
  }
  const sample = region.createSampler(createRng(`${seed}:candidates`));
  const candidates: LatLng[] = [];
  for (let i = 0; i < FALLBACK_SAMPLES && candidates.length < FALLBACK_CANDIDATES; i++) {
    const point = sample();
    if (!point) continue;
    if (candidates.some((c) => distanceMeters(c, point) < region.minSeparation)) continue;
    candidates.push(point);
  }
  return candidates;
}

/** n точек из пула с минимальной дистанцией между ними; порядок — сидированный. */
function pickSeparated(pool: LatLng[], rng: Rng, count: number, minSeparation: number): LatLng[] {
  const picked: LatLng[] = [];
  for (const point of shuffled(pool, rng)) {
    if (picked.length >= count) break;
    if (picked.some((p) => distanceMeters(p, point) < minSeparation)) continue;
    picked.push(point);
  }
  return picked;
}
