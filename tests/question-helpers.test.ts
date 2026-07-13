import { describe, expect, it } from "vitest";
import { buildDraftConstraint } from "../src/lib/draftConstraint";
import { decodeMapState, encodeMapState, hasMapState } from "../src/lib/mapState";
import { answerPastedQuestion } from "../src/lib/pastedQuestion";
import { formatQuestionDraft } from "../src/lib/questionText";
import { vanNessMarket } from "../src/lib/snapshot";
import type { Constraint } from "../src/lib/types";

describe("question helper modules", () => {
  it("builds draft constraints outside the React component", () => {
    const draft = buildDraftConstraint({
      kind: "radius",
      id: "draft",
      label: "Radar / radius",
      enabled: true,
      color: "#7c3aed",
      point: vanNessMarket,
      from: vanNessMarket,
      to: vanNessMarket,
      category: "museums",
      radiusMiles: 1.25,
      radiusAnswer: "inside",
      measureAnswer: "closer",
      yesNoAnswer: "yes",
      thermoAnswer: "warmer",
      tentacleRadius: 1.5,
      selectedPoiId: "unused",
      transitLine: "N",
    });

    expect(draft).toMatchObject({
      kind: "radius",
      miles: 1.25,
      answer: "inside",
      color: "#7c3aed",
    });
  });

  it("answers pasted app-generated radius questions", () => {
    const question = formatQuestionDraft({
      kind: "radius",
      point: vanNessMarket,
      radiusMiles: 0.5,
      category: "museums",
      tentacleRadius: 1.5,
      transitLine: "N",
      from: vanNessMarket,
      to: vanNessMarket,
    });

    const answer = answerPastedQuestion(question, vanNessMarket);

    expect(answer).toMatchObject({
      title: "Radar / radius",
      answer: "Yes",
    });
  });

  it("round-trips URL-safe map share state", () => {
    const constraints: Constraint[] = [{
      id: "test",
      kind: "radius",
      label: "Radar / radius",
      enabled: true,
      color: "#7c3aed",
      point: vanNessMarket,
      miles: 0.5,
      answer: "inside",
    }];

    const encoded = encodeMapState(constraints, vanNessMarket);
    const decoded = decodeMapState(`https://example.test/map#state=${encoded}`);

    expect(encoded).not.toMatch(/[+/=]/);
    expect(decoded.constraints).toMatchObject(constraints);
    expect(decoded.selectedPoint).toEqual(vanNessMarket);
  });

  it("imports old raw base64 links even when plus signs were read as spaces", () => {
    const oldBase64WithPlus =
      "eyJ2ZXJzaW9uIjoyLCJjb25zdHJhaW50cyI6W3siaWQiOiI0aSVcIl0zZWcyaj8hLmYoOXg+V0kiLCJraW5kIjoicmFkaXVzIiwibGFiZWwiOiJfMVUwOCpSN1JRNypYZSRcXDhWTj0iLCJlbmFibGVkIjp0cnVlLCJjb2xvciI6IiM3YzNhZWQiLCJwb2ludCI6eyJsYXQiOjM3Ljc3LCJsbmciOi0xMjIuNDJ9LCJtaWxlcyI6MSwiYW5zd2VyIjoiaW5zaWRlIn1dLCJzZWxlY3RlZFBvaW50Ijp7ImxhdCI6MzcuNzcsImxuZyI6LTEyMi40Mn19";
    const decoded = decodeMapState(`#state=${oldBase64WithPlus}`);

    expect(decoded.constraints?.[0]).toMatchObject({
      kind: "radius",
      answer: "inside",
      point: { lat: 37.77, lng: -122.42 },
    });
  });

  it("imports share links pasted with surrounding text and trailing punctuation", () => {
    const constraints: Constraint[] = [{
      id: "test",
      kind: "radius",
      label: "Radar / radius",
      enabled: true,
      point: vanNessMarket,
      miles: 0.5,
      answer: "outside",
    }];
    const encoded = encodeMapState(constraints, vanNessMarket);
    const pasted = `map is here: https://kenneth-mitchell.github.io/jetlag-sf-hide-seek/#state=${encoded}).`;

    expect(hasMapState(pasted)).toBe(true);
    expect(decodeMapState(pasted).constraints?.[0]).toMatchObject({ kind: "radius", answer: "outside" });
  });

  it("imports state from html-escaped query links", () => {
    const encoded = encodeMapState([], vanNessMarket);
    const pasted = `https://example.test/jetlag-sf-hide-seek/?foo=1&amp;state=${encoded}`;

    expect(hasMapState(pasted)).toBe(true);
    expect(decodeMapState(pasted).selectedPoint).toEqual(vanNessMarket);
  });
});
