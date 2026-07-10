import { CATEGORY_LABELS } from "../data/rules";
import { distanceMiles, distanceToFeatureMiles, lngLatFromFeature, nearestFeature, nearestFeatureWithDistance, nearestOtherDistance, pointInFeatureCollection, sampleStationZone, stationLines } from "./geo";
import { getCategoryFeatures, snapshot, validStations } from "./snapshot";
import type { CandidateStation, Constraint, LngLat, PointFeature } from "./types";

function stationCenter(station: CandidateStation): LngLat {
  return lngLatFromFeature(station);
}

function hideRadius(): number {
  return snapshot.hideRadiusMiles;
}

function sameNearestPossible(station: CandidateStation, target: PointFeature, features: PointFeature[]): boolean {
  const center = stationCenter(station);
  const targetDistance = distanceToFeatureMiles(center, target);
  const otherDistance = nearestOtherDistance(center, features, target.properties.id);
  return targetDistance <= otherDistance + hideRadius() * 2;
}

function differentNearestPossible(station: CandidateStation, target: PointFeature, features: PointFeature[]): boolean {
  const center = stationCenter(station);
  const targetDistance = distanceToFeatureMiles(center, target);
  const otherDistance = nearestOtherDistance(center, features, target.properties.id);
  return otherDistance <= targetDistance + hideRadius() * 2;
}

function possibleDistricts(station: CandidateStation): Set<string> {
  const districts = new Set<string>();
  for (const point of sampleStationZone(station, hideRadius())) {
    const feature = pointInFeatureCollection(point, snapshot.geometries.supervisorDistricts);
    const district = feature?.properties?.sup_dist_num ?? feature?.properties?.sup_dist;
    if (district) districts.add(String(district));
  }
  return districts;
}

function districtAt(point: LngLat): string | undefined {
  const feature = pointInFeatureCollection(point, snapshot.geometries.supervisorDistricts);
  const district = feature?.properties?.sup_dist_num ?? feature?.properties?.sup_dist;
  return district ? String(district) : undefined;
}

function transitLineStopsInStationZone(station: CandidateStation, line: string): boolean {
  const normalized = line.trim().toLowerCase();
  if (!normalized) return false;
  if (stationLines(station).some((candidate) => candidate.toLowerCase() === normalized)) {
    return true;
  }
  const center = stationCenter(station);
  return validStations.some((stop) => {
    if (!stationLines(stop).some((candidate) => candidate.toLowerCase() === normalized)) return false;
    return distanceMiles(center, stationCenter(stop)) <= hideRadius();
  });
}

export function stationSurvivesConstraint(station: CandidateStation, constraint: Constraint): boolean {
  if (!constraint.enabled) return true;
  const center = stationCenter(station);
  const radius = hideRadius();

  switch (constraint.kind) {
    case "radius": {
      const d = distanceMiles(center, constraint.point);
      return constraint.answer === "inside" ? d <= constraint.miles + radius : d >= constraint.miles - radius;
    }
    case "thermometer": {
      const from = distanceMiles(center, constraint.from);
      const to = distanceMiles(center, constraint.to);
      if (constraint.answer === "same") return Math.abs(from - to) <= radius * 2;
      if (constraint.answer === "warmer") return to - from <= radius * 2;
      return from - to <= radius * 2;
    }
    case "matching": {
      const features = getCategoryFeatures(constraint.category);
      const target = nearestFeature(constraint.point, features);
      if (!target) return true;
      return constraint.answer === "yes"
        ? sameNearestPossible(station, target, features)
        : differentNearestPossible(station, target, features);
    }
    case "measuring": {
      const features = getCategoryFeatures(constraint.category);
      const reference = nearestFeatureWithDistance(constraint.point, features);
      const stationNearest = nearestFeatureWithDistance(center, features);
      if (!reference || !stationNearest) return true;
      const minPossible = Math.max(0, stationNearest.miles - radius);
      const maxPossible = stationNearest.miles + radius;
      return constraint.answer === "closer" ? minPossible <= reference.miles : maxPossible >= reference.miles;
    }
    case "tentacles": {
      const features = getCategoryFeatures(constraint.category);
      const target = features.find((feature) => feature.properties.id === constraint.selectedPoiId);
      if (!target) return true;
      const targetReachable = distanceToFeatureMiles(center, target) <= constraint.radiusMiles + radius;
      return targetReachable && sameNearestPossible(station, target, features);
    }
    case "district": {
      const seekerDistrict = districtAt(constraint.point);
      if (!seekerDistrict) return true;
      const districts = possibleDistricts(station);
      return constraint.answer === "yes" ? districts.has(seekerDistrict) : [...districts].some((d) => d !== seekerDistrict);
    }
    case "station-name-length": {
      const nearestStation = nearestFeature(constraint.point, validStations);
      if (!nearestStation) return true;
      const sameLength = station.properties.name.length === nearestStation.properties.name.length;
      return constraint.answer === "yes" ? sameLength : !sameLength;
    }
    case "transit-line": {
      const result = transitLineStopsInStationZone(station, constraint.line);
      return constraint.answer === "yes" ? result : !result;
    }
  }
}

export function applyConstraints(constraints: Constraint[], stations: CandidateStation[] = validStations): CandidateStation[] {
  return stations.filter((station) => constraints.every((constraint) => stationSurvivesConstraint(station, constraint)));
}

export function describeConstraint(constraint: Constraint): string {
  switch (constraint.kind) {
    case "radius":
      return `${constraint.answer === "inside" ? "Within" : "Outside"} ${constraint.miles.toFixed(2)} mi of selected point`;
    case "thermometer":
      return `Thermometer: ${constraint.answer}`;
    case "matching":
      return `Matching ${CATEGORY_LABELS[constraint.category]}: ${constraint.answer}`;
    case "measuring":
      return `Measuring ${CATEGORY_LABELS[constraint.category]}: ${constraint.answer}`;
    case "tentacles":
      return `Tentacles ${CATEGORY_LABELS[constraint.category]}`;
    case "district":
      return `Same supervisorial district: ${constraint.answer}`;
    case "station-name-length":
      return `Same nearest station name length: ${constraint.answer}`;
    case "transit-line":
      return `Transit line ${constraint.line}: ${constraint.answer}`;
  }
}

export function canonicalAnswers(point: LngLat) {
  return {
    nearest: Object.fromEntries(
      (Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((category) => {
        const nearest = nearestFeatureWithDistance(point, getCategoryFeatures(category));
        return [
          category,
          nearest
            ? {
                name: nearest.feature.properties.name,
                miles: nearest.miles,
              }
            : undefined,
        ];
      }),
    ),
    district: districtAt(point),
    nearestValidStation: nearestFeatureWithDistance(point, validStations),
  };
}
