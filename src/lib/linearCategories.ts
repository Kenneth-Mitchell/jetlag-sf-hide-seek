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

const lineCache = new Map<LinearCategoryKey, LinearCategoryLine[]>();

export function linearCategoryLines(category: LinearCategoryKey): LinearCategoryLine[] {
  const cached = lineCache.get(category);
  if (cached) return cached;
  const lines = collectionForLinearCategory(category).features.flatMap((feature) => linesFromFeature(feature, category));
  lineCache.set(category, lines);
  return lines;
}

export function distanceToLinearCategoryMiles(point: LngLat, category: LinearCategoryKey): number | undefined {
  const lines = linearCategoryLines(category);
  if (lines.length === 0) return undefined;
  const pt = pointFeature(point);
  let best = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    best = Math.min(best, turf.pointToLineDistance(pt, line, { units: "miles" }));
  }
  return Number.isFinite(best) ? best : undefined;
}

export function nearestLinearCategoryWithDistance(point: LngLat, category: LinearCategoryKey) {
  const miles = distanceToLinearCategoryMiles(point, category);
  return miles === undefined ? undefined : { name: CATEGORY_LABELS[category], miles };
}

