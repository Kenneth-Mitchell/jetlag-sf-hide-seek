import type { Constraint } from "./types";

export const QUESTION_COLORS = [
  "#7c3aed",
  "#dc2626",
  "#2563eb",
  "#ea580c",
  "#be185d",
  "#ca8a04",
  "#9333ea",
  "#e11d48",
  "#4f46e5",
  "#b45309",
] as const;

export const ANSWER_COLORS = [
  "#e11d48",
  "#2563eb",
  "#f59e0b",
  "#9333ea",
  "#db2777",
  "#ea580c",
  "#4f46e5",
  "#be123c",
  "#7c2d12",
  "#0369a1",
  "#a21caf",
  "#b45309",
  "#4338ca",
  "#c026d3",
  "#0284c7",
  "#dc2626",
  "#7c3aed",
  "#f97316",
  "#1d4ed8",
  "#9d174d",
  "#d97706",
  "#6d28d9",
  "#b91c1c",
  "#0c4a6e",
  "#a16207",
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
