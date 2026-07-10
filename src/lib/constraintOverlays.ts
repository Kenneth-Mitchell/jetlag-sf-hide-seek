import * as turf from "@turf/turf";
import { lngLatFromFeature, nearestFeature, nearestFeatureWithDistance, stationLines } from "./geo";
import { getCategoryFeatures, snapshot, validStations } from "./snapshot";
import type { Constraint, LngLat, PointFeature } from "./types";

export type ConstraintOverlay =
  | {
      kind: "circle";
      center: LngLat;
      radiusMiles: number;
      mode: "keep" | "exclude" | "reference";
    }
  | {
      kind: "polygon";
      feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
      mode: "keep" | "exclude" | "reference";
    }
  | {
      kind: "line";
      coordinates: LngLat[];
      mode: "keep" | "exclude" | "reference";
    };

function overlayBbox(): [number, number, number, number] {
  const [west, south, east, north] = turf.bbox(snapshot.geometries.playableArea);
  const xPad = (east - west) * 0.12;
  const yPad = (north - south) * 0.12;
  return [west - xPad, south - yPad, east + xPad, north + yPad];
}

function rectangleVertices(): Array<[number, number]> {
  const [west, south, east, north] = overlayBbox();
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ];
}

function clipRectangleToHalfPlane(
  normal: [number, number],
  offset: number,
  keepGreater: boolean,
): GeoJSON.Feature<GeoJSON.Polygon> | undefined {
  const inside = (point: [number, number]) => {
    const value = normal[0] * point[0] + normal[1] * point[1] - offset;
    return keepGreater ? value >= -1e-12 : value <= 1e-12;
  };
  const intersection = (a: [number, number], b: [number, number]): [number, number] => {
    const av = normal[0] * a[0] + normal[1] * a[1] - offset;
    const bv = normal[0] * b[0] + normal[1] * b[1] - offset;
    const t = av / (av - bv);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };

  let output = rectangleVertices();
  const input = output;
  output = [];
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const previous = input[(index + input.length - 1) % input.length];
    const currentInside = inside(current);
    const previousInside = inside(previous);
    if (currentInside) {
      if (!previousInside) output.push(intersection(previous, current));
      output.push(current);
    } else if (previousInside) {
      output.push(intersection(previous, current));
    }
  }

  if (output.length < 3) return undefined;
  output.push(output[0]);
  return turf.polygon([output]);
}

function bisectorLine(from: LngLat, to: LngLat): ConstraintOverlay {
  const ax = from.lng;
  const ay = from.lat;
  const bx = to.lng;
  const by = to.lat;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy) || 1;
  const px = -dy / length;
  const py = dx / length;
  const [, south, , north] = overlayBbox();
  const scale = (north - south) * 3;
  return {
    kind: "line",
    coordinates: [
      { lng: mx - px * scale, lat: my - py * scale },
      { lng: mx + px * scale, lat: my + py * scale },
    ],
    mode: "reference",
  };
}

function thermometerOverlay(constraint: Extract<Constraint, { kind: "thermometer" }>): ConstraintOverlay[] {
  const ax = constraint.from.lng;
  const ay = constraint.from.lat;
  const bx = constraint.to.lng;
  const by = constraint.to.lat;
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.hypot(dx, dy) < 1e-9) return [];
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const normal: [number, number] = [dx, dy];
  const offset = normal[0] * mx + normal[1] * my;
  if (constraint.answer === "same") return [bisectorLine(constraint.from, constraint.to)];
  const polygon = clipRectangleToHalfPlane(normal, offset, constraint.answer === "warmer");
  return [
    ...(polygon ? [{ kind: "polygon" as const, feature: polygon, mode: "keep" as const }] : []),
    bisectorLine(constraint.from, constraint.to),
  ];
}

function voronoiCells(features: PointFeature[]): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const points = turf.featureCollection(
    features.map((feature) =>
      turf.point(feature.geometry.coordinates, {
        id: feature.properties.id,
        name: feature.properties.name,
      }),
    ),
  );
  const result = turf.voronoi(points, { bbox: overlayBbox() });
  return {
    type: "FeatureCollection",
    features: (result?.features ?? []).filter(
      (feature): feature is GeoJSON.Feature<GeoJSON.Polygon> => feature.geometry?.type === "Polygon",
    ),
  };
}

function voronoiCellFor(features: PointFeature[], id: string): GeoJSON.Feature<GeoJSON.Polygon> | undefined {
  return voronoiCells(features).features.find((feature) => feature.properties?.id === id);
}

function matchingOverlay(constraint: Extract<Constraint, { kind: "matching" }>): ConstraintOverlay[] {
  const features = getCategoryFeatures(constraint.category);
  const target = nearestFeature(constraint.point, features);
  if (!target) return [];
  const cell = voronoiCellFor(features, target.properties.id);
  if (!cell) return [];
  return [
    {
      kind: "polygon",
      feature: cell,
      mode: constraint.answer === "yes" ? "keep" : "exclude",
    },
  ];
}

function measuringOverlay(constraint: Extract<Constraint, { kind: "measuring" }>): ConstraintOverlay[] {
  const reference = nearestFeatureWithDistance(constraint.point, getCategoryFeatures(constraint.category));
  if (!reference) return [];
  return getCategoryFeatures(constraint.category).map((feature) => ({
    kind: "circle",
    center: lngLatFromFeature(feature),
    radiusMiles: reference.miles,
    mode: constraint.answer === "closer" ? "keep" : "exclude",
  }));
}

function tentaclesOverlay(constraint: Extract<Constraint, { kind: "tentacles" }>): ConstraintOverlay[] {
  const features = getCategoryFeatures(constraint.category);
  const cell = voronoiCellFor(features, constraint.selectedPoiId);
  if (!cell) return [];
  const radius = turf.circle([constraint.point.lng, constraint.point.lat], constraint.radiusMiles, {
    units: "miles",
    steps: 96,
  });
  const intersection = turf.intersect(turf.featureCollection([cell, radius]));
  return [
    {
      kind: "circle",
      center: constraint.point,
      radiusMiles: constraint.radiusMiles,
      mode: "reference",
    },
    ...(intersection
      ? [
          {
            kind: "polygon" as const,
            feature: intersection as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
            mode: "keep" as const,
          },
        ]
      : []),
  ];
}

function districtOverlay(constraint: Extract<Constraint, { kind: "district" }>): ConstraintOverlay[] {
  const point = turf.point([constraint.point.lng, constraint.point.lat]);
  const district = snapshot.geometries.supervisorDistricts.features.find((feature) => {
    if (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon") return false;
    return turf.booleanPointInPolygon(point, feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>);
  });
  if (!district || (district.geometry.type !== "Polygon" && district.geometry.type !== "MultiPolygon")) return [];
  return [
    {
      kind: "polygon",
      feature: district as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
      mode: constraint.answer === "yes" ? "keep" : "exclude",
    },
  ];
}

function stationNameLengthOverlay(constraint: Extract<Constraint, { kind: "station-name-length" }>): ConstraintOverlay[] {
  const nearest = nearestFeature(constraint.point, validStations);
  if (!nearest) return [];
  const targetLength = nearest.properties.name.length;
  const cells = voronoiCells(validStations);
  return cells.features
    .filter((cell) => {
      const station = validStations.find((candidate) => candidate.properties.id === cell.properties?.id);
      if (!station) return false;
      const same = station.properties.name.length === targetLength;
      return constraint.answer === "yes" ? same : same;
    })
    .map((cell) => ({
      kind: "polygon" as const,
      feature: cell,
      mode: constraint.answer === "yes" ? ("keep" as const) : ("exclude" as const),
    }));
}

function transitLineOverlay(constraint: Extract<Constraint, { kind: "transit-line" }>): ConstraintOverlay[] {
  const normalized = constraint.line.trim().toLowerCase();
  if (!normalized) return [];
  return validStations
    .filter((station) => stationLines(station).some((line) => line.toLowerCase() === normalized))
    .map((station) => ({
      kind: "circle" as const,
      center: lngLatFromFeature(station),
      radiusMiles: snapshot.hideRadiusMiles,
      mode: constraint.answer === "yes" ? ("keep" as const) : ("exclude" as const),
    }));
}

export function buildConstraintOverlays(constraints: Constraint[]): ConstraintOverlay[] {
  return constraints.flatMap((constraint) => {
    if (!constraint.enabled) return [];
    switch (constraint.kind) {
      case "radius":
        return [
          {
            kind: "circle",
            center: constraint.point,
            radiusMiles: constraint.miles,
            mode: constraint.answer === "inside" ? "keep" : "exclude",
          },
        ];
      case "thermometer":
        return thermometerOverlay(constraint);
      case "matching":
        return matchingOverlay(constraint);
      case "measuring":
        return measuringOverlay(constraint);
      case "tentacles":
        return tentaclesOverlay(constraint);
      case "district":
        return districtOverlay(constraint);
      case "station-name-length":
        return stationNameLengthOverlay(constraint);
      case "transit-line":
        return transitLineOverlay(constraint);
    }
  });
}
