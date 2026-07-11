import { CATEGORY_LABELS } from "../data/rules";
import { pointSatisfiesConstraint } from "./constraints";
import { districtNumberAtPoint } from "./districts";
import { nearestSeaLevelWithDistance } from "./elevation";
import { distanceMiles, lngLatFromFeature, nearestFeature } from "./geo";
import { distanceToArealCategoryMiles, isArealCategory } from "./arealCategories";
import { distanceToLinearCategoryMiles, isLinearCategory } from "./linearCategories";
import { getCategoryFeatures } from "./snapshot";
import type { CategoryKey, LngLat } from "./types";

export type PastedQuestionAnswer = {
  title: string;
  answer: string;
  detail: string;
};

function parseQuestionPoint(value: string): LngLat | undefined {
  const match = value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  return { lat: Number(match[1]), lng: Number(match[2]) };
}

function normalizeQuestionText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function categoryFromPhrase(value: string): CategoryKey | undefined {
  const normalized = value.toLowerCase().replace(/^the\s+/, "").trim();
  return (Object.keys(CATEGORY_LABELS) as CategoryKey[]).find((key) => {
    const label = CATEGORY_LABELS[key].toLowerCase();
    return normalized === label || normalized === label.replace(/^the\s+/, "");
  });
}

function distanceForCategory(point: LngLat, category: CategoryKey): number | undefined {
  if (category === "seaLevel") return nearestSeaLevelWithDistance(point)?.miles;
  if (isLinearCategory(category)) return distanceToLinearCategoryMiles(point, category);
  if (isArealCategory(category)) return distanceToArealCategoryMiles(point, category);
  const nearest = nearestFeature(point, getCategoryFeatures(category));
  return nearest ? distanceMiles(point, lngLatFromFeature(nearest)) : undefined;
}

export function answerPastedQuestion(text: string, hiderPoint: LngLat): PastedQuestionAnswer | undefined {
  const question = normalizeQuestionText(text);
  if (!question) return undefined;

  const radiusMatch = question.match(/within\s+(\d+(?:\.\d+)?)\s+miles?\s+of\s+my\s+marked\s+point\s+\(([^)]+)\)/i);
  if (radiusMatch) {
    const point = parseQuestionPoint(radiusMatch[2]);
    if (!point) return { title: "Radar / radius", answer: "Could not parse point", detail: "The pasted question has an unreadable coordinate." };
    const miles = Number(radiusMatch[1]);
    const actual = distanceMiles(hiderPoint, point);
    return {
      title: "Radar / radius",
      answer: actual <= miles ? "Yes" : "No",
      detail: `You are ${actual.toFixed(2)} mi from their point; cutoff is ${miles.toFixed(2)} mi.`,
    };
  }

  const thermoMatch = question.match(/from\s+A\s+\(([^)]+)\)\s+to\s+B\s+\(([^)]+)\)/i);
  if (thermoMatch) {
    const from = parseQuestionPoint(thermoMatch[1]);
    const to = parseQuestionPoint(thermoMatch[2]);
    if (!from || !to) return { title: "Thermometer", answer: "Could not parse A/B", detail: "The pasted question has unreadable coordinates." };
    const fromMiles = distanceMiles(hiderPoint, from);
    const toMiles = distanceMiles(hiderPoint, to);
    const answer = Math.abs(fromMiles - toMiles) <= 0.02 ? "Same" : toMiles < fromMiles ? "Warmer" : "Colder";
    return {
      title: "Thermometer",
      answer,
      detail: `A is ${fromMiles.toFixed(2)} mi away; B is ${toMiles.toFixed(2)} mi away.`,
    };
  }

  const matchingMatch = question.match(/nearest\s+(.+?)\s+the\s+same\s+as\s+my\s+nearest\s+.+?\?\s+Mine\s+is\s+(.+?)\./i);
  if (matchingMatch) {
    const category = categoryFromPhrase(matchingMatch[1]);
    if (!category) return { title: "Matching", answer: "Unknown category", detail: `Could not match "${matchingMatch[1]}" to a data category.` };
    const seekerName = matchingMatch[2].trim().toLowerCase();
    const hiderNearest = nearestFeature(hiderPoint, getCategoryFeatures(category));
    if (!hiderNearest) return { title: "Matching", answer: "No data", detail: `No ${CATEGORY_LABELS[category]} data is available.` };
    const same = hiderNearest.properties.name.toLowerCase() === seekerName;
    return {
      title: "Matching nearest POI",
      answer: same ? "Yes" : "No",
      detail: `Your nearest ${CATEGORY_LABELS[category].toLowerCase()} is ${hiderNearest.properties.name}.`,
    };
  }

  const seaLevelMatch = question.match(/closer\s+to\s+or\s+farther\s+from\s+sea\s+level\?\s+My\s+elevation\s+is\s+(\d+(?:\.\d+)?)\s+feet?/i);
  if (seaLevelMatch) {
    const referenceFeet = Number(seaLevelMatch[1]);
    const actual = nearestSeaLevelWithDistance(hiderPoint);
    if (!actual) return { title: "Measuring", answer: "No data", detail: "No frozen elevation sample is available." };
    return {
      title: "Measuring distance",
      answer: actual.feet <= referenceFeet ? "Closer" : "Farther",
      detail: `You are ${actual.feet.toFixed(0)} ft from sea level; their reference is ${referenceFeet.toFixed(0)} ft.`,
    };
  }

  const measuringMatch = question.match(/closer\s+to\s+or\s+farther\s+from\s+(?:the\s+)?(?:nearest\s+)?(.+?)\?\s+(?:My\s+distance\s+is|My\s+nearest\s+is\s+.+?\()\s*(\d+(?:\.\d+)?)\s+miles?/i);
  if (measuringMatch) {
    const category = categoryFromPhrase(measuringMatch[1]);
    if (!category) return { title: "Measuring", answer: "Unknown category", detail: `Could not match "${measuringMatch[1]}" to a data category.` };
    const reference = Number(measuringMatch[2]);
    const actual = distanceForCategory(hiderPoint, category);
    if (actual === undefined) return { title: "Measuring", answer: "No data", detail: `No ${CATEGORY_LABELS[category]} distance is available.` };
    return {
      title: "Measuring distance",
      answer: actual <= reference ? "Closer" : "Farther",
      detail: `You are ${actual.toFixed(2)} mi away; their reference is ${reference.toFixed(2)} mi.`,
    };
  }

  const transitMatch = question.match(/does\s+the\s+(.+?)\s+stop\s+in\s+your\s+hiding\s+zone/i);
  if (transitMatch) {
    const line = transitMatch[1].trim();
    const yes = pointSatisfiesConstraint(hiderPoint, {
      id: "__pasted__",
      label: "Transit line",
      enabled: true,
      kind: "transit-line",
      line,
      answer: "yes",
    });
    return {
      title: "Transit line",
      answer: yes ? "Yes" : "No",
      detail: yes ? `${line} has a stop in a possible hiding station zone here.` : `${line} does not stop in a possible hiding station zone here.`,
    };
  }

  const districtWithAnswerMatch = question.match(/same\s+San Francisco\s+Supervisorial\s+District.+?\bMine\s+is\s+D?(\d+)/i);
  if (districtWithAnswerMatch) {
    const seekerDistrict = districtWithAnswerMatch[1];
    const hiderDistrict = districtNumberAtPoint(hiderPoint);
    if (!hiderDistrict) {
      return { title: "Supervisorial district", answer: "Unknown", detail: "Your current map tap is outside the district layer." };
    }
    return {
      title: "Supervisorial district",
      answer: hiderDistrict === seekerDistrict ? "Yes" : "No",
      detail: `You are in D${hiderDistrict}; seeker is in D${seekerDistrict}.`,
    };
  }

  const tentacleWithOptionsMatch = question.match(/Of the\s+(.+?)\s+locations\s+within\s+(\d+(?:\.\d+)?)\s+miles?\s+of\s+me.+?\bOptions:\s+(.+?)(?:\.?$)/i);
  if (tentacleWithOptionsMatch) {
    const category = categoryFromPhrase(tentacleWithOptionsMatch[1]);
    if (!category) return { title: "Tentacles", answer: "Unknown category", detail: `Could not match "${tentacleWithOptionsMatch[1]}" to a data category.` };
    const optionNames = tentacleWithOptionsMatch[3]
      .split(";")
      .map((name) => name.trim().replace(/\.$/, ""))
      .filter(Boolean);
    const optionSet = new Set(optionNames.map((name) => name.toLowerCase()));
    const features = getCategoryFeatures(category).filter((feature) => optionSet.has(feature.properties.name.toLowerCase()));
    if (features.length === 0) return { title: "Tentacles", answer: "No options found", detail: "The pasted option names did not match frozen data." };
    const nearest = features
      .map((feature) => ({ feature, miles: distanceMiles(hiderPoint, lngLatFromFeature(feature)) }))
      .sort((a, b) => a.miles - b.miles)[0];
    return {
      title: "Tentacles",
      answer: nearest.feature.properties.name,
      detail: `${nearest.miles.toFixed(2)} mi from your current map tap.`,
    };
  }

  if (/same\s+San Francisco\s+Supervisorial\s+District/i.test(question)) {
    return {
      title: "Supervisorial district",
      answer: "Need seeker district",
      detail: "This pasted question does not include the seeker's district, so the exact yes/no answer cannot be derived from text alone.",
    };
  }

  if (/which\s+one\s+are\s+you\s+nearest\s+to/i.test(question)) {
    return {
      title: "Tentacles",
      answer: "Need option set",
      detail: "This pasted question does not include the seeker's point or option list, so the exact answer set cannot be reconstructed.",
    };
  }

  return {
    title: "Unknown question",
    answer: "Could not parse",
    detail: "Paste one of the app's copyable questions, including coordinates/reference text.",
  };
}
