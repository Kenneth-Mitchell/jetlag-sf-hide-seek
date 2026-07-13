import { CATEGORY_LABELS } from "../data/rules";
import { distanceToArealCategoryMiles, isArealCategory, nearestArealCategoryWithDistance } from "./arealCategories";
import { nearestSeaLevelWithDistance, SEA_LEVEL_ELEVATION_TOLERANCE_FEET } from "./elevation";
import { distanceMiles, distanceToFeatureMiles, lngLatFromFeature, nearestFeature, nearestFeatureWithDistance, nearestOtherDistance, pointInFeatureCollection, sampleStationZone } from "./geo";
import { distanceToLinearCategoryMiles, isLinearCategory, nearestLinearCategoryWithDistance } from "./linearCategories";
import { getCategoryFeatures, snapshot, validStations } from "./snapshot";
import { transitLineStopsInStationZone as stationHasTransitLineStop } from "./transit";
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

function measuringDistance(point: LngLat, category: Extract<Constraint, { kind: "measuring" }>["category"]): number | undefined {
  if (category === "seaLevel") return nearestSeaLevelWithDistance(point)?.miles;
  if (isLinearCategory(category)) return distanceToLinearCategoryMiles(point, category);
  if (isArealCategory(category)) return distanceToArealCategoryMiles(point, category);
  return nearestFeatureWithDistance(point, getCategoryFeatures(category))?.miles;
}

function seaLevelMeasuringSurvives(station: CandidateStation, constraint: Extract<Constraint, { kind: "measuring" }>): boolean {
  const referenceFeet = nearestSeaLevelWithDistance(constraint.point)?.feet;
  const stationFeet = nearestSeaLevelWithDistance(stationCenter(station))?.feet;
  if (referenceFeet === undefined || stationFeet === undefined) return true;
  return constraint.answer === "closer"
    ? stationFeet <= referenceFeet + SEA_LEVEL_ELEVATION_TOLERANCE_FEET
    : stationFeet >= referenceFeet - SEA_LEVEL_ELEVATION_TOLERANCE_FEET;
}

export { transitLineStopsInStationZone } from "./transit";

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
      if (constraint.category === "seaLevel") return seaLevelMeasuringSurvives(station, constraint);
      const referenceMiles = measuringDistance(constraint.point, constraint.category);
      const stationMiles = measuringDistance(center, constraint.category);
      if (referenceMiles === undefined || stationMiles === undefined) return true;
      const minPossible = Math.max(0, stationMiles - radius);
      const maxPossible = stationMiles + radius;
      return constraint.answer === "closer" ? minPossible <= referenceMiles : maxPossible >= referenceMiles;
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
    case "transit-line": {
      const result = stationHasTransitLineStop(station, constraint.line);
      return constraint.answer === "yes" ? result : !result;
    }
  }
}

export function pointSatisfiesConstraint(point: LngLat, constraint: Constraint): boolean {
  if (!constraint.enabled) return true;

  switch (constraint.kind) {
    case "radius": {
      const d = distanceMiles(point, constraint.point);
      return constraint.answer === "inside" ? d <= constraint.miles : d >= constraint.miles;
    }
    case "thermometer": {
      const from = distanceMiles(point, constraint.from);
      const to = distanceMiles(point, constraint.to);
      if (constraint.answer === "same") return Math.abs(from - to) <= 0.02;
      return constraint.answer === "warmer" ? to <= from : to >= from;
    }
    case "matching": {
      const features = getCategoryFeatures(constraint.category);
      const seekerNearest = nearestFeature(constraint.point, features);
      const hiderNearest = nearestFeature(point, features);
      if (!seekerNearest || !hiderNearest) return true;
      const same = seekerNearest.properties.id === hiderNearest.properties.id;
      return constraint.answer === "yes" ? same : !same;
    }
    case "measuring": {
      if (constraint.category === "seaLevel") {
        const referenceFeet = nearestSeaLevelWithDistance(constraint.point)?.feet;
        const hiderFeet = nearestSeaLevelWithDistance(point)?.feet;
        if (referenceFeet === undefined || hiderFeet === undefined) return true;
        return constraint.answer === "closer" ? hiderFeet <= referenceFeet : hiderFeet >= referenceFeet;
      }
      const referenceMiles = measuringDistance(constraint.point, constraint.category);
      const hiderMiles = measuringDistance(point, constraint.category);
      if (referenceMiles === undefined || hiderMiles === undefined) return true;
      return constraint.answer === "closer" ? hiderMiles <= referenceMiles : hiderMiles >= referenceMiles;
    }
    case "tentacles": {
      const features = getCategoryFeatures(constraint.category);
      const target = features.find((feature) => feature.properties.id === constraint.selectedPoiId);
      const hiderNearest = nearestFeature(point, features);
      if (!target || !hiderNearest) return true;
      return (
        distanceToFeatureMiles(constraint.point, target) <= constraint.radiusMiles &&
        hiderNearest.properties.id === target.properties.id
      );
    }
    case "district": {
      const seekerDistrict = districtAt(constraint.point);
      const hiderDistrict = districtAt(point);
      if (!seekerDistrict || !hiderDistrict) return true;
      const same = seekerDistrict === hiderDistrict;
      return constraint.answer === "yes" ? same : !same;
    }
    case "transit-line": {
      const possibleStations = validStations.filter(
        (station) => distanceMiles(point, stationCenter(station)) <= hideRadius(),
      );
      if (possibleStations.length === 0) return false;
      const yesPossible = possibleStations.some((station) => stationHasTransitLineStop(station, constraint.line));
      const noPossible = possibleStations.some((station) => !stationHasTransitLineStop(station, constraint.line));
      return constraint.answer === "yes" ? yesPossible : noPossible;
    }
  }
}

export function pointSatisfiesConstraints(point: LngLat, constraints: Constraint[]): boolean {
  return constraints.every((constraint) => pointSatisfiesConstraint(point, constraint));
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
    case "transit-line":
      return `Transit line ${constraint.line}: ${constraint.answer}`;
  }
}

export function canonicalAnswers(point: LngLat) {
  return {
    nearest: Object.fromEntries(
      (Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((category) => {
        if (isLinearCategory(category)) {
          const nearest = nearestLinearCategoryWithDistance(point, category);
          return [
            category,
            nearest
              ? {
                  name: nearest.name,
                  miles: nearest.miles,
                }
              : undefined,
          ];
        }
        if (category === "seaLevel") {
          const nearest = nearestSeaLevelWithDistance(point);
          return [
            category,
            nearest
              ? {
                  name: nearest.name,
                  miles: nearest.miles,
                  feet: nearest.feet,
                }
              : undefined,
          ];
        }
        if (isArealCategory(category)) {
          const nearest = nearestArealCategoryWithDistance(point, category);
          return [
            category,
            nearest
              ? {
                  name: nearest.name,
                  miles: nearest.miles,
                }
              : undefined,
          ];
        }
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
