import * as turf from '@turf/turf';
import type { BBox } from 'geojson';

export type CityGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
/** Координаты в порядке Яндекс.Карт: [широта, долгота]. */
export type LatLng = [number, number];

const INNER_SAMPLING_LIMIT = 500;

export function getBBox(geometry: CityGeometry): BBox {
  return (geometry.bbox as BBox | undefined) ?? turf.bbox(geometry);
}

/**
 * Случайная точка строго внутри полигона: генерация в bbox через turf.randomPoint
 * и отбраковка всех точек, не прошедших booleanPointInPolygon.
 */
export function randomPointInGeometry(geometry: CityGeometry): LatLng | null {
  const bbox = getBBox(geometry);
  for (let i = 0; i < INNER_SAMPLING_LIMIT; i++) {
    const point = turf.randomPoint(1, { bbox }).features[0];
    if (turf.booleanPointInPolygon(point, geometry, { ignoreBoundary: true })) {
      const [lng, lat] = point.geometry.coordinates;
      return [lat, lng];
    }
  }
  return null;
}

export function isInsideGeometry(position: LatLng, geometry: CityGeometry): boolean {
  return turf.booleanPointInPolygon(turf.point([position[1], position[0]]), geometry, {
    ignoreBoundary: true,
  });
}

export function distanceMeters(a: LatLng, b: LatLng): number {
  return turf.distance(turf.point([a[1], a[0]]), turf.point([b[1], b[0]]), { units: 'meters' });
}

/** Диагональ bbox города в метрах — «размер карты» для формулы очков. */
export function bboxDiagonalMeters(geometry: CityGeometry): number {
  const [minX, minY, maxX, maxY] = getBBox(geometry);
  return distanceMeters([minY, minX], [maxY, maxX]);
}

/** Границы для map.setBounds: [[южная широта, западная долгота], [северная широта, восточная долгота]]. */
export function toYmapsBounds(geometry: CityGeometry): number[][] {
  const [minX, minY, maxX, maxY] = getBBox(geometry);
  return [
    [minY, minX],
    [maxY, maxX],
  ];
}

/** Набор полигонов (каждый — массив колец) в формате [lat, lng] для ymaps.Polygon. */
export function toYmapsPolygons(geometry: CityGeometry): number[][][][] {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map((rings) => rings.map((ring) => ring.map(([lng, lat]) => [lat, lng])));
}

/** Точка на заданном расстоянии (м) и азимуте (°) от исходной. */
export function destination(from: LatLng, meters: number, bearing: number): LatLng {
  const p = turf.destination(turf.point([from[1], from[0]]), meters, bearing, { units: 'meters' });
  const [lng, lat] = p.geometry.coordinates;
  return [lat, lng];
}

/** Равномерная точка внутри bbox [minLng, minLat, maxLng, maxLat]. */
export function randomPointInBBox(bbox: [number, number, number, number]): LatLng {
  const [lng, lat] = turf.randomPosition(bbox);
  return [lat, lng];
}

/** Равномерная точка внутри bbox на заданном ГПСЧ (детерминированная). */
export function randomPointInBBoxWithRng(
  bbox: [number, number, number, number],
  rng: () => number,
): LatLng {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return [minLat + rng() * (maxLat - minLat), minLng + rng() * (maxLng - minLng)];
}

/**
 * Случайная точка строго внутри полигона на заданном ГПСЧ:
 * выборка с отклонением из bbox + отсев по booleanPointInPolygon.
 */
export function randomPointInGeometryWithRng(geometry: CityGeometry, rng: () => number): LatLng | null {
  const [minX, minY, maxX, maxY] = getBBox(geometry);
  for (let i = 0; i < INNER_SAMPLING_LIMIT; i++) {
    const lng = minX + rng() * (maxX - minX);
    const lat = minY + rng() * (maxY - minY);
    if (turf.booleanPointInPolygon(turf.point([lng, lat]), geometry, { ignoreBoundary: true })) {
      return [lat, lng];
    }
  }
  return null;
}

export function boundsDiagonalMeters(bounds: number[][]): number {
  return distanceMeters([bounds[0][0], bounds[0][1]], [bounds[1][0], bounds[1][1]]);
}
