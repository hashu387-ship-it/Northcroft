import { useEffect } from "react";
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color?: string;
  radius?: number;
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

/** OpenStreetMap with coloured dots. Defaults to Riyadh when there is nothing to show. */
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
          <CircleMarker center={[p.lat, p.lng]} radius={9} pathOptions={{ color: "#fff", weight: 3, fillColor: p.color ?? "#0a84ff", fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -8]} permanent={showLabels}>
              {p.label}
            </Tooltip>
          </CircleMarker>
        </div>
      ))}
    </MapContainer>
  );
}
