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
  | "farmersMarkets";

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
  };
};

export type CandidateStation = PointFeature & {
  properties: PointFeature["properties"] & {
    id: string;
    name: string;
  };
};

export type Constraint =
  | {
      id: string;
      kind: "radius";
      label: string;
      point: LngLat;
      miles: number;
      answer: "inside" | "outside";
      enabled: boolean;
    }
  | {
      id: string;
      kind: "thermometer";
      label: string;
      from: LngLat;
      to: LngLat;
      answer: "warmer" | "colder" | "same";
      enabled: boolean;
    }
  | {
      id: string;
      kind: "matching";
      label: string;
      point: LngLat;
      category: CategoryKey;
      answer: "yes" | "no";
      enabled: boolean;
    }
  | {
      id: string;
      kind: "measuring";
      label: string;
      point: LngLat;
      category: CategoryKey;
      answer: "closer" | "farther";
      enabled: boolean;
    }
  | {
      id: string;
      kind: "tentacles";
      label: string;
      point: LngLat;
      category: CategoryKey;
      selectedPoiId: string;
      radiusMiles: number;
      enabled: boolean;
    }
  | {
      id: string;
      kind: "district";
      label: string;
      point: LngLat;
      answer: "yes" | "no";
      enabled: boolean;
    }
  | {
      id: string;
      kind: "station-name-length";
      label: string;
      point: LngLat;
      answer: "yes" | "no";
      enabled: boolean;
    }
  | {
      id: string;
      kind: "transit-line";
      label: string;
      line: string;
      answer: "yes" | "no";
      enabled: boolean;
    };
