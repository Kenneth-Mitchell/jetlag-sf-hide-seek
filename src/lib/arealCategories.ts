import * as turf from "@turf/turf";
import { CATEGORY_LABELS } from "../data/rules";
import { pointFeature } from "./geo";
import { snapshot } from "./snapshot";
import type { CategoryKey, LngLat } from "./types";

export const AREAL_CATEGORIES = ["parks", "waterBodies"] as const;

export type ArealCategoryKey = (typeof AREAL_CATEGORIES)[number];
export type ArealCategoryFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  {
    id: string;
    name: string;
    category: ArealCategoryKey;
  }
>;

const distanceCache = new Map<ArealCategoryKey, Map<string, { name: string; miles: number } | undefined>>();
const bufferCache = new Map<string, GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>[]>();

export function isArealCategory(category: CategoryKey): category is ArealCategoryKey {
  return (AREAL_CATEGORIES as readonly CategoryKey[]).includes(category);
}

function sourceCollection(category: ArealCategoryKey): GeoJSON.FeatureCollection {
  if (category === "parks") return snapshot.geometries.parkPolygons;
  if (category === "waterBodies") return snapshot.geometries.waterBodies;
  return { type: "FeatureCollection", features: [] };
}

export function arealCategoryFeatures(category: ArealCategoryKey): ArealCategoryFeature[] {
  return sourceCollection(category).features.filter(
    (feature): feature is ArealCategoryFeature =>
      feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon",
  );
}

function pointCacheKey(point: LngLat): string {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

function distanceToBoundaryLineMiles(
  point: GeoJSON.Feature<GeoJSON.Point>,
  boundary: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>,
): number {
  if (boundary.geometry.type === "LineString") {
    return turf.pointToLineDistance(point, boundary as GeoJSON.Feature<GeoJSON.LineString>, { units: "miles" });
  }
  return Math.min(
    ...boundary.geometry.coordinates.map((coordinates) =>
      turf.pointToLineDistance(point, turf.lineString(coordinates), { units: "miles" }),
    ),
  );
}

function distanceToAreaMiles(point: LngLat, feature: ArealCategoryFeature): number {
  const pt = pointFeature(point);
  if (turf.booleanPointInPolygon(pt, feature)) return 0;
  const boundary = turf.polygonToLine(feature);
  if (boundary.type === "FeatureCollection") {
    return Math.min(...boundary.features.map((line) => distanceToBoundaryLineMiles(pt, line)));
  }
  return distanceToBoundaryLineMiles(pt, boundary);
}

export function nearestArealCategoryWithDistance(point: LngLat, category: ArealCategoryKey) {
  const cache = distanceCache.get(category) ?? new Map<string, { name: string; miles: number } | undefined>();
  if (!distanceCache.has(category)) distanceCache.set(category, cache);
  const key = pointCacheKey(point);
  if (cache.has(key)) return cache.get(key);

  let best: { name: string; miles: number } | undefined;
  for (const feature of arealCategoryFeatures(category)) {
    const miles = distanceToAreaMiles(point, feature);
    if (!best || miles < best.miles) {
      best = { name: feature.properties.name ?? CATEGORY_LABELS[category], miles };
    }
  }
  cache.set(key, best);
  return best;
}

export function distanceToArealCategoryMiles(point: LngLat, category: ArealCategoryKey): number | undefined {
  return nearestArealCategoryWithDistance(point, category)?.miles;
}

export function arealCategoryBufferFeatures(category: ArealCategoryKey, miles: number): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>[] {
  if (miles <= 0.005) return [];
  const roundedMiles = Math.round(miles * 100) / 100;
  const cacheKey = `${category}:${roundedMiles.toFixed(2)}`;
  const cached = bufferCache.get(cacheKey);
  if (cached) return cached;
  const buffers = arealCategoryFeatures(category).flatMap((feature) => {
    const buffer = turf.buffer(feature, roundedMiles, { units: "miles", steps: 8 });
    return buffer && (buffer.geometry.type === "Polygon" || buffer.geometry.type === "MultiPolygon") ? [buffer] : [];
  });
  bufferCache.set(cacheKey, buffers);
  return buffers;
}
