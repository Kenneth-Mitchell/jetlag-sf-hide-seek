import { describe, expect, it } from "vitest";
import { MATCHING_CATEGORIES, MEASURING_CATEGORIES, TENTACLE_CATEGORIES, UNSUPPORTED_QUESTIONS } from "../src/data/rules";
import { snapshot, validStations } from "../src/lib/snapshot";

describe("frozen SF snapshot", () => {
  it("keeps the authoritative sheet counts", () => {
    expect(validStations).toHaveLength(193);
    expect(snapshot.layers.railStations.features).toHaveLength(35);
    expect(snapshot.layers.mountains.features).toHaveLength(16);
    expect(snapshot.layers.dogParks.features).toHaveLength(33);
    expect(snapshot.layers.aquariums.features).toHaveLength(2);
    expect(snapshot.layers.golfCourses.features).toHaveLength(8);
    expect(snapshot.layers.museums.features).toHaveLength(49);
    expect(snapshot.layers.movieTheaters.features).toHaveLength(17);
    expect(snapshot.layers.libraries.features).toHaveLength(29);
    expect(snapshot.layers.hospitals.features).toHaveLength(16);
    expect(snapshot.layers.foreignConsulates.features).toHaveLength(38);
    expect(snapshot.layers.farmersMarkets.features).toHaveLength(17);
    expect(snapshot.layers.transitLineStops.features.length).toBeGreaterThan(2000);
    expect(snapshot.layers.transitLineStops.features.length).toBeLessThan(snapshot.layers.muniStops.features.length);
  });

  it("records the known source-of-truth caveats", () => {
    expect(snapshot.warnings.some((warning) => warning.includes("Dog Parks"))).toBe(true);
    expect(snapshot.warnings.some((warning) => warning.includes("Farmers Markets"))).toBe(true);
    expect(snapshot.warnings.some((warning) => warning.includes("All Muni Stops"))).toBe(true);
    expect(snapshot.warnings.some((warning) => warning.includes("Transit Line uses SFMTA GTFS"))).toBe(true);
  });

  it("contains current supervisor district and playable-area geometry", () => {
    expect(snapshot.geometries.supervisorDistricts.features).toHaveLength(11);
    expect(snapshot.geometries.playableArea.features).toHaveLength(11);
    expect(snapshot.geometries.coastline.features).toHaveLength(1);
    expect(snapshot.geometries.coastline.features[0].geometry?.type).toBe("MultiPolygon");
  });

  it("exposes farmers markets where frozen point data can answer the question", () => {
    expect(MATCHING_CATEGORIES).toContain("farmersMarkets");
    expect(MEASURING_CATEGORIES).toContain("farmersMarkets");
    expect(TENTACLE_CATEGORIES).toContain("farmersMarkets");
  });

  it("names valid questions that still need frozen geometry before filtering", () => {
    expect(UNSUPPORTED_QUESTIONS.map((question) => question.name)).toEqual(
      expect.arrayContaining(["Sea level", "Body of water", "Street or path"]),
    );
  });
});
