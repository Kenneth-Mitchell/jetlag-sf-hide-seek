import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { buildConstraintOverlays, buildVoronoiPreviewOverlays, type ConstraintOverlay } from "../lib/constraintOverlays";
import { milesToMeters } from "../lib/geo";
import { snapshot, vanNessMarket } from "../lib/snapshot";
import type { CandidateStation, Constraint, LngLat } from "../lib/types";

type MapViewProps = {
  candidates: CandidateStation[];
  eliminated: CandidateStation[];
  constraints: Constraint[];
  currentPoint?: LngLat;
  draftConstraint?: Constraint;
  answerPreviewOverlays?: ConstraintOverlay[];
  showStations: boolean;
  showCurrentQuestion: boolean;
  showAppliedQuestions: boolean;
  showAnswerRegions: boolean;
  onSelectPoint: (point: LngLat) => void;
  onDraftPointPreview?: (point: LngLat | null) => void;
  onDraftPointChange: (point: LngLat) => void;
  onThermoFromPreview?: (point: LngLat | null) => void;
  onThermoFromChange: (point: LngLat) => void;
  onThermoToPreview?: (point: LngLat | null) => void;
  onThermoToChange: (point: LngLat) => void;
};

type ThermometerDrag = {
  handle: "from" | "to";
  point: LngLat;
};

function overlayStyle(mode: ConstraintOverlay["mode"], color = "#7c3aed"): L.PathOptions {
  if (mode === "reference") {
    return {
      color,
      weight: 2,
      dashArray: "6 6",
      fillOpacity: 0,
    };
  }
  if (mode === "exclude") {
    return {
      color,
      weight: 2.2,
      dashArray: "7 6",
      fillColor: color,
      fillOpacity: 0.12,
    };
  }
  return {
    color,
    weight: 2.2,
    fillColor: color,
    fillOpacity: 0.2,
  };
}

function overlayPathOptions(overlay: ConstraintOverlay, mode: ConstraintOverlay["mode"] = overlay.mode): L.PathOptions {
  const style = overlayStyle(mode, overlay.color);
  return {
    ...style,
    dashArray: overlay.dashArray ?? style.dashArray,
    fillOpacity: overlay.fillOpacity ?? style.fillOpacity,
    weight: overlay.weight ?? style.weight,
  };
}

function handleIcon(label: string, color: string): L.DivIcon {
  const content = label ? `<span>${label}</span>` : "";
  const dotClass = label ? "" : " drag-handle-dot";
  return L.divIcon({
    className: "",
    html: `<div class="drag-handle${dotClass}" style="--handle-color: ${color}">${content}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function hiderIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="hider-location-marker"><span>H</span></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function toPoint(latlng: L.LatLng): LngLat {
  return { lat: latlng.lat, lng: latlng.lng };
}

function isPointConstraint(constraint: Constraint): constraint is Extract<Constraint, { point: LngLat }> {
  return "point" in constraint;
}

function pointFromPointer(map: L.Map, event: PointerEvent): LngLat {
  const rect = map.getContainer().getBoundingClientRect();
  const latlng = map.containerPointToLatLng(L.point(event.clientX - rect.left, event.clientY - rect.top));
  return { lat: latlng.lat, lng: latlng.lng };
}

function clampMapMinZoom(map: L.Map, bounds: L.LatLngBounds) {
  const minZoom = map.getBoundsZoom(bounds, false, L.point(12, 12));
  map.setMinZoom(minZoom);
  if (map.getZoom() < minZoom) map.setZoom(minZoom, { animate: false });
}

function withDraftDragPreview(
  constraint: Constraint,
  draftDragPoint: LngLat | null,
  thermometerDrag: ThermometerDrag | null,
): Constraint {
  if (draftDragPoint && isPointConstraint(constraint)) return { ...constraint, point: draftDragPoint };
  if (thermometerDrag && constraint.kind === "thermometer") {
    return thermometerDrag.handle === "from"
      ? { ...constraint, from: thermometerDrag.point }
      : { ...constraint, to: thermometerDrag.point };
  }
  return constraint;
}

function attachManualDrag(
  map: L.Map,
  marker: L.Marker,
  onStart: (point: LngLat) => void,
  onMove: (point: LngLat) => void,
  onEnd: (point: LngLat) => void,
): () => void {
  const element = marker.getElement();
  if (!element) return () => undefined;

  const controller = new AbortController();
  let activeCleanup: (() => void) | null = null;
  let moveFrame: number | null = null;
  let pendingMovePoint: LngLat | null = null;
  L.DomEvent.disableClickPropagation(element);
  L.DomEvent.disableScrollPropagation(element);

  const flushMove = () => {
    if (moveFrame !== null) {
      window.cancelAnimationFrame(moveFrame);
      moveFrame = null;
    }
    if (!pendingMovePoint) return;
    const point = pendingMovePoint;
    pendingMovePoint = null;
    onMove(point);
  };

  const scheduleMove = (point: LngLat) => {
    pendingMovePoint = point;
    if (moveFrame !== null) return;
    moveFrame = window.requestAnimationFrame(() => {
      moveFrame = null;
      flushMove();
    });
  };

  element.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const restoreMapDragging = map.dragging.enabled();
      if (restoreMapDragging) map.dragging.disable();
      element.classList.add("is-dragging");
      element.setPointerCapture?.(event.pointerId);

      const moveTo = (pointerEvent: PointerEvent) => {
        const point = pointFromPointer(map, pointerEvent);
        marker.setLatLng([point.lat, point.lng]);
        scheduleMove(point);
        return point;
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleEnd);
        window.removeEventListener("pointercancel", handleCancel);
        element.releasePointerCapture?.(event.pointerId);
        element.classList.remove("is-dragging");
        if (restoreMapDragging && !map.dragging.enabled()) map.dragging.enable();
        activeCleanup = null;
      };

      const handleMove = (pointerEvent: PointerEvent) => {
        pointerEvent.preventDefault();
        moveTo(pointerEvent);
      };

      const handleEnd = (pointerEvent: PointerEvent) => {
        pointerEvent.preventDefault();
        const point = moveTo(pointerEvent);
        flushMove();
        onEnd(point);
        cleanup();
      };

      const handleCancel = (pointerEvent: PointerEvent) => {
        pointerEvent.preventDefault();
        flushMove();
        onEnd(toPoint(marker.getLatLng()));
        cleanup();
      };

      activeCleanup?.();
      activeCleanup = cleanup;
      onStart(toPoint(marker.getLatLng()));
      moveTo(event);
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleEnd);
      window.addEventListener("pointercancel", handleCancel);
    },
    { signal: controller.signal },
  );

  return () => {
    activeCleanup?.();
    if (moveFrame !== null) window.cancelAnimationFrame(moveFrame);
    controller.abort();
  };
}

export function MapView({
  candidates,
  eliminated,
  constraints,
  currentPoint,
  draftConstraint,
  answerPreviewOverlays = [],
  showStations,
  showCurrentQuestion,
  showAppliedQuestions,
  showAnswerRegions,
  onSelectPoint,
  onDraftPointPreview,
  onDraftPointChange,
  onThermoFromPreview,
  onThermoFromChange,
  onThermoToPreview,
  onThermoToChange,
}: MapViewProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const appliedConstraintRef = useRef<L.LayerGroup | null>(null);
  const draftConstraintRef = useRef<L.LayerGroup | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const panBoundsRef = useRef<L.LatLngBounds | null>(null);
  const draftPointMarkerRef = useRef<L.Marker | null>(null);
  const currentPointMarkerRef = useRef<L.Marker | null>(null);
  const thermoFromMarkerRef = useRef<L.Marker | null>(null);
  const thermoToMarkerRef = useRef<L.Marker | null>(null);
  const onSelectPointRef = useRef(onSelectPoint);
  const [draftDragPoint, setDraftDragPoint] = useState<LngLat | null>(null);
  const [thermometerDrag, setThermometerDrag] = useState<ThermometerDrag | null>(null);

  useEffect(() => {
    onSelectPointRef.current = onSelectPoint;
  }, [onSelectPoint]);

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    const map = L.map(elementRef.current, {
      zoomControl: false,
      attributionControl: false,
      maxBoundsViscosity: 0.9,
    }).setView([vanNessMarket.lat, vanNessMarket.lng], 12);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.attribution({ position: "bottomleft" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      noWrap: true,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    const playableLayer = L.geoJSON(snapshot.geometries.playableArea, {
      interactive: false,
      style: {
        color: "#111827",
        weight: 1,
        fillColor: "#f8faf7",
        fillOpacity: 0.08,
      },
    }).addTo(map);
    const gameBounds = playableLayer.getBounds();
    const viewBounds = gameBounds.pad(0.04);
    const panBounds = gameBounds.pad(0.18);
    panBoundsRef.current = panBounds;
    map.fitBounds(viewBounds, { animate: false, padding: [12, 12] });
    map.setMaxBounds(panBounds);
    clampMapMinZoom(map, viewBounds);
    map.on("resize", () => clampMapMinZoom(map, viewBounds));
    const layers = L.layerGroup().addTo(map);
    layersRef.current = layers;
    appliedConstraintRef.current = L.layerGroup().addTo(map);
    draftConstraintRef.current = L.layerGroup().addTo(map);
    map.on("click", (event) => onSelectPointRef.current({ lat: event.latlng.lat, lng: event.latlng.lng }));
    mapRef.current = map;
  }, []);

  useEffect(() => {
    const group = appliedConstraintRef.current;
    if (!group) return;
    group.clearLayers();
    if (!showAppliedQuestions) return;
    for (const overlay of buildConstraintOverlays(constraints)) {
      if (overlay.kind === "circle") {
        L.circle([overlay.center.lat, overlay.center.lng], {
          ...overlayPathOptions(overlay),
          radius: milesToMeters(overlay.radiusMiles),
          interactive: false,
        }).addTo(group);
      } else if (overlay.kind === "polygon") {
        L.geoJSON(overlay.feature, {
          interactive: false,
          style: {
            ...overlayPathOptions(overlay),
            stroke: overlay.stroke ?? true,
          },
        }).addTo(group);
      } else {
        L.polyline(
          overlay.coordinates.map((coordinate) => [coordinate.lat, coordinate.lng]),
          {
            ...overlayPathOptions(overlay),
            interactive: false,
          },
        ).addTo(group);
      }
    }
  }, [constraints, showAppliedQuestions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!currentPoint) {
      currentPointMarkerRef.current?.remove();
      currentPointMarkerRef.current = null;
      return;
    }

    const latLng: L.LatLngExpression = [currentPoint.lat, currentPoint.lng];
    if (!currentPointMarkerRef.current) {
      currentPointMarkerRef.current = L.marker(latLng, {
        icon: hiderIcon(),
        interactive: false,
        zIndexOffset: 1300,
      }).addTo(map);
    }
    currentPointMarkerRef.current.setLatLng(latLng);

    const panBounds = panBoundsRef.current;
    if (panBounds?.contains(latLng) && !map.getBounds().pad(-0.2).contains(latLng)) {
      map.panTo(latLng, { animate: true });
    }
  }, [currentPoint]);

  useEffect(() => {
    const group = draftConstraintRef.current;
    if (!group) return;
    group.clearLayers();
    if (!draftConstraint) return;
    if (!showCurrentQuestion && !showAnswerRegions) return;
    const previewConstraint = withDraftDragPreview(draftConstraint, draftDragPoint, thermometerDrag);
    const activeAnswerOverlays = showAnswerRegions ? answerPreviewOverlays : [];
    const voronoiPreview = draftDragPoint && activeAnswerOverlays.length === 0 ? buildVoronoiPreviewOverlays(previewConstraint) : [];
    const overlays =
      activeAnswerOverlays.length > 0
        ? activeAnswerOverlays
        : voronoiPreview.length > 0
          ? voronoiPreview
          : showCurrentQuestion
            ? buildConstraintOverlays([previewConstraint])
            : [];
    for (const overlay of overlays) {
      const mode = overlay.mode === "reference" ? "reference" : overlay.mode;
      if (overlay.kind === "circle") {
        L.circle([overlay.center.lat, overlay.center.lng], {
          ...overlayPathOptions(overlay, mode),
          radius: milesToMeters(overlay.radiusMiles),
          interactive: false,
        }).addTo(group);
      } else if (overlay.kind === "polygon") {
        L.geoJSON(overlay.feature, {
          interactive: false,
          style: {
            ...overlayPathOptions(overlay, mode),
            stroke: overlay.stroke ?? true,
            weight: overlay.weight ?? 3,
          },
        }).addTo(group);
      } else {
        L.polyline(
          overlay.coordinates.map((coordinate) => [coordinate.lat, coordinate.lng]),
          {
            ...overlayPathOptions(overlay, mode),
            weight: overlay.weight ?? 3,
            interactive: false,
          },
        ).addTo(group);
      }
    }
  }, [answerPreviewOverlays, draftConstraint, draftDragPoint, showAnswerRegions, showCurrentQuestion, thermometerDrag]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const removePointMarker = () => {
      if (draftPointMarkerRef.current) {
        draftPointMarkerRef.current.remove();
        draftPointMarkerRef.current = null;
      }
    };
    const removeThermoMarkers = () => {
      for (const ref of [thermoFromMarkerRef, thermoToMarkerRef]) {
        if (ref.current) {
          ref.current.remove();
          ref.current = null;
        }
      }
    };

    if (!draftConstraint || !showCurrentQuestion) {
      setDraftDragPoint(null);
      setThermometerDrag(null);
      removePointMarker();
      removeThermoMarkers();
      return;
    }

    const color = draftConstraint.color ?? "#7c3aed";
    if (draftConstraint.kind === "thermometer") {
      removePointMarker();
      if (!thermoFromMarkerRef.current) {
        thermoFromMarkerRef.current = L.marker([draftConstraint.from.lat, draftConstraint.from.lng], {
          draggable: false,
          icon: handleIcon("A", color),
          zIndexOffset: 1200,
        }).addTo(map);
      }
      if (!thermoToMarkerRef.current) {
        thermoToMarkerRef.current = L.marker([draftConstraint.to.lat, draftConstraint.to.lng], {
          draggable: false,
          icon: handleIcon("B", color),
          zIndexOffset: 1200,
        }).addTo(map);
      }
      const fromMarker = thermoFromMarkerRef.current;
      const toMarker = thermoToMarkerRef.current;
      fromMarker.setIcon(handleIcon("A", color));
      toMarker.setIcon(handleIcon("B", color));
      fromMarker.setLatLng([draftConstraint.from.lat, draftConstraint.from.lng]);
      toMarker.setLatLng([draftConstraint.to.lat, draftConstraint.to.lng]);
      const cleanupFrom = attachManualDrag(
        map,
        fromMarker,
        (point) => {
          setThermometerDrag({ handle: "from", point });
          onThermoFromPreview?.(point);
        },
        (point) => {
          setThermometerDrag({ handle: "from", point });
          onThermoFromPreview?.(point);
        },
        (point) => {
          onThermoFromChange(point);
          setThermometerDrag(null);
          onThermoFromPreview?.(null);
        },
      );
      const cleanupTo = attachManualDrag(
        map,
        toMarker,
        (point) => {
          setThermometerDrag({ handle: "to", point });
          onThermoToPreview?.(point);
        },
        (point) => {
          setThermometerDrag({ handle: "to", point });
          onThermoToPreview?.(point);
        },
        (point) => {
          onThermoToChange(point);
          setThermometerDrag(null);
          onThermoToPreview?.(null);
        },
      );
      return () => {
        cleanupFrom();
        cleanupTo();
      };
    }

    removeThermoMarkers();
    setThermometerDrag(null);
    if (isPointConstraint(draftConstraint)) {
      if (!draftPointMarkerRef.current) {
        draftPointMarkerRef.current = L.marker([draftConstraint.point.lat, draftConstraint.point.lng], {
          draggable: false,
          icon: handleIcon("", color),
          zIndexOffset: 1200,
        }).addTo(map);
      }
      const marker = draftPointMarkerRef.current;
      marker.setIcon(handleIcon("", color));
      if (!draftDragPoint) marker.setLatLng([draftConstraint.point.lat, draftConstraint.point.lng]);
      return attachManualDrag(
        map,
        marker,
        (point) => {
          setDraftDragPoint(point);
          onDraftPointPreview?.(point);
        },
        (point) => {
          setDraftDragPoint(point);
          onDraftPointPreview?.(point);
        },
        (point) => {
          onDraftPointChange(point);
          setDraftDragPoint(null);
          onDraftPointPreview?.(null);
        },
      );
    } else {
      setDraftDragPoint(null);
      removePointMarker();
    }
  }, [
    draftConstraint,
    onDraftPointChange,
    onDraftPointPreview,
    onThermoFromChange,
    onThermoFromPreview,
    onThermoToChange,
    onThermoToPreview,
    showCurrentQuestion,
  ]);

  useEffect(() => {
    const layers = layersRef.current;
    if (!layers) return;
    layers.clearLayers();
    if (!showStations) return;
    for (const station of eliminated) {
      const [lng, lat] = station.geometry.coordinates;
      L.circle([lat, lng], {
        radius: milesToMeters(snapshot.hideRadiusMiles),
        color: "#71717a",
        weight: 1,
        fillColor: "#a1a1aa",
        fillOpacity: 0.06,
        interactive: false,
      }).addTo(layers);
    }
    for (const station of candidates) {
      const [lng, lat] = station.geometry.coordinates;
      L.circle([lat, lng], {
        radius: milesToMeters(snapshot.hideRadiusMiles),
        color: "#0f766e",
        weight: 1.5,
        fillColor: "#14b8a6",
        fillOpacity: candidates.length <= 40 ? 0.24 : 0.13,
        interactive: false,
      }).addTo(layers);
    }
  }, [candidates, eliminated, showStations]);

  return <div ref={elementRef} className="leaflet-host" />;
}
