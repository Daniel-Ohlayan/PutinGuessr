import { decodePayload, type DuelResultPayload } from './duel/duel';
import type { DuelInfo } from './game/gameSession';

export type Route =
  | { kind: 'start' }
  | ({ kind: 'duel' } & DuelInfo)
  | ({ kind: 'duelResult' } & DuelInfo & { payload: DuelResultPayload });

/**
 * Разбор location.hash:
 * «#/» — стартовый экран,
 * «#duel/russia/<сид>» — сидированная игра (дуэль),
 * «#duel-result/russia/<сид>/<результат>» — сравнение результатов дуэли.
 */
export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#/, '');
  const duel = clean.match(/^duel\/([^/]+)\/([^/]+)\/?$/);
  if (duel) return { kind: 'duel', region: duel[1], seed: duel[2] };
  const result = clean.match(/^duel-result\/([^/]+)\/([^/]+)\/([^/]+)\/?$/);
  if (result) {
    const payload = decodePayload(result[3]);
    if (payload) return { kind: 'duelResult', region: result[1], seed: result[2], payload };
  }
  return { kind: 'start' };
}

export function watchHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}
