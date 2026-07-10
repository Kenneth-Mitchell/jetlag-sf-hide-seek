import * as turf from "@turf/turf";
import { CATEGORY_LABELS } from "../data/rules";
import { pointFeature } from "./geo";
import { snapshot } from "./snapshot";
import type { CategoryKey, LngLat } from "./types";

export const LINEAR_CATEGORIES = ["coastline"] as const;

export type LinearCategoryKey = (typeof LINEAR_CATEGORIES)[number];

export type LinearCategoryLine = GeoJSON.Feature<
  GeoJSON.LineString,
  {
    id: string;
    name: string;
    category: LinearCategoryKey;
  }
>;

// Coastline starts as 37k+ vertices; these tiers keep adjudication tight while making preview buffers cheap.
const DISTANCE_TOLERANCE_DEGREES = 0.0002;
const DISPLAY_TOLERANCE_DEGREES = 0.0005;
const BUFFER_TOLERANCE_DEGREES = 0.002;

export function isLinearCategory(category: CategoryKey): category is LinearCategoryKey {
  return (LINEAR_CATEGORIES as readonly CategoryKey[]).includes(category);
}

function collectionForLinearCategory(category: LinearCategoryKey): GeoJSON.FeatureCollection {
  return snapshot.geometries[category];
}

function lineFromCoordinates(
  coordinates: GeoJSON.Position[],
  category: LinearCategoryKey,
  index: number,
): LinearCategoryLine | undefined {
  if (coordinates.length < 2) return undefined;
  return turf.lineString(coordinates, {
    id: `${category}:${index}`,
    name: CATEGORY_LABELS[category],
    category,
  }) as LinearCategoryLine;
}

function linesFromFeature(feature: GeoJSON.Feature, category: LinearCategoryKey): LinearCategoryLine[] {
  const geometry = feature.geometry;
  if (!geometry) return [];

  if (geometry.type === "LineString") {
    return [lineFromCoordinates(geometry.coordinates, category, 0)].filter(Boolean) as LinearCategoryLine[];
  }

  if (geometry.type === "MultiLineString") {
    return geometry.coordinates
      .map((coordinates, index) => lineFromCoordinates(coordinates, category, index))
      .filter(Boolean) as LinearCategoryLine[];
  }

  if (geometry.type === "Polygon") {
    const exterior = geometry.coordinates[0];
    return exterior ? ([lineFromCoordinates(exterior, category, 0)].filter(Boolean) as LinearCategoryLine[]) : [];
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygon, index) => lineFromCoordinates(polygon[0] ?? [], category, index))
      .filter(Boolean) as LinearCategoryLine[];
  }

  return [];
}

function simplifyLine(line: LinearCategoryLine, tolerance: number): LinearCategoryLine {
  return turf.simplify(line, {
    tolerance,
    highQuality: false,
    mutate: false,
  }) as LinearCategoryLine;
}

const rawLineCache = new Map<LinearCategoryKey, LinearCategoryLine[]>();
const distanceLineCache = new Map<LinearCategoryKey, LinearCategoryLine[]>();
const displayLineCache = new Map<LinearCategoryKey, LinearCategoryLine[]>();
const bufferLineCache = new Map<LinearCategoryKey, GeoJSON.Feature<GeoJSON.MultiLineString>>();
const distanceCache = new Map<LinearCategoryKey, Map<string, number>>();

function rawLinearCategoryLines(category: LinearCategoryKey): LinearCategoryLine[] {
  const cached = rawLineCache.get(category);
  if (cached) return cached;
  const lines = collectionForLinearCategory(category).features.flatMap((feature) => linesFromFeature(feature, category));
  rawLineCache.set(category, lines);
  return lines;
}

export function linearCategoryLines(category: LinearCategoryKey): LinearCategoryLine[] {
  const cached = distanceLineCache.get(category);
  if (cached) return cached;
  const lines = rawLinearCategoryLines(category).map((line) => simplifyLine(line, DISTANCE_TOLERANCE_DEGREES));
  distanceLineCache.set(category, lines);
  return lines;
}

export function linearCategoryDisplayLines(category: LinearCategoryKey): LinearCategoryLine[] {
  const cached = displayLineCache.get(category);
  if (cached) return cached;
  const lines = rawLinearCategoryLines(category).map((line) => simplifyLine(line, DISPLAY_TOLERANCE_DEGREES));
  displayLineCache.set(category, lines);
  return lines;
}

export function linearCategoryBufferLine(category: LinearCategoryKey): GeoJSON.Feature<GeoJSON.MultiLineString> | undefined {
  const cached = bufferLineCache.get(category);
  if (cached) return cached;
  const lines = rawLinearCategoryLines(category).map((line) => simplifyLine(line, BUFFER_TOLERANCE_DEGREES));
  if (lines.length === 0) return undefined;
  const feature = turf.multiLineString(
    lines.map((line) => line.geometry.coordinates),
    {
      id: `${category}:buffer-line`,
      name: CATEGORY_LABELS[category],
      category,
    },
  ) as GeoJSON.Feature<GeoJSON.MultiLineString>;
  bufferLineCache.set(category, feature);
  return feature;
}

function pointCacheKey(point: LngLat): string {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

export function distanceToLinearCategoryMiles(point: LngLat, category: LinearCategoryKey): number | undefined {
  const cache = distanceCache.get(category) ?? new Map<string, number>();
  if (!distanceCache.has(category)) distanceCache.set(category, cache);
  const key = pointCacheKey(point);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const lines = linearCategoryLines(category);
  if (lines.length === 0) return undefined;
  const pt = pointFeature(point);
  let best = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    best = Math.min(best, turf.pointToLineDistance(pt, line, { units: "miles" }));
  }
  if (!Number.isFinite(best)) return undefined;
  cache.set(key, best);
  return best;
}

export function nearestLinearCategoryWithDistance(point: LngLat, category: LinearCategoryKey) {
  const miles = distanceToLinearCategoryMiles(point, category);
  return miles === undefined ? undefined : { name: CATEGORY_LABELS[category], miles };
}
