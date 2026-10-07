import {
  distanceMeters,
  isInsideGeometry,
  randomPointInGeometry,
  randomPointInGeometryWithRng,
  type CityGeometry,
  type LatLng,
} from '../utils/geo';
import { countPanoramaCall, FREE_PANORAMA_LIMIT, getPanoramaCallsToday } from '../utils/quota';

export const MAX_ATTEMPTS = 30;
/**
 * Радиус поиска панорамы вокруг случайной точки в режиме города, м.
 * Бесплатный ключ даёт всего 100 вызовов панорам в сутки, поэтому радиус увеличен
 * со 150 до 400 м: попаданий больше, лишних запросов меньше. Панорама всё равно
 * обязана лежать строго внутри границ города.
 */
export const CITY_SEARCH_RADIUS = 400;
/**
 * Попытки выполняются строго по одной: каждый вызов locate расходует
 * бесплатный суточный лимит, параллельные запросы тратили бы его впустую.
 */
const PARALLEL_ATTEMPTS = 1;
const LOCATE_TIMEOUT_MS = 10000;

export interface FoundPanorama {
  panorama: ymaps.panorama.IPanorama;
  position: LatLng;
}

export interface RandomPanoramaOptions {
  /** Точки, рядом с которыми нельзя брать панораму (уже сыгранные раунды). */
  exclude?: LatLng[];
  /** Минимальное расстояние до исключённых точек, м. */
  minSeparation?: number;
  /** ГПСЧ для детерминированного поиска (сидированные игры); по умолчанию Math.random. */
  rng?: () => number;
}

export interface PanoramaSearchParams extends RandomPanoramaOptions {
  /** Граница, внутри которой обязана находиться панорама. */
  boundary: CityGeometry;
  /** Генератор случайной точки-кандидата. */
  samplePoint: () => LatLng | null;
  /** Допустимое расстояние от точки до найденной панорамы, м. */
  radius: number;
  maxAttempts?: number;
}

export class PanoramaSearchError extends Error {
  constructor(
    message: string,
    readonly reason: 'not-found' | 'api' | 'unsupported',
    /** Технические подробности от API (для диагностики). */
    readonly details = '',
  ) {
    super(message);
    this.name = 'PanoramaSearchError';
  }
}

type AttemptResult = { status: 'found'; value: FoundPanorama } | { status: 'empty' } | { status: 'error'; message: string };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; status?: unknown };
    if (typeof e.message === 'string') return e.message;
    try {
      return JSON.stringify(error).slice(0, 200);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/** Если подряд столько ошибок API и ни одного ответа — прекращаем, не тратя лимит. */
const FAIL_FAST_ERRORS = 3;

async function attempt(params: Required<PanoramaSearchParams>): Promise<AttemptResult> {
  const point = params.samplePoint();
  if (!point) return { status: 'empty' };

  let panoramas: ymaps.panorama.IPanorama[];
  countPanoramaCall();
  try {
    panoramas = await withTimeout(
      Promise.resolve(ymaps.panorama.locate(point, { layer: 'yandex#panorama' })),
      LOCATE_TIMEOUT_MS,
    );
  } catch (error) {
    const message = describeError(error);
    console.error('[PitinGuessr] ymaps.panorama.locate:', error);
    return { status: 'error', message };
  }

  for (const panorama of panoramas ?? []) {
    const raw = panorama.getPosition();
    const position: LatLng = [raw[0], raw[1]];
    if (distanceMeters(point, position) > params.radius) continue;
    // Сама панорама обязана лежать внутри границы, даже если точка была у самого края.
    if (!isInsideGeometry(position, params.boundary)) continue;
    if (params.exclude.some((p) => distanceMeters(p, position) < params.minSeparation)) continue;
    return { status: 'found', value: { panorama, position } };
  }
  return { status: 'empty' };
}

/** Универсальный поиск случайной наземной панорамы внутри границы. */
export async function findRandomPanorama(params: PanoramaSearchParams): Promise<FoundPanorama> {
  if (!ymaps.panorama.isSupported()) {
    throw new PanoramaSearchError(
      'Ваш браузер не поддерживает Яндекс.Панорамы. Попробуйте другой браузер.',
      'unsupported',
    );
  }

  const full: Required<PanoramaSearchParams> = {
    exclude: [],
    minSeparation: 500,
    maxAttempts: MAX_ATTEMPTS,
    rng: Math.random,
    ...params,
  };
  let done = 0;
  let apiErrors = 0;
  let answered = 0;
  let lastError = '';

  while (done < full.maxAttempts) {
    const batch = Math.min(PARALLEL_ATTEMPTS, full.maxAttempts - done);
    const results = await Promise.all(Array.from({ length: batch }, () => attempt(full)));
    done += batch;

    for (const result of results) {
      if (result.status === 'found') return result.value;
      if (result.status === 'error') {
        apiErrors++;
        lastError = result.message;
      } else {
        answered++;
      }
    }
    if (answered === 0 && apiErrors >= FAIL_FAST_ERRORS) break;
  }

  if (answered === 0 && apiErrors > 0) {
    const overLimit = getPanoramaCallsToday() >= FREE_PANORAMA_LIMIT;
    throw new PanoramaSearchError(
      overLimit
        ? 'Похоже, исчерпан суточный лимит панорам бесплатного ключа (100 запросов). Лимит обновится завтра.'
        : 'Сервис Яндекс.Панорам не отвечает. Проверьте подключение к интернету и API-ключ.',
      'api',
      lastError,
    );
  }
  throw new PanoramaSearchError(
    `Не удалось найти панораму за ${full.maxAttempts} попыток.`,
    'not-found',
  );
}

/**
 * Панорама рядом с конкретной точкой (для пула/сидированных игр):
 * ровно один вызов locate, без перебора попыток. null — рядом нет панорамы.
 * По точной позиции из пула locate возвращает ту же панораму, что и при сборе.
 */
export async function findPanoramaAtPosition(
  point: LatLng,
  boundary: CityGeometry,
  radius: number,
): Promise<FoundPanorama | null> {
  if (!ymaps.panorama.isSupported()) {
    throw new PanoramaSearchError(
      'Ваш браузер не поддерживает Яндекс.Панорамы. Попробуйте другой браузер.',
      'unsupported',
    );
  }
  countPanoramaCall();
  let panoramas: ymaps.panorama.IPanorama[];
  try {
    panoramas = await withTimeout(
      Promise.resolve(ymaps.panorama.locate(point, { layer: 'yandex#panorama' })),
      LOCATE_TIMEOUT_MS,
    );
  } catch (error) {
    throw new PanoramaSearchError(
      'Сервис Яндекс.Панорам не отвечает. Проверьте подключение к интернету и API-ключ.',
      'api',
      describeError(error),
    );
  }
  for (const panorama of panoramas ?? []) {
    const raw = panorama.getPosition();
    const position: LatLng = [raw[0], raw[1]];
    if (distanceMeters(point, position) > radius) continue;
    if (!isInsideGeometry(position, boundary)) continue;
    return { panorama, position };
  }
  return null;
}

/**
 * Случайная панорама строго внутри полигона города:
 * turf.randomPoint в bbox → booleanPointInPolygon → ymaps.panorama.locate, радиус 150 м.
 */
export function getRandomPanoramaInCity(
  polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  options: RandomPanoramaOptions = {},
): Promise<FoundPanorama> {
  return findRandomPanorama({
    ...options,
    boundary: polygon,
    samplePoint: () =>
      options.rng
        ? randomPointInGeometryWithRng(polygon, options.rng)
        : randomPointInGeometry(polygon),
    radius: CITY_SEARCH_RADIUS,
  });
}
