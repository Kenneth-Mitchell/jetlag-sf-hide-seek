import { distanceMiles, lngLatFromFeature, stationLines } from "./geo";
import { snapshot, validStations } from "./snapshot";
import type { CandidateStation, PointFeature } from "./types";

const BROAD_TRANSIT_LINE_KEYS = new Set([
  "BART",
  "CABLE CAR",
  "CALTRAIN",
  "MUNI BUS",
  "MUNI BUS (ADDL.)",
  "MUNI METRO",
  "SFM",
]);

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export function normalizeTransitLine(value: string): string {
  let line = value.trim().replace(/\s+/g, " ");
  if (/^hist(?:orical)?\.?\s+streetcar\s*\(f\)$/i.test(line)) return "F";
  line = line.replace(/^SFM(?:TA)?\s+/i, "");
  line = line.replace(/^CC\s+/i, "");
  return line.toUpperCase();
}

function normalizeStationLineToken(value: string): string[] {
  const normalized = normalizeTransitLine(value);
  if (/^\d+\.\s*\d+$/.test(normalized)) {
    return normalized.split(".").map((part) => part.trim());
  }
  return [normalized];
}

export function isAskableTransitLine(value: string): boolean {
  const normalized = normalizeTransitLine(value);
  return Boolean(normalized) && !BROAD_TRANSIT_LINE_KEYS.has(normalized);
}

function displayTransitLine(line: string): string {
  const normalized = normalizeTransitLine(line);
  if (normalized === "PG DOWNTOWN") return "PG Downtown";
  return normalized;
}

export function stationTransitLines(station: CandidateStation): string[] {
  const cached = stationLineCache.get(station);
  if (cached) return cached;
  const lines = stationLines(station)
    .flatMap(normalizeStationLineToken)
    .filter(isAskableTransitLine)
    .map(displayTransitLine);
  const unique = Array.from(new Set(lines));
  stationLineCache.set(station, unique);
  return unique;
}

const transitLineStops = ((snapshot.layers.transitLineStops?.features ?? []) as PointFeature[]);
const stationLineCache = new WeakMap<CandidateStation, string[]>();
const featureLineCache = new WeakMap<PointFeature, string[]>();
const transitStopCache = new Map<string, PointFeature[]>();
const validStationLineCache = new Map<string, CandidateStation[]>();

function featureTransitLines(feature: PointFeature): string[] {
  const cached = featureLineCache.get(feature);
  if (cached) return cached;
  const lines = feature.properties.lines;
  if (!Array.isArray(lines)) return [];
  const normalized = lines
    .flatMap((line) => normalizeStationLineToken(String(line)))
    .filter(isAskableTransitLine)
    .map(displayTransitLine);
  featureLineCache.set(feature, normalized);
  return normalized;
}

export function transitStopsForLine(line: string): PointFeature[] {
  const normalized = displayTransitLine(line);
  if (!isAskableTransitLine(normalized)) return [];
  const cached = transitStopCache.get(normalized);
  if (cached) return cached;
  const stops = transitLineStops.filter((feature) => featureTransitLines(feature).includes(normalized));
  transitStopCache.set(normalized, stops);
  return stops;
}

function validStationsForLine(line: string): CandidateStation[] {
  const normalized = displayTransitLine(line);
  if (!isAskableTransitLine(normalized)) return [];
  const cached = validStationLineCache.get(normalized);
  if (cached) return cached;
  const stations = validStations.filter((station) => stationTransitLines(station).includes(normalized));
  validStationLineCache.set(normalized, stations);
  return stations;
}

export function transitLineStopPointsForQuestion(line: string): PointFeature[] {
  const gtfsStops = transitStopsForLine(line);
  return gtfsStops.length > 0 ? gtfsStops : validStationsForLine(line);
}

export function allTransitLineOptions(): string[] {
  const lines = new Set<string>();
  for (const stop of transitLineStops) {
    for (const line of featureTransitLines(stop)) lines.add(line);
  }
  for (const station of validStations) {
    for (const line of stationTransitLines(station)) lines.add(line);
  }
  return [...lines].sort(naturalCompare);
}

export function transitLineStopsInStationZone(station: CandidateStation, line: string): boolean {
  const normalized = displayTransitLine(line);
  if (!isAskableTransitLine(normalized)) return false;
  if (stationTransitLines(station).includes(normalized)) return true;

  const stationCenter = lngLatFromFeature(station);
  const routeStops = transitStopsForLine(normalized);
  const stops = routeStops.length > 0 ? routeStops : validStationsForLine(normalized);
  return stops.some((stop) => distanceMiles(stationCenter, lngLatFromFeature(stop)) <= snapshot.hideRadiusMiles);
}

export function validStationsReachedByTransitLine(line: string): CandidateStation[] {
  return validStations.filter((station) => transitLineStopsInStationZone(station, line));
}
