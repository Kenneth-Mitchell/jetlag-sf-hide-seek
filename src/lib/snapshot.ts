import rawSnapshot from "../data/sf-snapshot.json";
import type { CandidateStation, CategoryKey, FeatureCollection, PointFeature, Snapshot } from "./types";

export const snapshot = rawSnapshot as unknown as Snapshot;

export const validStations = snapshot.layers.validStations.features as CandidateStation[];

export function getCategoryFeatures(category: CategoryKey): PointFeature[] {
  return (snapshot.layers[category] as FeatureCollection | undefined)?.features ?? [];
}

export function allQuestionCategories(): CategoryKey[] {
  return [
    "railStations",
    "mountains",
    "dogParks",
    "aquariums",
    "golfCourses",
    "museums",
    "movieTheaters",
    "libraries",
    "hospitals",
    "foreignConsulates",
  ];
}

export const vanNessMarket = {
  lat: 37.775252,
  lng: -122.419235,
};
