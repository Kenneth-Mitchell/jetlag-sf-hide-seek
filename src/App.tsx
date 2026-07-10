import {
  Check,
  Clipboard,
  Crosshair,
  Eye,
  EyeOff,
  Layers,
  ListChecks,
  MapPin,
  Maximize2,
  Minimize2,
  Pencil,
  RotateCcw,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CATEGORY_LABELS, MATCHING_CATEGORIES, MEASURING_CATEGORIES, TENTACLE_CATEGORIES } from "./data/rules";
import { answerColor, constraintColor, nextQuestionColor } from "./lib/colors";
import { buildDistrictAnswerPreviewOverlays, buildMatchingAnswerPreviewOverlays, buildTentacleAnswerPreviewOverlays } from "./lib/constraintOverlays";
import { applyConstraints, canonicalAnswers } from "./lib/constraints";
import { districtDetailFromFeature, districtLabelFromFeature, districtNumberAtPoint, districtNumberFromFeature, supervisorDistrictFeatures } from "./lib/districts";
import { distanceMiles, lngLatFromFeature, nearestFeature, pointInFeatureCollection } from "./lib/geo";
import { distanceToLinearCategoryMiles, isLinearCategory } from "./lib/linearCategories";
import { formatAppliedQuestion, formatQuestionDraft } from "./lib/questionText";
import { allPointCategories, getCategoryFeatures, snapshot, validStations, vanNessMarket } from "./lib/snapshot";
import { allTransitLineOptions, transitLineStopPointsForQuestion } from "./lib/transit";
import type { CategoryKey, Constraint, LngLat, PointFeature } from "./lib/types";
import { MapView } from "./components/MapView";

type Mode = "seeker" | "hider" | "data";
type ActiveQuestionKind = Constraint["kind"];
type QuestionKind = "none" | ActiveQuestionKind;

const STORAGE_KEY = "jetlag-sf-constraints-v1";
const COMPACT_VORONOI_ANSWER_LIMIT = 6;

type MapLayerKey = "stations" | "currentQuestion" | "appliedQuestions" | "answerRegions";

const MAP_LAYER_LABELS: Array<{ key: MapLayerKey; label: string }> = [
  { key: "stations", label: "Station circles" },
  { key: "currentQuestion", label: "Question preview" },
  { key: "appliedQuestions", label: "Asked questions" },
  { key: "answerRegions", label: "Answer regions" },
];

const QUESTION_KINDS: Array<{ value: QuestionKind; label: string }> = [
  { value: "none", label: "No active question" },
  { value: "radius", label: "Radar / radius" },
  { value: "thermometer", label: "Thermometer" },
  { value: "matching", label: "Matching nearest POI" },
  { value: "measuring", label: "Measuring distance" },
  { value: "tentacles", label: "Tentacles" },
  { value: "district", label: "Supervisorial district" },
  { value: "transit-line", label: "Transit line" },
];

function readSavedConstraints(): Constraint[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Constraint[]) : [];
  } catch {
    return [];
  }
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function pointLabel(point: LngLat): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

function geolocationErrorMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location permission is blocked. Enable location for this localhost page in your browser settings.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "The browser could not determine your location. Try again or tap the map to set it manually.";
  }
  if (error.code === error.TIMEOUT) {
    return "Location lookup timed out. Try again or tap the map to set it manually.";
  }
  return error.message || "Location lookup failed.";
}

type AnswerOption = {
  label: string;
  detail?: string;
  color?: string;
  selected?: boolean;
  value?: string;
  distanceMiles?: number;
};

type SavedMapState = {
  version?: number;
  constraints?: Constraint[];
  selectedPoint?: LngLat;
};

function encodeMapState(constraints: Constraint[], selectedPoint: LngLat): string {
  return btoa(JSON.stringify({ version: 2, constraints, selectedPoint }));
}

function decodeMapState(value: string): SavedMapState {
  const trimmed = value.trim();
  const hash = trimmed.includes("#") ? trimmed.slice(trimmed.indexOf("#") + 1) : trimmed;
  const encoded = new URLSearchParams(hash.replace(/^#/, "")).get("state") ?? trimmed;
  const parsed = JSON.parse(atob(encoded)) as Constraint[] | SavedMapState;
  return Array.isArray(parsed) ? { version: 1, constraints: parsed } : parsed;
}

export function App() {
  const [mode, setMode] = useState<Mode>("seeker");
  const [selectedPoint, setSelectedPoint] = useState<LngLat>(vanNessMarket);
  const [constraints, setConstraints] = useState<Constraint[]>(readSavedConstraints);
  const [questionKind, setQuestionKind] = useState<QuestionKind>("none");
  const [category, setCategory] = useState<CategoryKey>("museums");
  const [radiusMiles, setRadiusMiles] = useState(1);
  const [radiusAnswer, setRadiusAnswer] = useState<"inside" | "outside">("inside");
  const [measureAnswer, setMeasureAnswer] = useState<"closer" | "farther">("closer");
  const [yesNoAnswer, setYesNoAnswer] = useState<"yes" | "no">("yes");
  const [thermoFrom, setThermoFrom] = useState<LngLat>({ lat: 37.776, lng: -122.45 });
  const [thermoTo, setThermoTo] = useState<LngLat>(vanNessMarket);
  const [thermoAnswer, setThermoAnswer] = useState<"warmer" | "colder" | "same">("warmer");
  const [tentacleRadius, setTentacleRadius] = useState(1.5);
  const [selectedPoiId, setSelectedPoiId] = useState("");
  const [transitLine, setTransitLine] = useState("N");
  const [transitLineSearch, setTransitLineSearch] = useState("");
  const [dataCategory, setDataCategory] = useState<CategoryKey>("museums");
  const [locationStatus, setLocationStatus] = useState("");
  const [editingConstraintId, setEditingConstraintId] = useState<string | null>(null);
  const [draftColor, setDraftColor] = useState(() => nextQuestionColor(readSavedConstraints()));
  const [draftPointPreview, setDraftPointPreview] = useState<LngLat | null>(null);
  const [thermoFromPreview, setThermoFromPreview] = useState<LngLat | null>(null);
  const [thermoToPreview, setThermoToPreview] = useState<LngLat | null>(null);
  const [showAllAnswers, setShowAllAnswers] = useState(false);
  const [mapLayers, setMapLayers] = useState<Record<MapLayerKey, boolean>>({
    stations: true,
    currentQuestion: true,
    appliedQuestions: true,
    answerRegions: true,
  });
  const [mapFocus, setMapFocus] = useState(false);
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [importText, setImportText] = useState("");
  const [showImportPanel, setShowImportPanel] = useState(false);
  const layerControlRef = useRef<HTMLDivElement | null>(null);
  const hasActiveQuestion = questionKind !== "none";

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(constraints));
  }, [constraints]);

  useEffect(() => {
    if (!showLayerMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && layerControlRef.current?.contains(target)) return;
      setShowLayerMenu(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowLayerMenu(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showLayerMenu]);

  const enabledConstraints = constraints.filter((constraint) => constraint.enabled);
  const liveThermoFrom = thermoFromPreview ?? thermoFrom;
  const liveThermoTo = thermoToPreview ?? thermoTo;
  const liveSelectedPoint = draftPointPreview ?? (questionKind === "thermometer" ? liveThermoTo : selectedPoint);
  const categoryFeatures = getCategoryFeatures(category);
  const dataFeatures = getCategoryFeatures(dataCategory);
  const nearestPoi = nearestFeature(liveSelectedPoint, categoryFeatures);
  const tentacleAnswerFeatures = useMemo(
    () =>
      categoryFeatures
        .map((feature) => ({
          feature,
          miles: distanceMiles(liveSelectedPoint, lngLatFromFeature(feature)),
        }))
        .filter((item) => item.miles <= tentacleRadius)
        .sort((a, b) => a.miles - b.miles),
    [categoryFeatures, liveSelectedPoint, tentacleRadius],
  );
  const committedTentacleAnswerFeatures = useMemo(
    () =>
      categoryFeatures
        .map((feature) => ({
          feature,
          miles: distanceMiles(selectedPoint, lngLatFromFeature(feature)),
        }))
        .filter((item) => item.miles <= tentacleRadius)
        .sort((a, b) => a.miles - b.miles),
    [categoryFeatures, selectedPoint, tentacleRadius],
  );
  const answers = useMemo(() => canonicalAnswers(selectedPoint), [selectedPoint]);
  const lines = useMemo(allTransitLineOptions, []);
  const pointCategories = useMemo(allPointCategories, []);
  const categoryOptions = (
    questionKind === "matching"
      ? MATCHING_CATEGORIES
      : questionKind === "tentacles"
        ? TENTACLE_CATEGORIES
        : MEASURING_CATEGORIES
  ) as readonly CategoryKey[];
  const filteredTransitLines = useMemo(() => {
    const query = transitLineSearch.trim().toLowerCase();
    const matches = query ? lines.filter((line) => line.toLowerCase().includes(query)) : lines;
    return [...matches].sort((a, b) => Number(b === transitLine) - Number(a === transitLine) || a.localeCompare(b, undefined, { numeric: true }));
  }, [lines, transitLine, transitLineSearch]);
  const transitLineCounts = useMemo(
    () => new Map(lines.map((line) => [line, transitLineStopPointsForQuestion(line).length])),
    [lines],
  );
  const liveSelectedPoiId = questionKind === "tentacles" ? tentaclePoiIdFor(liveSelectedPoint) : selectedPoiId;
  const tentacleAnswerLegend = useMemo(
    () =>
      tentacleAnswerFeatures.map(({ feature, miles }, index) => ({
        color: answerColor(index),
        feature,
        miles,
        selected: feature.properties.id === liveSelectedPoiId,
      })),
    [liveSelectedPoiId, tentacleAnswerFeatures],
  );
  const matchingAnswerLegend = useMemo(
    () =>
      categoryFeatures.map((feature, index) => {
        const miles = distanceMiles(liveSelectedPoint, lngLatFromFeature(feature));
        const selected = feature.properties.id === nearestPoi?.properties.id;
        return {
          color: answerColor(index),
          feature,
          miles,
          selected,
        };
      }),
    [categoryFeatures, liveSelectedPoint, nearestPoi],
  );
  const liveDistrictNumber = districtNumberAtPoint(liveSelectedPoint);
  const districtAnswerLegend = useMemo(
    () =>
      supervisorDistrictFeatures().map((feature, index) => {
        const district = districtNumberFromFeature(feature) ?? String(index + 1);
        const supervisor = districtDetailFromFeature(feature);
        return {
          color: answerColor(index),
          district,
          label: districtLabelFromFeature(feature),
          detail: supervisor ? `${supervisor}` : "SF Supervisorial District",
          selected: district === liveDistrictNumber,
        };
      }),
    [liveDistrictNumber],
  );
  const questionDraft = useMemo(
    () =>
      questionKind === "none"
        ? ""
        : formatQuestionDraft({
            kind: questionKind,
            point: liveSelectedPoint,
            category,
            radiusMiles,
            tentacleRadius,
            transitLine,
            from: liveThermoFrom,
            to: liveThermoTo,
          }),
    [category, liveSelectedPoint, liveThermoFrom, liveThermoTo, questionKind, radiusMiles, tentacleRadius, transitLine],
  );
  const transitStopCount = useMemo(
    () => (questionKind === "transit-line" ? transitLineStopPointsForQuestion(transitLine).length : 0),
    [questionKind, transitLine],
  );
  const canApplyQuestion =
    questionKind !== "none" &&
    (questionKind !== "tentacles" || tentacleAnswerFeatures.length > 0) &&
    (questionKind !== "transit-line" || transitStopCount > 0);
  const editingConstraint = constraints.find((constraint) => constraint.id === editingConstraintId);
  const draftConstraint = useMemo(
    () =>
      buildDraftConstraint({
        id: editingConstraint?.id ?? "__draft__",
        enabled: editingConstraint?.enabled ?? true,
        color: draftColor,
        point: selectedPoint,
        from: thermoFrom,
        to: thermoTo,
      }),
    [
      category,
      draftColor,
      editingConstraint?.enabled,
      editingConstraint?.id,
      measureAnswer,
      questionKind,
      radiusAnswer,
      radiusMiles,
      selectedPoint,
      selectedPoiId,
      tentacleRadius,
      thermoAnswer,
      thermoFrom,
      thermoTo,
      transitLine,
      yesNoAnswer,
    ],
  );
  const liveDraftConstraint = useMemo(
    () =>
      buildDraftConstraint({
        id: editingConstraint?.id ?? "__draft__",
        enabled: editingConstraint?.enabled ?? true,
        color: draftColor,
        point: liveSelectedPoint,
        from: liveThermoFrom,
        to: liveThermoTo,
      }),
    [
      category,
      draftColor,
      editingConstraint?.enabled,
      editingConstraint?.id,
      liveSelectedPoint,
      liveThermoFrom,
      liveThermoTo,
      measureAnswer,
      questionKind,
      radiusAnswer,
      radiusMiles,
      selectedPoiId,
      tentacleRadius,
      thermoAnswer,
      transitLine,
      yesNoAnswer,
    ],
  );
  const previewConstraints = useMemo(
    () =>
      editingConstraint
        ? liveDraftConstraint
          ? constraints.map((constraint) => (constraint.id === editingConstraint.id ? liveDraftConstraint : constraint))
          : constraints
        : constraints,
    [constraints, liveDraftConstraint, editingConstraint],
  );
  const appliedMapConstraints = useMemo(
    () =>
      editingConstraint
        ? constraints.filter((constraint) => constraint.id !== editingConstraint.id)
        : constraints,
    [constraints, editingConstraint],
  );
  const answerPreviewOverlays = useMemo(() => {
    if (!liveDraftConstraint) return [];
    if (questionKind === "matching" && liveDraftConstraint.kind === "matching") {
      return buildMatchingAnswerPreviewOverlays(
        liveDraftConstraint,
        matchingAnswerLegend.map(({ color, feature, selected }) => ({
          color,
          featureId: feature.properties.id,
          selected,
        })),
      );
    }
    if (questionKind === "tentacles" && liveDraftConstraint.kind === "tentacles") {
      return buildTentacleAnswerPreviewOverlays(
        liveDraftConstraint,
        tentacleAnswerLegend.map(({ color, feature, selected }) => ({
          color,
          featureId: feature.properties.id,
          selected,
        })),
      );
    }
    if (questionKind === "district" && liveDraftConstraint.kind === "district") {
      return buildDistrictAnswerPreviewOverlays(
        districtAnswerLegend.map(({ color, district, selected }) => ({
          color,
          district,
          selected,
        })),
      );
    }
    return [];
  }, [districtAnswerLegend, liveDraftConstraint, matchingAnswerLegend, questionKind, tentacleAnswerLegend]);
  const candidates = useMemo(() => applyConstraints(previewConstraints), [previewConstraints]);
  const answerOptions = useMemo<AnswerOption[]>(() => {
    if (questionKind === "none") return [];
    if (questionKind === "radius") {
      return [
        { label: "Yes", detail: `inside ${radiusMiles.toFixed(2)} mi` },
        { label: "No", detail: `outside ${radiusMiles.toFixed(2)} mi` },
      ];
    }
    if (questionKind === "thermometer") {
      return [
        { label: "Warmer", detail: "B is closer than A" },
        { label: "Colder", detail: "B is farther than A" },
        { label: "Same", detail: "too close to call" },
      ];
    }
    if (questionKind === "matching") {
      return [...matchingAnswerLegend]
        .sort((a, b) => Number(b.selected) - Number(a.selected) || a.miles - b.miles)
        .map(({ color, feature, miles, selected }) => ({
          label: String(feature.properties.name),
          detail: selected ? `${miles.toFixed(2)} mi · my nearest` : `${miles.toFixed(2)} mi`,
          color,
          selected,
          distanceMiles: miles,
        }));
    }
    if (questionKind === "measuring") {
      const distance = isLinearCategory(category)
        ? distanceToLinearCategoryMiles(liveSelectedPoint, category)
        : nearestPoi
          ? distanceMiles(liveSelectedPoint, lngLatFromFeature(nearestPoi))
          : undefined;
      const noun = CATEGORY_LABELS[category].toLowerCase();
      const target = isLinearCategory(category) ? `the ${noun}` : `nearest ${noun}`;
      return [
        { label: "Closer", detail: distance === undefined ? `closer to ${target}` : `< ${distance.toFixed(2)} mi from ${target}` },
        { label: "Farther", detail: distance === undefined ? `farther from ${target}` : `> ${distance.toFixed(2)} mi from ${target}` },
      ];
    }
    if (questionKind === "tentacles") {
      if (tentacleAnswerFeatures.length === 0) {
        return [{ label: "No listed POIs", detail: `within ${tentacleRadius.toFixed(1)} mi` }];
      }
      return tentacleAnswerLegend.map(({ color, feature, miles, selected }) => ({
        label: String(feature.properties.name),
        detail: `${miles.toFixed(2)} mi`,
        color,
        selected,
        value: feature.properties.id,
        distanceMiles: miles,
      }));
    }
    if (questionKind === "district") {
      return districtAnswerLegend.map(({ color, detail, label, selected }) => ({
        label,
        detail: selected ? `${detail} · marked point` : detail,
        color,
        selected,
      }));
    }
    return [
      {
        label: "Yes",
        detail:
          transitStopCount > 0
            ? `a ${transitLine || "line"} stop is within 1/4 mi of the chosen station`
            : "no stops found for this line",
      },
      { label: "No", detail: `${transitLine || "line"} has no stop within 1/4 mi of the chosen station` },
    ];
  }, [category, districtAnswerLegend, liveSelectedPoint, matchingAnswerLegend, nearestPoi, questionKind, radiusMiles, tentacleAnswerFeatures.length, tentacleAnswerLegend, tentacleRadius, transitLine, transitStopCount]);
  const showAnswerPreview = questionKind === "matching" || questionKind === "tentacles" || questionKind === "district";
  const compactVoronoiAnswers = questionKind === "matching" || questionKind === "tentacles";
  const shouldCompactAnswers = compactVoronoiAnswers && answerOptions.length > COMPACT_VORONOI_ANSWER_LIMIT;
  const visibleAnswerOptions = useMemo(() => {
    if (!shouldCompactAnswers || showAllAnswers) return answerOptions;
    const selected = answerOptions.filter((option) => option.selected);
    const selectedKeys = new Set(selected.map((option) => `${option.label}-${option.detail ?? ""}`));
    const nearby = answerOptions
      .filter((option) => !selectedKeys.has(`${option.label}-${option.detail ?? ""}`))
      .slice(0, Math.max(0, COMPACT_VORONOI_ANSWER_LIMIT - selected.length));
    return [...selected, ...nearby];
  }, [answerOptions, shouldCompactAnswers, showAllAnswers]);
  const hiddenAnswerCount = answerOptions.length - visibleAnswerOptions.length;

  useEffect(() => {
    setShowAllAnswers(false);
  }, [category, questionKind, radiusMiles, selectedPoint, tentacleRadius]);

  useEffect(() => {
    if (questionKind !== "matching" && questionKind !== "measuring" && questionKind !== "tentacles") return;
    if (!categoryOptions.includes(category)) setCategory(categoryOptions[0]);
  }, [category, categoryOptions, questionKind]);

  useEffect(() => {
    const selectedFeature = categoryFeatures.find((feature) => feature.properties.id === selectedPoiId);
    const selectedFeatureInRange =
      selectedFeature && distanceMiles(selectedPoint, lngLatFromFeature(selectedFeature)) <= tentacleRadius;
    if (questionKind === "tentacles" && selectedFeatureInRange) return;
    const nearestInRange = committedTentacleAnswerFeatures[0]?.feature;
    const nearest = nearestFeature(selectedPoint, categoryFeatures);
    if (nearestInRange) setSelectedPoiId(nearestInRange.properties.id);
    else if (nearest) setSelectedPoiId(nearest.properties.id);
  }, [categoryFeatures, committedTentacleAnswerFeatures, questionKind, selectedPoint, selectedPoiId, tentacleRadius]);

  function tentaclePoiIdFor(point: LngLat): string {
    const selectedFeature = categoryFeatures.find((feature) => feature.properties.id === selectedPoiId);
    if (selectedFeature && distanceMiles(point, lngLatFromFeature(selectedFeature)) <= tentacleRadius) {
      return selectedFeature.properties.id;
    }
    const nearestInRange = categoryFeatures
      .map((feature) => ({
        feature,
        miles: distanceMiles(point, lngLatFromFeature(feature)),
      }))
      .filter((item) => item.miles <= tentacleRadius)
      .sort((a, b) => a.miles - b.miles)[0]?.feature;
    return nearestInRange?.properties.id ?? nearestFeature(point, categoryFeatures)?.properties.id ?? "";
  }

  function selectTransitLine(line: string) {
    setTransitLine(line);
    setTransitLineSearch("");
  }

  function toggleMapLayer(key: MapLayerKey) {
    setMapLayers((current) => ({ ...current, [key]: !current[key] }));
  }

  function buildDraftConstraint({
    id,
    enabled,
    color,
    point,
    from,
    to,
  }: {
    id: string;
    enabled: boolean;
    color: string;
    point: LngLat;
    from: LngLat;
    to: LngLat;
  }): Constraint | undefined {
    if (questionKind === "none") return undefined;
    const label = QUESTION_KINDS.find((kind) => kind.value === questionKind)?.label ?? questionKind;
    const base = { id, label, enabled, color };
    if (questionKind === "radius") {
      return { ...base, kind: "radius", point, miles: radiusMiles, answer: radiusAnswer };
    }
    if (questionKind === "thermometer") {
      return { ...base, kind: "thermometer", from, to, answer: thermoAnswer };
    }
    if (questionKind === "matching") {
      return { ...base, kind: "matching", point, category, answer: yesNoAnswer };
    }
    if (questionKind === "measuring") {
      return { ...base, kind: "measuring", point, category, answer: measureAnswer };
    }
    if (questionKind === "tentacles") {
      return {
        ...base,
        kind: "tentacles",
        point,
        category,
        selectedPoiId: tentaclePoiIdFor(point),
        radiusMiles: tentacleRadius,
      };
    }
    if (questionKind === "district") {
      return { ...base, kind: "district", point, answer: yesNoAnswer };
    }
    return { ...base, kind: "transit-line", line: transitLine.trim(), answer: yesNoAnswer };
  }

  function applyQuestionForm() {
    const existing = constraints.find((constraint) => constraint.id === editingConstraintId);
    const next = buildDraftConstraint({
      id: existing?.id ?? makeId(),
      enabled: existing?.enabled ?? true,
      color: draftColor,
      point: liveSelectedPoint,
      from: liveThermoFrom,
      to: liveThermoTo,
    });
    if (!next) return;
    setDraftPointPreview(null);
    setThermoFromPreview(null);
    setThermoToPreview(null);
    if (existing) {
      const nextConstraints = constraints.map((constraint) => (constraint.id === existing.id ? next : constraint));
      setConstraints(nextConstraints);
      setEditingConstraintId(null);
      setDraftColor(nextQuestionColor(nextConstraints));
      setQuestionKind("none");
    } else {
      const nextConstraints = [next, ...constraints];
      setConstraints(nextConstraints);
      setDraftColor(nextQuestionColor(nextConstraints));
      setQuestionKind("none");
    }
  }

  function editConstraint(constraint: Constraint) {
    const constraintIndex = constraints.findIndex((item) => item.id === constraint.id);
    setEditingConstraintId(constraint.id);
    setQuestionKind(constraint.kind);
    setDraftColor(constraintColor(constraint, constraintIndex >= 0 ? constraintIndex : 0));
    if ("point" in constraint) setSelectedPoint(constraint.point);
    if (constraint.kind === "radius") {
      setRadiusMiles(constraint.miles);
      setRadiusAnswer(constraint.answer);
    } else if (constraint.kind === "thermometer") {
      setThermoFrom(constraint.from);
      setThermoTo(constraint.to);
      setThermoAnswer(constraint.answer);
    } else if (constraint.kind === "matching") {
      setCategory(constraint.category);
      setYesNoAnswer(constraint.answer);
    } else if (constraint.kind === "measuring") {
      setCategory(constraint.category);
      setMeasureAnswer(constraint.answer);
    } else if (constraint.kind === "tentacles") {
      setCategory(constraint.category);
      setSelectedPoiId(constraint.selectedPoiId);
      setTentacleRadius(constraint.radiusMiles);
    } else if (constraint.kind === "district") {
      setYesNoAnswer(constraint.answer);
    } else {
      setTransitLine(constraint.line);
      setYesNoAnswer(constraint.answer);
    }
  }

  function changeQuestionKind(nextKind: QuestionKind) {
    setDraftPointPreview(null);
    setThermoFromPreview(null);
    setThermoToPreview(null);
    if (nextKind === "none") {
      setEditingConstraintId(null);
      setDraftColor(nextQuestionColor(constraints));
    }
    if (nextKind === "thermometer" && questionKind !== "thermometer") {
      setThermoTo(selectedPoint);
    }
    if (nextKind !== "thermometer" && questionKind === "thermometer") {
      setSelectedPoint(thermoTo);
    }
    setQuestionKind(nextKind);
  }

  function toggleConstraint(id: string) {
    setConstraints((current) =>
      current.map((constraint) =>
        constraint.id === id ? { ...constraint, enabled: !constraint.enabled } : constraint,
      ),
    );
  }

  function removeConstraint(id: string) {
    const nextConstraints = constraints.filter((constraint) => constraint.id !== id);
    setConstraints(nextConstraints);
    if (editingConstraintId === id) {
      setEditingConstraintId(null);
      setDraftColor(nextQuestionColor(nextConstraints));
    }
  }

  function updateConstraintColor(id: string, color: string) {
    setConstraints((current) =>
      current.map((constraint) => (constraint.id === id ? { ...constraint, color } : constraint)),
    );
    if (editingConstraintId === id) setDraftColor(color);
  }

  function cancelEditing() {
    setEditingConstraintId(null);
    setDraftColor(nextQuestionColor(constraints));
    setQuestionKind("none");
  }

  function applyImportedMapState(value: string) {
    try {
      const next = decodeMapState(value);
      if (!Array.isArray(next.constraints)) throw new Error("Missing question stack.");
      setConstraints(next.constraints);
      setEditingConstraintId(null);
      setDraftColor(nextQuestionColor(next.constraints));
      if (next.selectedPoint) setSelectedPoint(next.selectedPoint);
      setImportText("");
      setShowImportPanel(false);
      setShareStatus(`Imported ${next.constraints.length} question${next.constraints.length === 1 ? "" : "s"}.`);
    } catch {
      setShareStatus("Could not import that map link or state.");
    }
  }

  async function exportState() {
    const encoded = encodeMapState(constraints, selectedPoint);
    const url = `${location.origin}${location.pathname}#state=${encoded}`;
    const shareData = {
      title: "SF Hide & Seek map",
      text: "Current question map",
      url,
    };

    try {
      if (typeof navigator.share === "function") {
        await navigator.share(shareData);
        setShareStatus("Shared map link.");
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setShareStatus("Map link copied.");
    } catch {
      setImportText(url);
      setShowImportPanel(true);
      setShareStatus("Copy was blocked. Link is ready below.");
    }
  }

  function copyQuestion() {
    if (!questionDraft) return;
    void navigator.clipboard?.writeText(questionDraft);
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationStatus("Location is not available in this browser.");
      return;
    }
    if (!window.isSecureContext) {
      setLocationStatus("Location requires HTTPS or localhost. Open http://127.0.0.1:5173 or http://localhost:5173.");
      return;
    }

    const applyPosition = (position: GeolocationPosition) => {
      const nextPoint = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      const inPlayableArea = Boolean(pointInFeatureCollection(nextPoint, snapshot.geometries.playableArea));
      setDraftPointPreview(null);
      setThermoFromPreview(null);
      setThermoToPreview(null);
      setSelectedPoint(nextPoint);
      if (questionKind === "thermometer") setThermoTo(nextPoint);
      const accuracy = Number.isFinite(position.coords.accuracy)
        ? `accuracy ${Math.round(position.coords.accuracy)} m`
        : "accuracy unknown";
      setLocationStatus(
        inPlayableArea
          ? `Current location set · ${accuracy}`
          : `Current location set, but it is outside the SF map · ${accuracy}`,
      );
    };

    const requestPosition = (highAccuracy: boolean) => {
      navigator.geolocation.getCurrentPosition(
        applyPosition,
        (error) => {
          if (highAccuracy && (error.code === error.TIMEOUT || error.code === error.POSITION_UNAVAILABLE)) {
            setLocationStatus("Still looking; trying a lower-accuracy location fix...");
            requestPosition(false);
            return;
          }
          setLocationStatus(geolocationErrorMessage(error));
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: highAccuracy ? 12000 : 20000,
          maximumAge: highAccuracy ? 10000 : 300000,
        },
      );
    };

    setLocationStatus("Finding current location...");
    if (navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: "geolocation" as PermissionName })
        .then((permission) => {
          if (permission.state === "denied") {
            setLocationStatus("Location permission is blocked. Enable it for this localhost page, then try again.");
            return;
          }
          requestPosition(true);
        })
        .catch(() => requestPosition(true));
      return;
    }
    requestPosition(true);
  }

  const handleMapPointSelect = useCallback((point: LngLat) => {
    setDraftPointPreview(null);
    setThermoFromPreview(null);
    setThermoToPreview(null);
    setSelectedPoint(point);
    if (questionKind === "thermometer") setThermoTo(point);
  }, [questionKind]);

  const previewDraftPoint = useCallback((point: LngLat | null) => {
    setDraftPointPreview(point);
  }, []);

  const moveDraftPoint = useCallback((point: LngLat) => {
    setDraftPointPreview(null);
    setSelectedPoint(point);
  }, []);

  const previewThermoFrom = useCallback((point: LngLat | null) => {
    setThermoFromPreview(point);
  }, []);

  const moveThermoFrom = useCallback((point: LngLat) => {
    setThermoFromPreview(null);
    setThermoFrom(point);
  }, []);

  const previewThermoTo = useCallback((point: LngLat | null) => {
    setThermoToPreview(point);
  }, []);

  const moveThermoTo = useCallback((point: LngLat) => {
    setThermoToPreview(null);
    setThermoTo(point);
    setSelectedPoint(point);
  }, []);

  useEffect(() => {
    const state = new URLSearchParams(location.hash.replace(/^#/, "")).get("state");
    if (!state) return;
    applyImportedMapState(state);
    history.replaceState(null, "", location.pathname);
  }, []);

  return (
    <main className={`app-shell${mapFocus ? " map-focus" : ""}`}>
      <section className="map-pane" aria-label="Map">
        <MapView
          candidates={candidates}
          eliminated={validStations.filter((station) => !candidates.some((candidate) => candidate.properties.id === station.properties.id))}
          constraints={appliedMapConstraints}
          currentPoint={mode === "hider" ? selectedPoint : undefined}
          draftConstraint={mode === "seeker" ? draftConstraint : undefined}
          answerPreviewOverlays={mode === "seeker" ? answerPreviewOverlays : []}
          showStations={mapLayers.stations}
          showCurrentQuestion={mapLayers.currentQuestion}
          showAppliedQuestions={mapLayers.appliedQuestions}
          showAnswerRegions={mapLayers.answerRegions}
          onSelectPoint={handleMapPointSelect}
          onDraftPointPreview={previewDraftPoint}
          onDraftPointChange={moveDraftPoint}
          onThermoFromPreview={previewThermoFrom}
          onThermoFromChange={moveThermoFrom}
          onThermoToPreview={previewThermoTo}
          onThermoToChange={moveThermoTo}
        />
        <button
          type="button"
          className="map-focus-button"
          onClick={() => setMapFocus((current) => !current)}
          aria-label={mapFocus ? "Show more controls" : "Focus map"}
          aria-pressed={mapFocus}
          title={mapFocus ? "Show more controls" : "Focus map"}
        >
          {mapFocus ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
        <div className="map-layer-control" ref={layerControlRef}>
          <button
            type="button"
            className={`map-layer-button${showLayerMenu ? " active" : ""}`}
            onClick={() => setShowLayerMenu((current) => !current)}
            aria-label="Map layers"
            aria-expanded={showLayerMenu}
            aria-controls="map-layer-menu"
            title="Map layers"
          >
            <Layers size={18} />
          </button>
          {showLayerMenu && (
            <div id="map-layer-menu" className="map-layer-menu" role="menu" aria-label="Map layers">
              <strong>Map layers</strong>
              {MAP_LAYER_LABELS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={`map-layer-option${mapLayers[key] ? " active" : ""}`}
                  onClick={() => toggleMapLayer(key)}
                  role="menuitemcheckbox"
                  aria-checked={mapLayers[key]}
                >
                  <span className="map-layer-check" aria-hidden="true">
                    {mapLayers[key] && <Check size={14} />}
                  </span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className={`control-pane mode-${mode}`}>
        <header className="app-header">
          <div>
            <p className="eyebrow">San Francisco Hide & Seek</p>
            <h1>{candidates.length} candidate stations</h1>
          </div>
          <div className="mode-tabs" role="tablist" aria-label="Mode">
            {(["seeker", "hider", "data"] as const).map((nextMode) => (
              <button
                key={nextMode}
                type="button"
                className={mode === nextMode ? "active" : ""}
                onClick={() => setMode(nextMode)}
              >
                {nextMode}
              </button>
            ))}
          </div>
        </header>

        <div className="point-strip">
          <MapPin size={18} />
          <span>Map tap: {pointLabel(liveSelectedPoint)}</span>
          <button type="button" className="icon-text-button" onClick={useCurrentLocation}>
            <Crosshair size={17} />
            Current
          </button>
        </div>
        {locationStatus && <p className="status-line">{locationStatus}</p>}

        {mode === "seeker" && (
          <div className="panel-stack">
            <section className="tool-panel question-composer-panel">
              <div className="field-grid">
                <label>
                  Question
                  <select value={questionKind} onChange={(event) => changeQuestionKind(event.target.value as QuestionKind)}>
                    {QUESTION_KINDS.map((kind) => (
                      <option key={kind.value} value={kind.value}>
                        {kind.label}
                      </option>
                    ))}
                  </select>
                </label>

                {hasActiveQuestion && (
                  <label className="draft-color-field">
                    Color
                    <span className="draft-color-control">
                      <span className="color-picker" title="Question color">
                        <span>Question color</span>
                        <input
                          type="color"
                          value={draftColor}
                          onChange={(event) => setDraftColor(event.target.value)}
                          aria-label="Question color"
                        />
                      </span>
                      <strong>{draftColor.toUpperCase()}</strong>
                    </span>
                  </label>
                )}

                {(questionKind === "matching" || questionKind === "measuring" || questionKind === "tentacles") && (
                  <label>
                    Category
                    <select value={category} onChange={(event) => setCategory(event.target.value as CategoryKey)}>
                      {categoryOptions.map((key) => (
                        <option key={key} value={key}>
                          {CATEGORY_LABELS[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {questionKind === "radius" && (
                  <>
                    <label>
                      Miles
                      <input
                        type="number"
                        min="0.05"
                        step="0.05"
                        value={radiusMiles}
                        onChange={(event) => setRadiusMiles(Number(event.target.value))}
                      />
                    </label>
                    <Segmented value={radiusAnswer} onChange={setRadiusAnswer} options={["inside", "outside"]} />
                  </>
                )}

                {questionKind === "thermometer" && (
                  <>
                    <div className="button-row">
                      <button type="button" onClick={() => setThermoFrom(selectedPoint)}>
                        Set A
                      </button>
                      <button type="button" onClick={() => setThermoTo(selectedPoint)}>
                        Set B
                      </button>
                    </div>
                    <p className="mini-copy">A {pointLabel(liveThermoFrom)} · B {pointLabel(liveThermoTo)}</p>
                    <Segmented value={thermoAnswer} onChange={setThermoAnswer} options={["warmer", "colder", "same"]} />
                  </>
                )}

                {(questionKind === "matching" || questionKind === "district") && (
                  <Segmented value={yesNoAnswer} onChange={setYesNoAnswer} options={["yes", "no"]} />
                )}

                {questionKind === "measuring" && (
                  <Segmented value={measureAnswer} onChange={setMeasureAnswer} options={["closer", "farther"]} />
                )}

                {questionKind === "tentacles" && (
                  <>
                    <label>
                      Radius
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={tentacleRadius}
                        onChange={(event) => setTentacleRadius(Number(event.target.value))}
                      />
                    </label>
                    <label>
                      Hider answer
                      <select
                        value={tentacleAnswerFeatures.some(({ feature }) => feature.properties.id === liveSelectedPoiId) ? liveSelectedPoiId : ""}
                        onChange={(event) => setSelectedPoiId(event.target.value)}
                        disabled={tentacleAnswerFeatures.length === 0}
                      >
                        {tentacleAnswerFeatures.length === 0 && <option value="">No POIs in range</option>}
                        {tentacleAnswerLegend.map(({ color, feature, miles }) => (
                          <option key={feature.properties.id} value={feature.properties.id} style={{ color }}>
                            {feature.properties.name} ({miles.toFixed(2)} mi)
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}

                {questionKind === "transit-line" && (
                  <>
                    <div className="transit-line-field">
                      <label>
                        Search route
                        <input
                          type="search"
                          value={transitLineSearch}
                          placeholder="N, 38R, 14..."
                          onChange={(event) => setTransitLineSearch(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && filteredTransitLines[0]) {
                              event.preventDefault();
                              selectTransitLine(filteredTransitLines[0]);
                            }
                          }}
                        />
                      </label>
                      <div className="selected-transit-line">
                        <span>Selected</span>
                        <strong>{transitLine}</strong>
                        <em>{transitStopCount > 0 ? `${transitStopCount} route points` : "no route points"}</em>
                      </div>
                      <div className="transit-line-list" role="listbox" aria-label="Transit line">
                        {filteredTransitLines.map((line) => (
                          <button
                            key={line}
                            type="button"
                            className={line === transitLine ? "selected-line" : ""}
                            onClick={() => selectTransitLine(line)}
                            aria-selected={line === transitLine}
                          >
                            <strong>{line}</strong>
                            <span>{transitLineCounts.get(line) ?? 0} route points</span>
                          </button>
                        ))}
                        {filteredTransitLines.length === 0 && <span>No routes found</span>}
                      </div>
                    </div>
                    <Segmented value={yesNoAnswer} onChange={setYesNoAnswer} options={["yes", "no"]} />
                  </>
                )}
              </div>

              {hasActiveQuestion ? (
                <>
                  <div className="question-preview">
                    <label>
                      Copyable question
                      <textarea readOnly value={questionDraft} rows={4} />
                    </label>
                    <button type="button" onClick={copyQuestion}>
                      <Clipboard size={17} />
                      Copy
                    </button>
                  </div>

                  {showAnswerPreview && (
                    <div className="answer-preview">
                      <div className="section-heading">
                        <h2>Possible Answers</h2>
                        <span>{answerOptions.length}</span>
                      </div>
                      {shouldCompactAnswers && (
                        <div className="answer-list-tools">
                          <span>
                            {showAllAnswers
                              ? `${answerOptions.length} shown`
                              : `${visibleAnswerOptions.length} shown · ${hiddenAnswerCount} hidden`}
                          </span>
                          <button type="button" onClick={() => setShowAllAnswers((current) => !current)}>
                            {showAllAnswers ? "Show fewer" : "Show all"}
                          </button>
                        </div>
                      )}
                      <div className="answer-chip-list">
                        {visibleAnswerOptions.map((option, index) => {
                          const chipStyle = option.color ? ({ "--answer-color": option.color } as CSSProperties) : undefined;
                          const chipClassName = `answer-chip${option.selected ? " selected-answer" : ""}`;
                          const content = (
                            <>
                              {option.color && <i className="answer-swatch" style={{ backgroundColor: option.color }} aria-hidden="true" />}
                              <strong>{option.label}</strong>
                              {option.detail && <em>{option.detail}</em>}
                            </>
                          );
                          return option.value ? (
                            <button
                              key={`${option.label}-${option.detail}-${index}`}
                              type="button"
                              className={chipClassName}
                              style={chipStyle}
                              onClick={() => setSelectedPoiId(option.value ?? "")}
                            >
                              {content}
                            </button>
                          ) : (
                            <span key={`${option.label}-${option.detail}-${index}`} className={chipClassName} style={chipStyle}>
                              {content}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {editingConstraintId && (
                    <div className="edit-banner">
                      <span>Editing an existing question</span>
                      <button type="button" onClick={cancelEditing}>
                        <X size={17} />
                        Cancel
                      </button>
                    </div>
                  )}

                  <button className="primary-action" type="button" onClick={applyQuestionForm} disabled={!canApplyQuestion}>
                    <ListChecks size={18} />
                    {editingConstraintId ? "Save changes" : "Apply answer"}
                  </button>
                </>
              ) : (
                <div className="composer-empty">
                  <strong>No question currently being asked.</strong>
                  <span>Select a question type when you are ready to preview one.</span>
                </div>
              )}
            </section>

            <section className="tool-panel question-stack-panel">
              <div className="section-heading stack-heading">
                <h2>Question Stack</h2>
                <div className="button-row">
                  <button type="button" className="icon-text-button" title="Share map link" onClick={exportState}>
                    <Share2 size={17} />
                    Share
                  </button>
                  <button
                    type="button"
                    className="icon-text-button"
                    title="Import map link"
                    onClick={() => {
                      setShowImportPanel((value) => !value);
                      setShareStatus("");
                    }}
                  >
                    <ListChecks size={17} />
                    Import
                  </button>
                  <button
                    type="button"
                    title="Clear questions"
                    className="square-icon-button"
                    onClick={() => {
                      setConstraints([]);
                      setEditingConstraintId(null);
                      setDraftColor(nextQuestionColor([]));
                    }}
                  >
                    <RotateCcw size={17} />
                  </button>
                </div>
              </div>
              {shareStatus && <p className="share-status">{shareStatus}</p>}
              {showImportPanel && (
                <div className="share-panel">
                  <label>
                    Import map link
                    <input
                      type="text"
                      value={importText}
                      placeholder="Paste a shared map link"
                      onChange={(event) => setImportText(event.target.value)}
                    />
                  </label>
                  <div className="button-row">
                    <button type="button" className="icon-text-button" onClick={() => applyImportedMapState(importText)} disabled={!importText.trim()}>
                      <ListChecks size={17} />
                      Load map
                    </button>
                    <button
                      type="button"
                      className="icon-text-button"
                      onClick={() => {
                        setShowImportPanel(false);
                        setImportText("");
                        setShareStatus("");
                      }}
                    >
                      <X size={17} />
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <div className="constraint-list">
                {constraints.length === 0 && <p className="empty">No questions applied yet.</p>}
                {constraints.map((constraint, index) => {
                  const color = constraintColor(constraint, index);
                  return (
                  <article
                    key={constraint.id}
                    className={!constraint.enabled ? "muted-row" : ""}
                    style={{ borderLeftColor: color }}
                  >
                    <label className="color-picker" title="Question color">
                      <span>Color</span>
                      <input
                        type="color"
                        value={color}
                        onChange={(event) => updateConstraintColor(constraint.id, event.target.value)}
                        aria-label="Question color"
                      />
                    </label>
                    <button type="button" title="Toggle question" onClick={() => toggleConstraint(constraint.id)}>
                      {constraint.enabled ? <Eye size={17} /> : <EyeOff size={17} />}
                    </button>
                    <span>{formatAppliedQuestion(constraint)}</span>
                    <button type="button" title="Edit question" onClick={() => editConstraint(constraint)}>
                      <Pencil size={17} />
                    </button>
                    <button type="button" title="Remove question" onClick={() => removeConstraint(constraint.id)}>
                      <Trash2 size={17} />
                    </button>
                  </article>
                  );
                })}
              </div>
            </section>

            <CandidateList candidates={candidates} />
          </div>
        )}

        {mode === "hider" && (
          <section className="tool-panel hider-panel">
            <div className="section-heading">
              <h2>Canonical Answers</h2>
              <span>{pointLabel(selectedPoint)}</span>
            </div>
            <div className="answer-list">
              <AnswerRow label="Nearest valid station" value={answers.nearestValidStation?.feature.properties.name ?? "None"} />
              <AnswerRow label="Supervisorial district" value={answers.district ? `D${answers.district}` : "Unknown"} />
              {(Object.keys(CATEGORY_LABELS) as CategoryKey[]).map((key) => {
                const answer = answers.nearest[key] as { name: string; miles: number } | undefined;
                return (
                  <AnswerRow
                    key={key}
                    label={key === "coastline" ? "Distance to Coastline" : `Nearest ${CATEGORY_LABELS[key]}`}
                    value={answer ? `${answer.name} · ${answer.miles.toFixed(2)} mi` : "No data"}
                  />
                );
              })}
            </div>
          </section>
        )}

        {mode === "data" && (
          <section className="tool-panel data-panel">
            <div className="section-heading">
              <h2>Frozen Snapshot</h2>
              <span>{snapshot.generatedAt.slice(0, 10)}</span>
            </div>
            <div className="answer-list">
              <AnswerRow label="Rules" value={snapshot.rulesVersion} />
              <AnswerRow label="Valid stations" value={`${validStations.length}`} />
              <AnswerRow label="Active constraints" value={`${enabledConstraints.length}`} />
              <AnswerRow label="Snapshot date" value={snapshot.generatedAt.slice(0, 10)} />
            </div>
            <label>
              Browse category
              <select value={dataCategory} onChange={(event) => setDataCategory(event.target.value as CategoryKey)}>
                {pointCategories.map((key) => (
                  <option key={key} value={key}>
                    {CATEGORY_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <div className="data-list">
              {dataFeatures.map((feature) => (
                <DataItem key={feature.properties.id} feature={feature} selectedPoint={selectedPoint} />
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: T[];
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={value === option ? "active" : ""}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function AnswerRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="answer-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CandidateList({ candidates }: { candidates: PointFeature[] }) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const visibleCandidates = useMemo(() => {
    if (!normalizedSearch) return candidates;
    return candidates.filter((station) => {
      const system = station.properties.primary_system ? String(station.properties.primary_system) : station.properties.sourceSheet;
      return `${station.properties.name} ${system}`.toLowerCase().includes(normalizedSearch);
    });
  }, [candidates, normalizedSearch]);

  return (
    <section className="tool-panel station-list-panel">
      <div className="section-heading">
        <h2>Remaining Stations</h2>
        <span>{normalizedSearch ? `${visibleCandidates.length}/${candidates.length}` : candidates.length}</span>
      </div>
      <label className="station-search">
        Search stations
        <input type="search" value={search} placeholder="Powell, BART, N Judah..." onChange={(event) => setSearch(event.target.value)} />
      </label>
      <div className="candidate-list">
        {visibleCandidates.map((station) => (
          <article key={station.properties.id}>
            <strong>{station.properties.name}</strong>
            <span>{station.properties.primary_system ? String(station.properties.primary_system) : station.properties.sourceSheet}</span>
          </article>
        ))}
        {visibleCandidates.length === 0 && <p className="empty">No stations match that search.</p>}
      </div>
    </section>
  );
}

function DataItem({ feature, selectedPoint }: { feature: PointFeature; selectedPoint: LngLat }) {
  const here = lngLatFromFeature(feature);
  return (
    <article>
      <strong>{feature.properties.name}</strong>
      <span>{distanceMiles(selectedPoint, here).toFixed(2)} mi from map tap</span>
    </article>
  );
}
