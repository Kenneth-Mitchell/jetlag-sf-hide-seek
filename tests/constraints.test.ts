import * as turf from "@turf/turf";
import { describe, expect, it } from "vitest";
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
