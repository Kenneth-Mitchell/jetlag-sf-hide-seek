import { Eye, EyeOff, ListChecks, MapPin, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CATEGORY_LABELS, DISABLED_RULE_NOTES, MATCHING_CATEGORIES, MEASURING_CATEGORIES } from "./data/rules";
import { applyConstraints, canonicalAnswers, describeConstraint } from "./lib/constraints";
import { distanceMiles, lngLatFromFeature, nearestFeature } from "./lib/geo";
import { getCategoryFeatures, snapshot, validStations, vanNessMarket } from "./lib/snapshot";
import type { CategoryKey, Constraint, LngLat, PointFeature } from "./lib/types";
import { MapView } from "./components/MapView";

type Mode = "seeker" | "hider" | "data";
type QuestionKind = Constraint["kind"];

const STORAGE_KEY = "jetlag-sf-constraints-v1";

const QUESTION_KINDS: Array<{ value: QuestionKind; label: string }> = [
  { value: "radius", label: "Radar / radius" },
  { value: "thermometer", label: "Thermometer" },
  { value: "matching", label: "Matching nearest POI" },
  { value: "measuring", label: "Measuring distance" },
  { value: "tentacles", label: "Tentacles" },
  { value: "district", label: "Supervisorial district" },
  { value: "station-name-length", label: "Station name length" },
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

function lineOptions(): string[] {
  const lines = new Set<string>();
  for (const station of validStations) {
    for (const field of ["associated_lines", "other_systems", "primary_system"] as const) {
      String(station.properties[field] ?? "")
        .split(/[,;/]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((line) => lines.add(line));
    }
  }
  return [...lines].sort((a, b) => a.localeCompare(b));
}

export function App() {
  const [mode, setMode] = useState<Mode>("seeker");
  const [selectedPoint, setSelectedPoint] = useState<LngLat>(vanNessMarket);
  const [constraints, setConstraints] = useState<Constraint[]>(readSavedConstraints);
  const [questionKind, setQuestionKind] = useState<QuestionKind>("matching");
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
  const [dataCategory, setDataCategory] = useState<CategoryKey>("museums");

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(constraints));
  }, [constraints]);

  const candidates = useMemo(() => applyConstraints(constraints), [constraints]);
  const enabledConstraints = constraints.filter((constraint) => constraint.enabled);
  const categoryFeatures = getCategoryFeatures(category);
  const dataFeatures = getCategoryFeatures(dataCategory);
  const nearestPoi = nearestFeature(selectedPoint, categoryFeatures);
  const answers = useMemo(() => canonicalAnswers(selectedPoint), [selectedPoint]);
  const lines = useMemo(lineOptions, []);

  useEffect(() => {
    const nearest = nearestFeature(selectedPoint, categoryFeatures);
    if (nearest) setSelectedPoiId(nearest.properties.id);
  }, [category, selectedPoint]);

  function addConstraint() {
    const label = QUESTION_KINDS.find((kind) => kind.value === questionKind)?.label ?? questionKind;
    const base = { id: makeId(), label, enabled: true };
    let next: Constraint;
    if (questionKind === "radius") {
      next = { ...base, kind: "radius", point: selectedPoint, miles: radiusMiles, answer: radiusAnswer };
    } else if (questionKind === "thermometer") {
      next = { ...base, kind: "thermometer", from: thermoFrom, to: thermoTo, answer: thermoAnswer };
    } else if (questionKind === "matching") {
      next = { ...base, kind: "matching", point: selectedPoint, category, answer: yesNoAnswer };
    } else if (questionKind === "measuring") {
      next = { ...base, kind: "measuring", point: selectedPoint, category, answer: measureAnswer };
    } else if (questionKind === "tentacles") {
      next = {
        ...base,
        kind: "tentacles",
        point: selectedPoint,
        category,
        selectedPoiId: selectedPoiId || nearestPoi?.properties.id || "",
        radiusMiles: tentacleRadius,
      };
    } else if (questionKind === "district") {
      next = { ...base, kind: "district", point: selectedPoint, answer: yesNoAnswer };
    } else if (questionKind === "station-name-length") {
      next = { ...base, kind: "station-name-length", point: selectedPoint, answer: yesNoAnswer };
    } else {
      next = { ...base, kind: "transit-line", line: transitLine.trim(), answer: yesNoAnswer };
    }
    setConstraints((current) => [next, ...current]);
  }

  function toggleConstraint(id: string) {
    setConstraints((current) =>
      current.map((constraint) =>
        constraint.id === id ? { ...constraint, enabled: !constraint.enabled } : constraint,
      ),
    );
  }

  function removeConstraint(id: string) {
    setConstraints((current) => current.filter((constraint) => constraint.id !== id));
  }

  function exportState() {
    const encoded = btoa(JSON.stringify(constraints));
    void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#state=${encoded}`);
  }

  useEffect(() => {
    const state = new URLSearchParams(location.hash.replace(/^#/, "")).get("state");
    if (!state) return;
    try {
      setConstraints(JSON.parse(atob(state)) as Constraint[]);
      history.replaceState(null, "", location.pathname);
    } catch {
      // Ignore malformed state links.
    }
  }, []);

  return (
    <main className="app-shell">
      <section className="map-pane" aria-label="Map">
        <MapView
          candidates={candidates}
          eliminated={validStations.filter((station) => !candidates.some((candidate) => candidate.properties.id === station.properties.id))}
          selectedPoint={selectedPoint}
          onSelectPoint={setSelectedPoint}
        />
      </section>

      <section className="control-pane">
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
          <span>Map tap: {pointLabel(selectedPoint)}</span>
        </div>

        {mode === "seeker" && (
          <div className="panel-stack">
            <section className="tool-panel">
              <div className="field-grid">
                <label>
                  Question
                  <select value={questionKind} onChange={(event) => setQuestionKind(event.target.value as QuestionKind)}>
                    {QUESTION_KINDS.map((kind) => (
                      <option key={kind.value} value={kind.value}>
                        {kind.label}
                      </option>
                    ))}
                  </select>
                </label>

                {(questionKind === "matching" || questionKind === "measuring" || questionKind === "tentacles") && (
                  <label>
                    Category
                    <select value={category} onChange={(event) => setCategory(event.target.value as CategoryKey)}>
                      {(questionKind === "matching" ? MATCHING_CATEGORIES : MEASURING_CATEGORIES).map((key) => (
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
                    <p className="mini-copy">A {pointLabel(thermoFrom)} · B {pointLabel(thermoTo)}</p>
                    <Segmented value={thermoAnswer} onChange={setThermoAnswer} options={["warmer", "colder", "same"]} />
                  </>
                )}

                {(questionKind === "matching" || questionKind === "district" || questionKind === "station-name-length") && (
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
                      <select value={selectedPoiId} onChange={(event) => setSelectedPoiId(event.target.value)}>
                        {categoryFeatures.map((feature) => (
                          <option key={feature.properties.id} value={feature.properties.id}>
                            {feature.properties.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}

                {questionKind === "transit-line" && (
                  <>
                    <label>
                      Line
                      <input list="line-options" value={transitLine} onChange={(event) => setTransitLine(event.target.value)} />
                      <datalist id="line-options">
                        {lines.map((line) => (
                          <option key={line} value={line} />
                        ))}
                      </datalist>
                    </label>
                    <Segmented value={yesNoAnswer} onChange={setYesNoAnswer} options={["yes", "no"]} />
                  </>
                )}
              </div>

              <button className="primary-action" type="button" onClick={addConstraint}>
                <ListChecks size={18} />
                Apply answer
              </button>
            </section>

            <section className="tool-panel">
              <div className="section-heading">
                <h2>Question Stack</h2>
                <div className="button-row">
                  <button type="button" title="Export share link" onClick={exportState}>
                    <ListChecks size={17} />
                  </button>
                  <button type="button" title="Clear questions" onClick={() => setConstraints([])}>
                    <RotateCcw size={17} />
                  </button>
                </div>
              </div>
              <div className="constraint-list">
                {constraints.length === 0 && <p className="empty">No questions applied yet.</p>}
                {constraints.map((constraint) => (
                  <article key={constraint.id} className={!constraint.enabled ? "muted-row" : ""}>
                    <button type="button" title="Toggle question" onClick={() => toggleConstraint(constraint.id)}>
                      {constraint.enabled ? <Eye size={17} /> : <EyeOff size={17} />}
                    </button>
                    <span>{describeConstraint(constraint)}</span>
                    <button type="button" title="Remove question" onClick={() => removeConstraint(constraint.id)}>
                      <Trash2 size={17} />
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <CandidateList candidates={candidates} />
          </div>
        )}

        {mode === "hider" && (
          <section className="tool-panel">
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
                    label={`Nearest ${CATEGORY_LABELS[key]}`}
                    value={answer ? `${answer.name} · ${answer.miles.toFixed(2)} mi` : "No data"}
                  />
                );
              })}
            </div>
          </section>
        )}

        {mode === "data" && (
          <section className="tool-panel">
            <div className="section-heading">
              <h2>Frozen Snapshot</h2>
              <span>{snapshot.generatedAt.slice(0, 10)}</span>
            </div>
            <div className="answer-list">
              <AnswerRow label="Rules" value={snapshot.rulesVersion} />
              <AnswerRow label="Valid stations" value={`${validStations.length}`} />
              <AnswerRow label="Active constraints" value={`${enabledConstraints.length}`} />
            </div>
            <div className="warning-box">
              {snapshot.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
              {DISABLED_RULE_NOTES.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
            <label>
              Browse category
              <select value={dataCategory} onChange={(event) => setDataCategory(event.target.value as CategoryKey)}>
                {(Object.keys(CATEGORY_LABELS) as CategoryKey[]).map((key) => (
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
  return (
    <section className="tool-panel">
      <div className="section-heading">
        <h2>Remaining Stations</h2>
        <span>{candidates.length}</span>
      </div>
      <div className="candidate-list">
        {candidates.map((station) => (
          <article key={station.properties.id}>
            <strong>{station.properties.name}</strong>
            <span>{station.properties.primary_system ? String(station.properties.primary_system) : station.properties.sourceSheet}</span>
          </article>
        ))}
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
