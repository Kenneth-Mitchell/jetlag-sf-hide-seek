export type LngLat = {
  lng: number;
  lat: number;
};

export type PointFeature = {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    id: string;
    name: string;
    category: string;
    sourceSheet: string;
    enabled?: boolean;
    referenceOnly?: boolean;
    associated_lines?: string;
    other_systems?: string;
    primary_system?: string;
    SUPERVISOR_DISTRICT?: string | number;
    [key: string]: unknown;
  };
};

export type FeatureCollection<T extends PointFeature = PointFeature> = {
  type: "FeatureCollection";
  features: T[];
};

export type CategoryKey =
  | "railStations"
  | "mountains"
  | "dogParks"
  | "aquariums"
  | "golfCourses"
  | "museums"
  | "movieTheaters"
  | "libraries"
  | "hospitals"
  | "foreignConsulates"
  | "farmersMarkets"
  | "coastline";

export type Snapshot = {
  schemaVersion: number;
  generatedAt: string;
  rulesVersion: string;
  hideRadiusMiles: number;
  sources: Record<string, string>;
  warnings: string[];
  integrity: Record<string, { features: number; checksum: string; sheet?: string; source?: string }>;
  layers: Record<string, FeatureCollection>;
  geometries: {
    playableArea: GeoJSON.FeatureCollection;
    supervisorDistricts: GeoJSON.FeatureCollection;
    coastline: GeoJSON.FeatureCollection;
  };
};

export type CandidateStation = PointFeature & {
  properties: PointFeature["properties"] & {
    id: string;
    name: string;
  };
};

type ConstraintBase = {
  id: string;
  label: string;
  enabled: boolean;
  color?: string;
};

export type Constraint = ConstraintBase &
  (
    | {
        kind: "radius";
        point: LngLat;
        miles: number;
        answer: "inside" | "outside";
      }
    | {
        kind: "thermometer";
        from: LngLat;
        to: LngLat;
        answer: "warmer" | "colder" | "same";
      }
    | {
        kind: "matching";
        point: LngLat;
        category: CategoryKey;
        answer: "yes" | "no";
      }
    | {
        kind: "measuring";
        point: LngLat;
        category: CategoryKey;
        answer: "closer" | "farther";
      }
    | {
        kind: "tentacles";
        point: LngLat;
        category: CategoryKey;
        selectedPoiId: string;
        radiusMiles: number;
      }
    | {
        kind: "district";
        point: LngLat;
        answer: "yes" | "no";
      }
    | {
        kind: "transit-line";
        line: string;
        answer: "yes" | "no";
      }
  );
