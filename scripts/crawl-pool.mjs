#!/usr/bin/env node
/**
 * Сбор пула точек панорам для сидированных игр (дуэлей).
 *
 * Использует публичный HTTP-эндпоинт Яндекс.Панорам (тот же, что у сайта
 * Яндекс.Карт) — без API-ключа, поэтому сбор пула НЕ расходует суточную
 * квоту JS API ключа (100 вызовов панорам в сутки). Тем не менее запускайте
 * скрипт небольшими порциями с паузами — это неофициальный эндпоинт.
 *
 * Использование:
 *   unzip -o data.zip              # один раз: данные городов и границы России
 *   npm ci
 *   node scripts/crawl-pool.mjs --pool russia --target 100
 *
 * Скрипт дописывает новые точки в public/data/pools/russia.json и при
 * повторном запуске пропускает уже собранное. Цель — 500–1000 точек.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  booleanPointInPolygon,
  destination,
  distance as turfDistance,
  point as turfPoint,
} from '@turf/turf';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const POOL = arg('--pool', 'russia');
const TARGET = Number(arg('--target', '50'));
const DELAY_MS = Number(arg('--delay', '350'));
const OUT_FILE = resolve(ROOT, arg('--out', `public/data/pools/${POOL}.json`));

/** Минимальное расстояние между точками пула, км (как minSeparation у региона). */
const MIN_SEPARATION_KM = 50;
/** Сколько точек-кандидатов перебирать на одну новую точку пула. */
const SAMPLES_PER_POINT = 40;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/** Ближайшая панорама к точке через публичный эндпоинт Яндекс.Панорам. null — рядом нет. */
async function locatePanorama(lat, lon) {
  const url =
    `https://api-maps.yandex.ru/services/panoramas/1.x/?l=stv&lang=en_US` +
    `&ll=${lon},${lat}&origin=userAction&provider=streetview`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (json.status !== 'ok' || !json.data?.Data?.Point?.coordinates) return null;
  const [plon, plat] = json.data.Data.Point.coordinates;
  return { lat: plat, lon: plon };
}

/**
 * Сэмплер точек-кандидатов по России — зеркалит createRussiaSampler
 * из src/game/region.ts: город с весом по населению, затем точка в городе
 * или на расстоянии 3–30 км от него.
 */
function createRussiaSampler(cities) {
  const weights = cities.map((c) => Math.pow(Math.max(c.population, 5000), 0.45));
  const total = weights.reduce((a, b) => a + b, 0);
  const pickCity = () => {
    let r = Math.random() * total;
    for (let i = 0; i < cities.length; i++) {
      r -= weights[i];
      if (r <= 0) return cities[i];
    }
    return cities[cities.length - 1];
  };
  return () => {
    const city = pickCity();
    if (Math.random() < 0.7) {
      const [minLng, minLat, maxLng, maxLat] = city.bbox;
      return [minLat + Math.random() * (maxLat - minLat), minLng + Math.random() * (maxLng - minLng)];
    }
    const target = destination(
      turfPoint([city.center[1], city.center[0]]),
      3000 + Math.random() * 27000,
      Math.random() * 360,
      { units: 'meters' },
    );
    const [lon, lat] = target.geometry.coordinates;
    return [lat, lon];
  };
}

const key = (lat, lon) => `${lat.toFixed(5)},${lon.toFixed(5)}`;
const insideRussia = (lat, lon, russia) =>
  booleanPointInPolygon(turfPoint([lon, lat]), russia, { ignoreBoundary: true });
const kmTo = (aLat, aLon, bLat, bLon) =>
  turfDistance(turfPoint([aLon, aLat]), turfPoint([bLon, bLat]), { units: 'kilometers' });

async function main() {
  const cities = await readJson(resolve(ROOT, 'src/data/cities.json'), null);
  const russia = await readJson(resolve(ROOT, 'public/data/russia.json'), null);
  if (!Array.isArray(cities) || cities.length === 0 || !russia) {
    console.error('Нет данных — сначала распакуйте архив: unzip -o data.zip (и установите зависимости: npm ci)');
    process.exit(1);
  }

  const existing = await readJson(OUT_FILE, null);
  const points = Array.isArray(existing?.points) ? existing.points : [];
  const known = new Set(points.map(([lat, lon]) => key(lat, lon)));
  console.log(`Пул "${POOL}": уже есть ${points.length} точек. Цель за запуск: +${TARGET}.`);

  const sample = createRussiaSampler(cities);
  const added = [];
  let apiCalls = 0;

  while (added.length < TARGET) {
    let found = null;
    for (let attempt = 0; attempt < SAMPLES_PER_POINT && !found; attempt++) {
      const [lat, lon] = sample();
      if (!insideRussia(lat, lon, russia)) continue;
      try {
        found = await locatePanorama(lat, lon);
      } catch (error) {
        console.error(`Ошибка запроса: ${error.message}. Прерываю (собрано: ${added.length}).`);
        break;
      }
      apiCalls++;
      await sleep(DELAY_MS);
    }
    if (!found) continue;

    const { lat, lon } = found;
    if (!insideRussia(lat, lon, russia)) continue;
    const pointKey = key(lat, lon);
    if (known.has(pointKey)) continue;

    const all = [...points, ...added];
    const tooClose = all.some(
      ([plat, plon]) => kmTo(plat, plon, lat, lon) < MIN_SEPARATION_KM,
    );
    if (tooClose) continue;

    known.add(pointKey);
    added.push([Number(lat.toFixed(6)), Number(lon.toFixed(6))]);
    if (added.length % 10 === 0) console.log(`  собрано +${added.length}...`);
  }

  const pool = {
    pool: POOL,
    version: 1,
    updated: new Date().toISOString().slice(0, 10),
    points: [...points, ...added],
  };
  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(pool, null, 1)}\n`);
  console.log(`Готово: добавлено ${added.length} точек (запросов к API: ${apiCalls}). Всего в пуле: ${pool.points.length}.`);
  console.log(`Файл: ${OUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
