import * as turf from "@turf/turf";
import { describe, expect, it } from "vitest";
import { buildConstraintOverlays, buildTentacleAnswerPreviewOverlays } from "../src/lib/constraintOverlays";
import { applyConstraints, canonicalAnswers, stationSurvivesConstraint } from "../src/lib/constraints";
import { distanceMiles, lngLatFromFeature } from "../src/lib/geo";
import { getCategoryFeatures, validStations, vanNessMarket } from "../src/lib/snapshot";
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
