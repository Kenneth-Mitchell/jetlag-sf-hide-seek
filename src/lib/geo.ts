import * as turf from "@turf/turf";
import type { CandidateStation, LngLat, PointFeature } from "./types";

export const milesToMeters = (miles: number) => miles * 1609.344;

export function lngLatFromFeature(feature: PointFeature): LngLat {
  return {
    lng: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
  };
}

export function pointFeature(point: LngLat) {
  return turf.point([point.lng, point.lat]);
}

export function distanceMiles(a: LngLat, b: LngLat): number {
  return turf.distance(pointFeature(a), pointFeature(b), { units: "miles" });
}

export function distanceToFeatureMiles(point: LngLat, feature: PointFeature): number {
  return distanceMiles(point, lngLatFromFeature(feature));
}

export function nearestFeature(point: LngLat, features: PointFeature[]): PointFeature | undefined {
  let best: PointFeature | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const feature of features) {
    const distance = distanceToFeatureMiles(point, feature);
    if (distance < bestDistance) {
      best = feature;
      bestDistance = distance;
    }
  }
  return best;
}

export function nearestFeatureWithDistance(point: LngLat, features: PointFeature[]) {
  const feature = nearestFeature(point, features);
  return feature ? { feature, miles: distanceToFeatureMiles(point, feature) } : undefined;
}

export function nearestOtherDistance(point: LngLat, features: PointFeature[], targetId: string): number {
  let best = Number.POSITIVE_INFINITY;
  for (const feature of features) {
    if (feature.properties.id === targetId) continue;
    best = Math.min(best, distanceToFeatureMiles(point, feature));
  }
  return best;
}

export function sampleStationZone(station: CandidateStation, radiusMiles: number): LngLat[] {
  const center = lngLatFromFeature(station);
  const samples = [center];
  const centerPoint = pointFeature(center);
  for (let bearing = 0; bearing < 360; bearing += 30) {
    const destination = turf.destination(centerPoint, radiusMiles, bearing, { units: "miles" });
    samples.push({
      lng: destination.geometry.coordinates[0],
      lat: destination.geometry.coordinates[1],
    });
  }
  for (let bearing = 15; bearing < 360; bearing += 45) {
    const destination = turf.destination(centerPoint, radiusMiles * 0.55, bearing, { units: "miles" });
    samples.push({
      lng: destination.geometry.coordinates[0],
      lat: destination.geometry.coordinates[1],
    });
  }
  return samples;
}

export function pointInFeatureCollection(point: LngLat, collection: GeoJSON.FeatureCollection): GeoJSON.Feature | undefined {
  const pt = pointFeature(point);
  return collection.features.find((feature) => {
    if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") return false;
    return turf.booleanPointInPolygon(
      pt,
      feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
    );
  });
}

export function stationLines(station: CandidateStation): string[] {
  const parts = [
    station.properties.associated_lines,
    station.properties.other_systems,
    station.properties.primary_system,
  ]
    .filter(Boolean)
    .join(",")
    .split(/[,;/]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
}
