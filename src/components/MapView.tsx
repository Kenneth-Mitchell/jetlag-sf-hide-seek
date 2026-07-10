import L from "leaflet";
import { useEffect, useRef } from "react";
import { buildConstraintOverlays, type ConstraintOverlay } from "../lib/constraintOverlays";
import { milesToMeters } from "../lib/geo";
import { snapshot, vanNessMarket } from "../lib/snapshot";
import type { CandidateStation, Constraint, LngLat } from "../lib/types";

type MapViewProps = {
  candidates: CandidateStation[];
  eliminated: CandidateStation[];
  constraints: Constraint[];
  draftConstraint?: Constraint;
  onSelectPoint: (point: LngLat) => void;
  onDraftPointChange: (point: LngLat) => void;
  onThermoFromChange: (point: LngLat) => void;
  onThermoToChange: (point: LngLat) => void;
};

function overlayStyle(mode: ConstraintOverlay["mode"], color = "#0f766e"): L.PathOptions {
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

function handleIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div class="drag-handle" style="--handle-color: ${color}"><span>${label}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function toPoint(latlng: L.LatLng): LngLat {
  return { lat: latlng.lat, lng: latlng.lng };
}

function isPointConstraint(constraint: Constraint): constraint is Extract<Constraint, { point: LngLat }> {
  return "point" in constraint;
}

export function MapView({
  candidates,
  eliminated,
  constraints,
  draftConstraint,
  onSelectPoint,
  onDraftPointChange,
  onThermoFromChange,
  onThermoToChange,
}: MapViewProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const appliedConstraintRef = useRef<L.LayerGroup | null>(null);
  const draftConstraintRef = useRef<L.LayerGroup | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const draftPointMarkerRef = useRef<L.Marker | null>(null);
  const thermoFromMarkerRef = useRef<L.Marker | null>(null);
  const thermoToMarkerRef = useRef<L.Marker | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const onSelectPointRef = useRef(onSelectPoint);

  useEffect(() => {
    onSelectPointRef.current = onSelectPoint;
  }, [onSelectPoint]);

  function scheduleDragUpdate(marker: L.Marker, onChange: (point: LngLat) => void) {
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      onChange(toPoint(marker.getLatLng()));
    });
  }

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    const map = L.map(elementRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([vanNessMarket.lat, vanNessMarket.lng], 12);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.attribution({ position: "bottomleft" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    L.geoJSON(snapshot.geometries.playableArea, {
      interactive: false,
      style: {
        color: "#111827",
        weight: 1,
        fillColor: "#f8faf7",
        fillOpacity: 0.08,
      },
    }).addTo(map);
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
    for (const overlay of buildConstraintOverlays(constraints)) {
      if (overlay.kind === "circle") {
        L.circle([overlay.center.lat, overlay.center.lng], {
          ...overlayStyle(overlay.mode, overlay.color),
          radius: milesToMeters(overlay.radiusMiles),
          interactive: false,
        }).addTo(group);
      } else if (overlay.kind === "polygon") {
        L.geoJSON(overlay.feature, {
          interactive: false,
          style: overlayStyle(overlay.mode, overlay.color),
        }).addTo(group);
      } else {
        L.polyline(
          overlay.coordinates.map((coordinate) => [coordinate.lat, coordinate.lng]),
          {
            ...overlayStyle(overlay.mode, overlay.color),
            interactive: false,
          },
        ).addTo(group);
      }
    }
  }, [constraints]);

  useEffect(() => {
    const group = draftConstraintRef.current;
    if (!group) return;
    group.clearLayers();
    if (!draftConstraint) return;
    for (const overlay of buildConstraintOverlays([draftConstraint])) {
      const mode = overlay.mode === "reference" ? "reference" : overlay.mode;
      if (overlay.kind === "circle") {
        L.circle([overlay.center.lat, overlay.center.lng], {
          ...overlayStyle(mode, overlay.color),
          radius: milesToMeters(overlay.radiusMiles),
          interactive: false,
        }).addTo(group);
      } else if (overlay.kind === "polygon") {
        L.geoJSON(overlay.feature, {
          interactive: false,
          style: {
            ...overlayStyle(mode, overlay.color),
            weight: 3,
          },
        }).addTo(group);
      } else {
        L.polyline(
          overlay.coordinates.map((coordinate) => [coordinate.lat, coordinate.lng]),
          {
            ...overlayStyle(mode, overlay.color),
            weight: 3,
            interactive: false,
          },
        ).addTo(group);
      }
    }
  }, [draftConstraint]);

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

    if (!draftConstraint) {
      removePointMarker();
      removeThermoMarkers();
      return;
    }

    const color = draftConstraint.color ?? "#0f766e";
    if (draftConstraint.kind === "thermometer") {
      removePointMarker();
      if (!thermoFromMarkerRef.current) {
        thermoFromMarkerRef.current = L.marker([draftConstraint.from.lat, draftConstraint.from.lng], {
          draggable: true,
          icon: handleIcon("A", color),
          zIndexOffset: 1200,
        }).addTo(map);
      }
      if (!thermoToMarkerRef.current) {
        thermoToMarkerRef.current = L.marker([draftConstraint.to.lat, draftConstraint.to.lng], {
          draggable: true,
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
      fromMarker.off("drag");
      fromMarker.off("dragend");
      toMarker.off("drag");
      toMarker.off("dragend");
      fromMarker.on("drag", () => scheduleDragUpdate(fromMarker, onThermoFromChange));
      fromMarker.on("dragend", () => onThermoFromChange(toPoint(fromMarker.getLatLng())));
      toMarker.on("drag", () => scheduleDragUpdate(toMarker, onThermoToChange));
      toMarker.on("dragend", () => onThermoToChange(toPoint(toMarker.getLatLng())));
      return;
    }

    removeThermoMarkers();
    if (isPointConstraint(draftConstraint)) {
      if (!draftPointMarkerRef.current) {
        draftPointMarkerRef.current = L.marker([draftConstraint.point.lat, draftConstraint.point.lng], {
          draggable: true,
          icon: handleIcon("Ask", color),
          zIndexOffset: 1200,
        }).addTo(map);
      }
      const marker = draftPointMarkerRef.current;
      marker.setIcon(handleIcon("Ask", color));
      marker.setLatLng([draftConstraint.point.lat, draftConstraint.point.lng]);
      marker.off("drag");
      marker.off("dragend");
      marker.on("drag", () => scheduleDragUpdate(marker, onDraftPointChange));
      marker.on("dragend", () => onDraftPointChange(toPoint(marker.getLatLng())));
    } else {
      removePointMarker();
    }
  }, [draftConstraint, onDraftPointChange, onThermoFromChange, onThermoToChange]);

  useEffect(() => {
    const layers = layersRef.current;
    if (!layers) return;
    layers.clearLayers();
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
  }, [candidates, eliminated]);

  return <div ref={elementRef} className="leaflet-host" />;
}
