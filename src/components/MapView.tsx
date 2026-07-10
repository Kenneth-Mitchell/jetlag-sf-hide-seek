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
  selectedPoint: LngLat;
  onSelectPoint: (point: LngLat) => void;
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

export function MapView({ candidates, eliminated, constraints, selectedPoint, onSelectPoint }: MapViewProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const vectorConstraintRef = useRef<L.LayerGroup | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

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
    vectorConstraintRef.current = L.layerGroup().addTo(map);
    const layers = L.layerGroup().addTo(map);
    layersRef.current = layers;
    map.on("click", (event) => onSelectPoint({ lat: event.latlng.lat, lng: event.latlng.lng }));
    mapRef.current = map;
  }, [onSelectPoint]);

  useEffect(() => {
    const group = vectorConstraintRef.current;
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      markerRef.current = L.marker([selectedPoint.lat, selectedPoint.lng]).addTo(map);
    } else {
      markerRef.current.setLatLng([selectedPoint.lat, selectedPoint.lng]);
    }
  }, [selectedPoint]);

  return <div ref={elementRef} className="leaflet-host" />;
}
