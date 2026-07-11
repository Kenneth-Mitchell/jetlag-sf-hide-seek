import * as turf from "@turf/turf";
import { describe, expect, it } from "vitest";
import { distanceToArealCategoryMiles, nearestArealCategoryWithDistance } from "../src/lib/arealCategories";
import { ANSWER_COLORS, QUESTION_COLORS, answerColor, nextQuestionColor } from "../src/lib/colors";
import { buildConstraintOverlays, buildDistrictAnswerPreviewOverlays, buildMatchingAnswerPreviewOverlays, buildTentacleAnswerPreviewOverlays } from "../src/lib/constraintOverlays";
import { applyConstraints, canonicalAnswers, stationSurvivesConstraint } from "../src/lib/constraints";
import { districtNumberFromFeature, supervisorDistrictFeatures } from "../src/lib/districts";
import { distanceMiles, lngLatFromFeature } from "../src/lib/geo";
import { distanceToLinearCategoryMiles, linearCategoryLines } from "../src/lib/linearCategories";
import { getCategoryFeatures, validStations, vanNessMarket } from "../src/lib/snapshot";
import { allTransitLineOptions, transitLineStopPointsForQuestion, transitLineStopsInStationZone, validStationsReachedByTransitLine } from "../src/lib/transit";
import type { CandidateStation, Constraint, LngLat } from "../src/lib/types";

function station(name: string): CandidateStation {
  const found = validStations.find((candidate) => candidate.properties.name === name);
  if (!found) throw new Error(`Missing station fixture: ${name}`);
  return found;
}

function randomPointNear(center: LngLat, radiusMiles: number, seed: number): LngLat {
  const distance = radiusMiles * ((seed * 9301 + 49297) % 233280) / 233280;
  const bearing = (seed * 137.508) % 360;
  const point = turf.destination(turf.point([center.lng, center.lat]), distance, bearing, { units: "miles" });
  return { lng: point.geometry.coordinates[0], lat: point.geometry.coordinates[1] };
}

describe("constraint engine", () => {
  it("keeps default question and answer colors distinct from station-zone colors", () => {
    const stationColors = new Set(["#0f766e", "#14b8a6"]);
    expect(stationColors.has(nextQuestionColor([]))).toBe(false);
    expect(stationColors.has(answerColor(0))).toBe(false);
    expect(QUESTION_COLORS.some((color) => stationColors.has(color))).toBe(false);
    expect(ANSWER_COLORS.some((color) => stationColors.has(color))).toBe(false);
  });

  it("finds canonical nearest POIs from the frozen curated sets", () => {
    const answers = canonicalAnswers({ lat: 37.8008, lng: -122.3986 });
    expect((answers.nearest.aquariums as { name: string }).name).toBe("Aquarium of the Bay");
    expect((answers.nearest.museums as { name: string }).name).toBe("Exploratorium");
  });

  it("keeps a station whose hiding zone intersects a truthful radius answer", () => {
    const fixture = station("Van Ness Station");
    const center = lngLatFromFeature(fixture);
    const reference = { lat: center.lat + 0.01, lng: center.lng };
    const truth = distanceMiles(center, reference) <= 1 ? "inside" : "outside";
    const constraint: Constraint = {
      id: "radius",
      kind: "radius",
      label: "Radius",
      point: reference,
      miles: 1,
      answer: truth,
      enabled: true,
    };
    expect(stationSurvivesConstraint(fixture, constraint)).toBe(true);
  });

  it("applies constraints in a commutative way", () => {
    const a: Constraint = {
      id: "a",
      kind: "matching",
      label: "Museum",
      point: { lat: 37.7715, lng: -122.4691 },
      category: "museums",
      answer: "yes",
      enabled: true,
    };
    const b: Constraint = {
      id: "b",
      kind: "measuring",
      label: "Hospital",
      point: vanNessMarket,
      category: "hospitals",
      answer: "farther",
      enabled: true,
    };
    const first = applyConstraints([a, b]).map((candidate) => candidate.properties.id).sort();
    const second = applyConstraints([b, a]).map((candidate) => candidate.properties.id).sort();
    expect(first).toEqual(second);
  });

  it("builds drawable vector overlays for active constraints", () => {
    const constraints: Constraint[] = [{
      id: "overlay-radius",
      kind: "radius",
      label: "Radius",
      point: vanNessMarket,
      miles: 1,
      answer: "inside",
      enabled: true,
    }, {
      id: "overlay-thermo",
      kind: "thermometer",
      label: "Thermometer",
      from: { lat: 37.77, lng: -122.45 },
      to: vanNessMarket,
      answer: "warmer",
      enabled: true,
    }, {
      id: "overlay-match",
      kind: "matching",
      label: "Museum",
      point: vanNessMarket,
      category: "museums",
      answer: "yes",
      enabled: true,
    }, {
      id: "overlay-measure",
      kind: "measuring",
      label: "Dog park",
      point: vanNessMarket,
      category: "dogParks",
      answer: "closer",
      enabled: true,
    }, {
      id: "overlay-district",
      kind: "district",
      label: "District",
      point: vanNessMarket,
      answer: "yes",
      enabled: true,
    }];
    const overlays = buildConstraintOverlays(constraints);
    expect(overlays.some((overlay) => overlay.kind === "circle")).toBe(true);
    expect(overlays.some((overlay) => overlay.kind === "polygon")).toBe(true);
    expect(overlays.every((overlay) => overlay.kind !== "line" || overlay.coordinates.length >= 2)).toBe(true);
  });

  it("carries question colors into map overlays", () => {
    const constraints: Constraint[] = [{
      id: "purple-radius",
      kind: "radius",
      label: "Radius",
      point: vanNessMarket,
      miles: 1,
      answer: "inside",
      enabled: true,
      color: "#123456",
    }, {
      id: "fallback-radius",
      kind: "radius",
      label: "Radius",
      point: { lat: 37.78, lng: -122.43 },
      miles: 0.5,
      answer: "inside",
      enabled: true,
    }];
    const overlays = buildConstraintOverlays(constraints);
    expect(overlays[0].color).toBe("#123456");
    expect(overlays[1].color).toBeTruthy();
    expect(overlays[1].color).not.toBe(overlays[0].color);
  });

  it("builds colored tentacles answer Voronoi previews", () => {
    const museums = getCategoryFeatures("museums").slice(0, 3);
    const overlays = buildTentacleAnswerPreviewOverlays(
      {
        id: "tentacle-preview",
        kind: "tentacles",
        label: "Tentacles",
        point: vanNessMarket,
        category: "museums",
        selectedPoiId: museums[1].properties.id,
        radiusMiles: 1.5,
        enabled: true,
        color: "#123456",
      },
      museums.map((feature, index) => ({
        featureId: feature.properties.id,
        color: ["#111111", "#222222", "#333333"][index],
        selected: index === 1,
      })),
    );
    const polygons = overlays.filter((overlay) => overlay.kind === "polygon");
    expect(polygons).toHaveLength(3);
    expect(polygons.map((overlay) => overlay.color)).toEqual(["#111111", "#333333", "#222222"]);
    expect(overlays.some((overlay) => overlay.kind === "circle" && overlay.color === "#123456")).toBe(true);
  });

  it("builds colored matching Voronoi previews with the selected cell last", () => {
    const museums = getCategoryFeatures("museums");
    const overlays = buildMatchingAnswerPreviewOverlays(
      {
        id: "matching-preview",
        kind: "matching",
        label: "Matching",
        point: vanNessMarket,
        category: "museums",
        answer: "yes",
        enabled: true,
        color: "#123456",
      },
      museums.map((feature, index) => ({
        featureId: feature.properties.id,
        color: answerColor(index),
        selected: index === 2,
      })),
    );
    const polygons = overlays.filter((overlay) => overlay.kind === "polygon");
    expect(polygons).toHaveLength(museums.length);
    expect(new Set(polygons.map((overlay) => overlay.color)).size).toBeGreaterThan(10);
    expect(polygons.at(-1)?.color).toBe(answerColor(2));
    expect(polygons.at(-1)?.weight).toBeGreaterThan(polygons[0].weight ?? 0);
    expect(polygons[0].fillOpacity).toBeLessThan(polygons.at(-1)?.fillOpacity ?? 0);
  });

  it("builds colored supervisorial district previews", () => {
    const districts = supervisorDistrictFeatures();
    const overlays = buildDistrictAnswerPreviewOverlays(
      districts.map((feature, index) => ({
        district: districtNumberFromFeature(feature) ?? String(index + 1),
        color: answerColor(index),
        selected: index === 4,
      })),
    );
    const polygons = overlays.filter((overlay) => overlay.kind === "polygon");
    expect(polygons).toHaveLength(11);
    expect(new Set(polygons.map((overlay) => overlay.color)).size).toBe(11);
    expect(polygons.at(-1)?.color).toBe(answerColor(4));
    expect(polygons.at(-1)?.weight).toBeGreaterThan(polygons[0].weight ?? 0);
  });

  it("uses real route stop buffers for the Transit Line question", () => {
    expect(allTransitLineOptions()).toContain("38");
    expect(allTransitLineOptions()).toContain("38R");
    expect(allTransitLineOptions()).toContain("N");
    expect(allTransitLineOptions()).not.toContain("Muni Bus");
    expect(allTransitLineOptions()).not.toContain("Muni Metro");
    expect(transitLineStopPointsForQuestion("38").length).toBeGreaterThan(50);
    expect(transitLineStopsInStationZone(station("Sutter St & Fillmore St"), "38")).toBe(true);
    expect(transitLineStopsInStationZone(station("McAllister St & Van Ness Ave"), "38")).toBe(false);
  });

  it("draws Transit Line overlays on affected hiding-station zones only", () => {
    const overlays = buildConstraintOverlays([{
      id: "transit-route-overlay",
      kind: "transit-line",
      label: "Transit line",
      line: "38",
      answer: "yes",
      enabled: true,
      color: "#123456",
    }]);
    const circles = overlays.filter((overlay) => overlay.kind === "circle");
    const reachedStations = validStationsReachedByTransitLine("38");
    const overlayCenters = new Set(circles.map((overlay) => `${overlay.center.lat.toFixed(6)},${overlay.center.lng.toFixed(6)}`));
    expect(circles).toHaveLength(reachedStations.length);
    expect(circles.length).toBeGreaterThan(10);
    expect(circles.length).toBeLessThan(validStations.length);
    expect(circles.every((overlay) => overlay.color === "#123456")).toBe(true);
    for (const station of reachedStations) {
      const center = lngLatFromFeature(station);
      expect(overlayCenters.has(`${center.lat.toFixed(6)},${center.lng.toFixed(6)}`)).toBe(true);
    }
  });

  it("measures coastline as the nearer Bay or Pacific shoreline", () => {
    const oceanBeach = { lat: 37.7609, lng: -122.5102 };
    const oceanBeachDistance = distanceToLinearCategoryMiles(oceanBeach, "coastline");
    const vanNessDistance = distanceToLinearCategoryMiles(vanNessMarket, "coastline");
    const canonical = canonicalAnswers(vanNessMarket).nearest.coastline as { name: string; miles: number };
    expect(linearCategoryLines("coastline").length).toBeGreaterThan(10);
    expect(oceanBeachDistance).toBeLessThan(0.2);
    expect(vanNessDistance).toBeGreaterThan(1);
    expect(canonical.name).toBe("Coastline");
    expect(canonical.miles).toBe(vanNessDistance);
  });

  it("draws coastline distance bands using the actual shoreline geometry", () => {
    const overlays = buildConstraintOverlays([{
      id: "coastline-overlay",
      kind: "measuring",
      label: "Coastline",
      point: vanNessMarket,
      category: "coastline",
      answer: "closer",
      enabled: true,
      color: "#123456",
    }]);
    expect(overlays.some((overlay) => overlay.kind === "line")).toBe(true);
    expect(overlays.some((overlay) => overlay.kind === "polygon")).toBe(true);
    expect(overlays.every((overlay) => overlay.color === "#123456")).toBe(true);
  });

  it("keeps a truthful coastline measuring answer", () => {
    const fixture = station("Judah St & La Playa St (Ocean Beach)");
    const hiderDistance = distanceToLinearCategoryMiles(lngLatFromFeature(fixture), "coastline");
    const seekerDistance = distanceToLinearCategoryMiles(vanNessMarket, "coastline");
    const constraint: Constraint = {
      id: "coastline-measure",
      kind: "measuring",
      label: "Coastline",
      point: vanNessMarket,
      category: "coastline",
      answer: (hiderDistance ?? 0) <= (seekerDistance ?? 0) ? "closer" : "farther",
      enabled: true,
    };
    expect(hiderDistance).toBeLessThan(seekerDistance ?? 0);
    expect(stationSurvivesConstraint(fixture, constraint)).toBe(true);
  });

  it("measures parks from frozen park polygons", () => {
    const glenCanyon = { lat: 37.74017, lng: -122.44268 };
    const vanNessDistance = distanceToArealCategoryMiles(vanNessMarket, "parks");
    const parkDistance = distanceToArealCategoryMiles(glenCanyon, "parks");
    const nearest = nearestArealCategoryWithDistance(glenCanyon, "parks");

    expect(vanNessDistance).toBeGreaterThan(0.02);
    expect(parkDistance).toBeLessThan(0.02);
    expect(nearest?.name).toMatch(/Glen Canyon|Park/i);
  });

  it("does not eliminate sampled truthful hider stations for matching and measuring answers", () => {
    const fixtures = validStations.filter((_, index) => index % 17 === 0).slice(0, 10);
    for (const [index, fixture] of fixtures.entries()) {
      const center = lngLatFromFeature(fixture);
      const hiddenPoint = randomPointNear(center, 0.25, index + 1);
      const museumNearestToHider = canonicalAnswers(hiddenPoint).nearest.museums as { name: string };
      const museumNearestToSeeker = canonicalAnswers(vanNessMarket).nearest.museums as { name: string };
      const matching: Constraint = {
        id: `match-${index}`,
        kind: "matching",
        label: "Museum",
        point: vanNessMarket,
        category: "museums",
        answer: museumNearestToHider.name === museumNearestToSeeker.name ? "yes" : "no",
        enabled: true,
      };
      const dogParks = getCategoryFeatures("dogParks");
      const hiderDogParkDistance = Math.min(...dogParks.map((park) => distanceMiles(hiddenPoint, lngLatFromFeature(park))));
      const seekerDogParkDistance = Math.min(...dogParks.map((park) => distanceMiles(vanNessMarket, lngLatFromFeature(park))));
      const measuring: Constraint = {
        id: `measure-${index}`,
        kind: "measuring",
        label: "Dog park",
        point: vanNessMarket,
        category: "dogParks",
        answer: hiderDogParkDistance <= seekerDogParkDistance ? "closer" : "farther",
        enabled: true,
      };
      expect(stationSurvivesConstraint(fixture, matching), fixture.properties.name).toBe(true);
      expect(stationSurvivesConstraint(fixture, measuring), fixture.properties.name).toBe(true);
    }
  });
});
