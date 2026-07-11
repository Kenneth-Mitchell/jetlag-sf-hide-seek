import { distanceMiles, lngLatFromFeature } from "./geo";
import { snapshot } from "./snapshot";
import type { LngLat, PointFeature } from "./types";

type ElevationSample = PointFeature & {
  properties: PointFeature["properties"] & {
    elevationFeet: number;
  };
};

const elevationSamples = (snapshot.layers.elevationSamples?.features ?? []) as ElevationSample[];
const cache = new Map<string, number | undefined>();

function pointCacheKey(point: LngLat): string {
  return `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
}

export function elevationFeetAtPoint(point: LngLat): number | undefined {
  const key = pointCacheKey(point);
  if (cache.has(key)) return cache.get(key);

  let best: { sample: ElevationSample; miles: number } | undefined;
  for (const sample of elevationSamples) {
    const miles = distanceMiles(point, lngLatFromFeature(sample));
    if (!best || miles < best.miles) best = { sample, miles };
  }

  const elevation = best?.sample.properties.elevationFeet;
  cache.set(key, elevation);
  return elevation;
}

export function nearestSeaLevelWithDistance(point: LngLat) {
  const elevationFeet = elevationFeetAtPoint(point);
  return elevationFeet === undefined ? undefined : { name: "Sea level", feet: Math.abs(elevationFeet), miles: Math.abs(elevationFeet) / 5280 };
}
