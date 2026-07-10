import L from "leaflet";
import { useEffect, useRef } from "react";
import { milesToMeters } from "../lib/geo";
import { snapshot, vanNessMarket } from "../lib/snapshot";
import type { CandidateStation, Constraint, LngLat } from "../lib/types";

type MapViewProps = {
  candidates: CandidateStation[];
  eliminated: CandidateStation[];
  constraints: Constraint[];
  possibleRegion: GeoJSON.FeatureCollection;
  selectedPoint: LngLat;
  onSelectPoint: (point: LngLat) => void;
};

export function MapView({ candidates, eliminated, constraints, possibleRegion, selectedPoint, onSelectPoint }: MapViewProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const regionRef = useRef<L.GeoJSON | null>(null);
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
    regionRef.current = L.geoJSON(undefined, {
      interactive: false,
      style: {
        color: "#0f766e",
        weight: 0,
        fillColor: "#14b8a6",
        fillOpacity: 0.28,
      },
    }).addTo(map);
    vectorConstraintRef.current = L.layerGroup().addTo(map);
    const layers = L.layerGroup().addTo(map);
    layersRef.current = layers;
    map.on("click", (event) => onSelectPoint({ lat: event.latlng.lat, lng: event.latlng.lng }));
    mapRef.current = map;
  }, [onSelectPoint]);

  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    region.clearLayers();
    if (possibleRegion.features.length > 0) {
      region.addData(possibleRegion);
    }
  }, [possibleRegion]);

  useEffect(() => {
    const group = vectorConstraintRef.current;
    if (!group) return;
    group.clearLayers();
    for (const constraint of constraints) {
      if (!constraint.enabled || constraint.kind !== "radius") continue;
      const isKeepingInside = constraint.answer === "inside";
      L.circle([constraint.point.lat, constraint.point.lng], {
        radius: milesToMeters(constraint.miles),
        color: isKeepingInside ? "#0f766e" : "#b91c1c",
        weight: 2.5,
        dashArray: isKeepingInside ? undefined : "7 6",
        fillColor: isKeepingInside ? "#14b8a6" : "#ef4444",
        fillOpacity: isKeepingInside ? 0.22 : 0.11,
        interactive: false,
      }).addTo(group);
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
