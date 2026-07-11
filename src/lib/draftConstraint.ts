import type { CategoryKey, Constraint, LngLat } from "./types";

type DraftQuestionKind = "none" | Constraint["kind"];

type DraftConstraintInput = {
  kind: DraftQuestionKind;
  id: string;
  label: string;
  enabled: boolean;
  color: string;
  point: LngLat;
  from: LngLat;
  to: LngLat;
  category: CategoryKey;
  radiusMiles: number;
  radiusAnswer: "inside" | "outside";
  measureAnswer: "closer" | "farther";
  yesNoAnswer: "yes" | "no";
  thermoAnswer: "warmer" | "colder" | "same";
  tentacleRadius: number;
  selectedPoiId: string;
  transitLine: string;
};

export function buildDraftConstraint(input: DraftConstraintInput): Constraint | undefined {
  const base = {
    id: input.id,
    label: input.label,
    enabled: input.enabled,
    color: input.color,
  };

  switch (input.kind) {
    case "none":
      return undefined;
    case "radius":
      return { ...base, kind: "radius", point: input.point, miles: input.radiusMiles, answer: input.radiusAnswer };
    case "thermometer":
      return { ...base, kind: "thermometer", from: input.from, to: input.to, answer: input.thermoAnswer };
    case "matching":
      return { ...base, kind: "matching", point: input.point, category: input.category, answer: input.yesNoAnswer };
    case "measuring":
      return { ...base, kind: "measuring", point: input.point, category: input.category, answer: input.measureAnswer };
    case "tentacles":
      return {
        ...base,
        kind: "tentacles",
        point: input.point,
        category: input.category,
        selectedPoiId: input.selectedPoiId,
        radiusMiles: input.tentacleRadius,
      };
    case "district":
      return { ...base, kind: "district", point: input.point, answer: input.yesNoAnswer };
    case "transit-line":
      return { ...base, kind: "transit-line", line: input.transitLine.trim(), answer: input.yesNoAnswer };
  }
}
