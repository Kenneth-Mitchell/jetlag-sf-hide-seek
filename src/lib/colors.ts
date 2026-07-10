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

export const ANSWER_COLORS = [
  "#e11d48",
  "#2563eb",
  "#f59e0b",
  "#16a34a",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
  "#0d9488",
  "#be123c",
  "#7c2d12",
  "#0369a1",
  "#a21caf",
  "#15803d",
  "#b45309",
  "#4338ca",
  "#0f766e",
  "#c026d3",
  "#84cc16",
  "#0284c7",
  "#dc2626",
  "#7c3aed",
] as const;

export function questionColor(index: number): string {
  return QUESTION_COLORS[index % QUESTION_COLORS.length];
}

export function answerColor(index: number): string {
  return ANSWER_COLORS[index % ANSWER_COLORS.length];
}

export function nextQuestionColor(constraints: Constraint[]): string {
  return questionColor(constraints.length);
}

export function constraintColor(constraint: Constraint, index = 0): string {
  return constraint.color || questionColor(index);
}
