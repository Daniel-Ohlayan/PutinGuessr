import type { DuelInfo, RoundResult } from '../game/gameSession';
import type { RegionSelection } from '../game/region';

/** Регион дуэли по умолчанию (пока дуэли доступны только по всей России). */
export const DUEL_REGION = 'russia';

/** Результат дуэли в компактном виде — вшивается в ссылку результата. */
export interface DuelResultPayload {
  v: 1;
  /** Общий счёт. */
  t: number;
  /** По раундам: [ошибка в метрах, очки]. */
  r: [number, number][];
}

/** Абсолютная ссылка на хэш-маршрут (для буфера обмена). */
export function absoluteHashUrl(hash: string): string {
  return `${location.origin}${location.pathname}${hash}`;
}

export function buildDuelHash(duel: DuelInfo): string {
  return `#duel/${duel.region}/${duel.seed}`;
}

export function buildDuelResultHash(duel: DuelInfo, payload: DuelResultPayload): string {
  return `#duel-result/${duel.region}/${duel.seed}/${encodePayload(payload)}`;
}

/** Ключ региона из ссылки на дуэль → режим игры. null — регион неизвестен. */
export function duelSelection(region: string): RegionSelection | null {
  if (region === 'russia') return { kind: 'russia' };
  return null;
}

export function buildDuelResultPayload(results: RoundResult[]): DuelResultPayload {
  return {
    v: 1,
    t: results.reduce((sum, r) => sum + r.score, 0),
    r: results.map((r) => [Math.round(r.distance), Math.round(r.score)]),
  };
}

/** JSON результата → base64url (без паддинга), чтобы ссылка была короткой. */
export function encodePayload(payload: DuelResultPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePayload(encoded: string): DuelResultPayload | null {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as DuelResultPayload;
    if (payload?.v !== 1 || typeof payload.t !== 'number' || !Array.isArray(payload.r)) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ---------- Свой результат дуэли в localStorage ---------- */

const storageKey = (duel: DuelInfo): string => `pitinguessr.duel.${duel.region}.${duel.seed}`;

export function saveDuelResult(duel: DuelInfo, payload: DuelResultPayload): void {
  try {
    localStorage.setItem(storageKey(duel), JSON.stringify(payload));
  } catch {
    /* localStorage недоступен */
  }
}

export function loadDuelResult(duel: DuelInfo): DuelResultPayload | null {
  try {
    const raw = localStorage.getItem(storageKey(duel));
    if (!raw) return null;
    const payload = JSON.parse(raw) as DuelResultPayload;
    return payload?.v === 1 && typeof payload.t === 'number' && Array.isArray(payload.r) ? payload : null;
  } catch {
    return null;
  }
}

/* ---------- Ввод при присоединении к дуэли ---------- */

/**
 * Принимает ссылку целиком, «#duel/russia/<сид>», «russia/<сид>»,
 * «russia:<сид>» или просто сид. null — не похоже на дуэль.
 */
export function parseDuelInput(input: string): DuelInfo | null {
  const text = input.trim();
  if (!text) return null;
  const fromUrl = text.match(/#duel\/([^/\s?]+)\/([^/\s?#]+)/);
  if (fromUrl) return { region: fromUrl[1], seed: fromUrl[2] };
  const short = text.match(/^([a-z0-9-]+)[:/]([A-Za-z0-9]{4,16})$/);
  if (short) return { region: short[1], seed: short[2] };
  if (/^[A-Za-z0-9]{6,12}$/.test(text)) return { region: DUEL_REGION, seed: text };
  return null;
}
