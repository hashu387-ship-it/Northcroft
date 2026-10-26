// Location for check-in / check-out.
export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
}

export function getPosition(timeoutMs = 15000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This device can't share its location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new Error("Location is blocked. Allow location for this app in your phone settings."));
        else if (err.code === err.TIMEOUT) reject(new Error("Couldn't get your location in time. Try again outdoors or near a window."));
        else reject(new Error("Couldn't get your location."));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

/** Street address from OpenStreetMap. Returns null if the lookup fails; check-in still works without it. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`,
      { signal: ctrl.signal, headers: { Accept: "application/json" } },
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      display_name?: string;
      address?: Record<string, string>;
    };
    const a = data.address || {};
    const parts = [
      a.road || a.pedestrian || a.neighbourhood,
      a.suburb || a.quarter || a.city_district,
      a.city || a.town || a.village || a.state,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : data.display_name || null;
  } catch {
    return null;
  }
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** "about 350 m" or "about 1.2 km", the way the server says it. */
export function roughDistance(m: number): string {
  if (m < 1000) return `about ${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `about ${(Math.round(m / 100) / 10).toFixed(1)} km`;
}

/** The nearest active office to a spot, with the distance to it. */
export function nearestOffice<P extends { lat: number; lng: number; kind: string; active: boolean }>(fix: { lat: number; lng: number }, places: P[]): { place: P; distance: number } | null {
  let best: { place: P; distance: number } | null = null;
  for (const p of places) {
    if (!p.active || p.kind !== "office") continue;
    const d = distanceMeters(fix, p);
    if (!best || d < best.distance) best = { place: p, distance: d };
  }
  return best;
}
