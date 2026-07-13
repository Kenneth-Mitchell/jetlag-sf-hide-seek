import type { Constraint, LngLat } from "./types";

export type SavedMapState = {
  version?: number;
  constraints?: Constraint[];
  selectedPoint?: LngLat;
};

function base64ToBase64Url(value: string): string {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBase64(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
}

function extractEncodedState(value: string): string {
  const trimmed = value.trim().replace(/&amp;/g, "&");
  const urlMatch = trimmed.match(/https?:\/\/\S+/);
  const candidate = (urlMatch?.[0] ?? trimmed).replace(/[),.;\]]+$/g, "");

  try {
    const parsed = new URL(candidate);
    const hashState = new URLSearchParams(parsed.hash.replace(/^#/, "")).get("state");
    const queryState = parsed.searchParams.get("state");
    return hashState ?? queryState ?? candidate;
  } catch {
    const stateMatch = candidate.match(/(?:^|[#?&])state=([^&\s]+)/);
    return stateMatch?.[1]?.replace(/[),.;\]]+$/g, "") ?? candidate;
  }
}

function parseSavedMapState(raw: string): SavedMapState {
  const parsed = JSON.parse(raw) as Constraint[] | SavedMapState;
  return Array.isArray(parsed) ? { version: 1, constraints: parsed } : parsed;
}

function maybeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function encodeMapState(constraints: Constraint[], selectedPoint: LngLat): string {
  return base64ToBase64Url(btoa(JSON.stringify({ version: 2, constraints, selectedPoint })));
}

export function hasMapState(value: string): boolean {
  return /(?:^|[#?&])state=/.test(value.replace(/&amp;/g, "&"));
}

export function decodeMapState(value: string): SavedMapState {
  const extracted = extractEncodedState(value);
  const decoded = maybeDecodeURIComponent(extracted).trim();
  if (decoded.startsWith("{") || decoded.startsWith("[")) return parseSavedMapState(decoded);

  const compact = decoded.replace(/\s/g, "+");
  try {
    return parseSavedMapState(atob(base64UrlToBase64(compact)));
  } catch {
    return parseSavedMapState(atob(compact));
  }
}
