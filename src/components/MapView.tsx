import { useEffect, useMemo } from "react";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color?: string;
  radius?: number;
  /** A person's photo: the pin shows it as a circle (initials if there's no photo). */
  photo?: string | null;
  initials?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Round photo pin for a person, with their initials on their colour as a fallback. */
function PersonPin({ p, showLabels }: { p: MapPoint; showLabels: boolean }) {
  const icon = useMemo(() => {
    const bg = /^#[0-9a-f]{3,8}$/i.test(p.color ?? "") ? p.color : "#1B3570";
    const text = esc((p.initials ?? "?").slice(0, 2));
    // Initials sit underneath; the photo covers them once it loads.
    const img = p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" />` : "";
    return L.divIcon({ className: "map-pin", html: `<div class="pin-face" style="background:${bg}">${text}${img}</div>`, iconSize: [40, 40] });
  }, [p.photo, p.initials, p.color]);
  return (
    <Marker position={[p.lat, p.lng]} icon={icon}>
      <Tooltip direction="top" offset={[0, -22]} permanent={showLabels}>
        {p.label}
      </Tooltip>
    </Marker>
  );
}

function Fit({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15);
      return;
    }
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [40, 40], maxZoom: 15 },
    );
  }, [map, points]);
  return null;
}

function Picker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** OpenStreetMap with photo pins for people and coloured dots for places. Defaults to Riyadh when there is nothing to show. */
export default function MapView({
  points,
  onPick,
  className = "map",
  showLabels = false,
}: {
  points: MapPoint[];
  onPick?: (lat: number, lng: number) => void;
  className?: string;
  showLabels?: boolean;
}) {
  return (
    <MapContainer center={[24.7136, 46.6753]} zoom={11} className={className} scrollWheelZoom={false} attributionControl>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />
      <Fit points={points} />
      {onPick && <Picker onPick={onPick} />}
      {points.map((p) => (
        <div key={p.id}>
          {p.radius ? <Circle center={[p.lat, p.lng]} radius={p.radius} pathOptions={{ color: p.color ?? "#0a84ff", weight: 1, fillOpacity: 0.12 }} /> : null}
          {p.photo !== undefined || p.initials ? (
            <PersonPin p={p} showLabels={showLabels} />
          ) : (
            <CircleMarker center={[p.lat, p.lng]} radius={9} pathOptions={{ color: "#fff", weight: 3, fillColor: p.color ?? "#0a84ff", fillOpacity: 1 }}>
              <Tooltip direction="top" offset={[0, -8]} permanent={showLabels}>
                {p.label}
              </Tooltip>
            </CircleMarker>
          )}
        </div>
      ))}
    </MapContainer>
  );
}
