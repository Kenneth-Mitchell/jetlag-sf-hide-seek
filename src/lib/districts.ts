import * as turf from "@turf/turf";
import { snapshot } from "./snapshot";
import type { LngLat } from "./types";

export type DistrictFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;

function isDistrictFeature(feature: GeoJSON.Feature): feature is DistrictFeature {
  return feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon";
}

export function districtNumberFromFeature(feature: GeoJSON.Feature): string | undefined {
  const raw =
    feature.properties?.sup_dist ??
    feature.properties?.sup_dist_num ??
    feature.properties?.sup_dist_pad;
  if (raw === undefined || raw === null) return undefined;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return String(Math.trunc(numeric));
  return String(raw).trim().replace(/^D/i, "").replace(/\.0$/, "") || undefined;
}

export function districtLabelFromFeature(feature: GeoJSON.Feature): string {
  const district = districtNumberFromFeature(feature);
  return district ? `D${district}` : "District";
}

export function districtDetailFromFeature(feature: GeoJSON.Feature): string {
  return String(feature.properties?.sup_name ?? feature.properties?.sup_dist_name ?? "");
}

export function supervisorDistrictFeatures(): DistrictFeature[] {
  return snapshot.geometries.supervisorDistricts.features
    .filter(isDistrictFeature)
    .sort((a, b) => Number(districtNumberFromFeature(a) ?? 0) - Number(districtNumberFromFeature(b) ?? 0));
}

export function districtAtPoint(point: LngLat): DistrictFeature | undefined {
  const turfPoint = turf.point([point.lng, point.lat]);
  return supervisorDistrictFeatures().find((feature) => turf.booleanPointInPolygon(turfPoint, feature));
}

export function districtNumberAtPoint(point: LngLat): string | undefined {
  const district = districtAtPoint(point);
  return district ? districtNumberFromFeature(district) : undefined;
}
