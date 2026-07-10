import * as turf from "@turf/turf";
import { pointInFeatureCollection } from "./geo";
import { pointSatisfiesConstraints } from "./constraints";
import { snapshot } from "./snapshot";
import type { Constraint, LngLat } from "./types";

type GridCellProperties = {
  status: "possible";
};

export function buildSurvivalGrid(constraints: Constraint[]): GeoJSON.FeatureCollection<GeoJSON.Polygon, GridCellProperties> {
  const active = constraints.filter((constraint) => constraint.enabled);
  if (active.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }

  const [west, south, east, north] = turf.bbox(snapshot.geometries.playableArea);
  const columns = 54;
  const rows = Math.max(34, Math.round(columns * ((north - south) / (east - west))));
  const dx = (east - west) / columns;
  const dy = (north - south) / rows;
  const features: Array<GeoJSON.Feature<GeoJSON.Polygon, GridCellProperties>> = [];

  for (let x = 0; x < columns; x += 1) {
    for (let y = 0; y < rows; y += 1) {
      const center: LngLat = {
        lng: west + dx * (x + 0.5),
        lat: south + dy * (y + 0.5),
      };
      if (!pointInFeatureCollection(center, snapshot.geometries.playableArea)) continue;
      if (!pointSatisfiesConstraints(center, active)) continue;
      features.push(
        turf.bboxPolygon([west + dx * x, south + dy * y, west + dx * (x + 1), south + dy * (y + 1)], {
          properties: { status: "possible" },
        }) as GeoJSON.Feature<GeoJSON.Polygon, GridCellProperties>,
      );
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}
