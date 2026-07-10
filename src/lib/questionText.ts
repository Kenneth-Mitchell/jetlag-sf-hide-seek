import { CATEGORY_LABELS } from "../data/rules";
import { nearestFeature, nearestFeatureWithDistance } from "./geo";
import { getCategoryFeatures, snapshot } from "./snapshot";
import type { CategoryKey, Constraint, LngLat } from "./types";

function pointPhrase(point: LngLat): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

function categoryPhrase(category: CategoryKey): string {
  return CATEGORY_LABELS[category].toLowerCase();
}

export function formatQuestionDraft({
  kind,
  point,
  category,
  radiusMiles,
  tentacleRadius,
  transitLine,
  from,
  to,
}: {
  kind: Constraint["kind"];
  point: LngLat;
  category: CategoryKey;
  radiusMiles: number;
  tentacleRadius: number;
  transitLine: string;
  from: LngLat;
  to: LngLat;
}): string {
  if (kind === "radius") {
    return `Are you within ${radiusMiles.toFixed(2)} miles of my marked point (${pointPhrase(point)})?`;
  }
  if (kind === "thermometer") {
    return `When I moved from A (${pointPhrase(from)}) to B (${pointPhrase(to)}), did I get warmer, colder, or stay the same?`;
  }
  if (kind === "matching") {
    const nearest = nearestFeature(point, getCategoryFeatures(category));
    const suffix = nearest ? ` Mine is ${nearest.properties.name}.` : "";
    return `Is your nearest ${categoryPhrase(category)} the same as my nearest ${categoryPhrase(category)}?${suffix}`;
  }
  if (kind === "measuring") {
    const nearest = nearestFeatureWithDistance(point, getCategoryFeatures(category));
    const suffix = nearest ? ` My nearest is ${nearest.feature.properties.name} (${nearest.miles.toFixed(2)} miles).` : "";
    return `Compared to me, are you closer to or farther from the nearest ${categoryPhrase(category)}?${suffix}`;
  }
  if (kind === "tentacles") {
    return `Of the ${categoryPhrase(category)} locations within ${tentacleRadius.toFixed(1)} miles of me, which one are you nearest to?`;
  }
  if (kind === "district") {
    return "Are you in the same San Francisco Supervisorial District as me?";
  }
  return `Does the ${transitLine.trim() || "[line]"} line stop in your hiding zone?`;
}

export function formatAppliedQuestion(constraint: Constraint): string {
  if (constraint.kind === "radius") {
    return `${formatQuestionDraft({
      kind: constraint.kind,
      point: constraint.point,
      category: "museums",
      radiusMiles: constraint.miles,
      tentacleRadius: 1,
      transitLine: "",
      from: constraint.point,
      to: constraint.point,
    })} Answer: ${constraint.answer === "inside" ? "yes" : "no"}.`;
  }
  if (constraint.kind === "thermometer") {
    return `${formatQuestionDraft({
      kind: constraint.kind,
      point: constraint.to,
      category: "museums",
      radiusMiles: 1,
      tentacleRadius: 1,
      transitLine: "",
      from: constraint.from,
      to: constraint.to,
    })} Answer: ${constraint.answer}.`;
  }
  if (constraint.kind === "matching" || constraint.kind === "measuring" || constraint.kind === "tentacles") {
    return `${formatQuestionDraft({
      kind: constraint.kind,
      point: constraint.point,
      category: constraint.category,
      radiusMiles: 1,
      tentacleRadius: constraint.kind === "tentacles" ? constraint.radiusMiles : 1,
      transitLine: "",
      from: constraint.point,
      to: constraint.point,
    })} Answer: ${constraint.kind === "tentacles" ? "selected POI" : constraint.answer}.`;
  }
  if (constraint.kind === "district") {
    return `${formatQuestionDraft({
      kind: constraint.kind,
      point: constraint.point,
      category: "museums",
      radiusMiles: 1,
      tentacleRadius: 1,
      transitLine: "",
      from: constraint.point,
      to: constraint.point,
    })} Answer: ${constraint.answer}.`;
  }
  return `${formatQuestionDraft({
    kind: constraint.kind,
    point: { lat: 0, lng: 0 },
    category: "museums",
    radiusMiles: snapshot.hideRadiusMiles,
    tentacleRadius: 1,
    transitLine: constraint.line,
    from: { lat: 0, lng: 0 },
    to: { lat: 0, lng: 0 },
  })} Answer: ${constraint.answer}.`;
}
