import type { Constraint } from "./types";

export const QUESTION_COLORS = [
  "#0f766e",
  "#7c3aed",
  "#dc2626",
  "#2563eb",
  "#ea580c",
  "#0891b2",
  "#be185d",
  "#4d7c0f",
  "#9333ea",
  "#ca8a04",
] as const;

export function questionColor(index: number): string {
  return QUESTION_COLORS[index % QUESTION_COLORS.length];
}

export function nextQuestionColor(constraints: Constraint[]): string {
  return questionColor(constraints.length);
}

export function constraintColor(constraint: Constraint, index = 0): string {
  return constraint.color || questionColor(index);
}
