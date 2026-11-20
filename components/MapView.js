'use client';
// Leaflet map with OpenStreetMap tiles. Only circle markers are used (no image icons to bundle).
//   points: [{ lat, lng, color, radius, popup (HTML string, already escaped), key }]
//   onPick(lat, lng): click to choose a location; picked: { lat, lng } shows a marker
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export default function MapView({ points = [], center, zoom = 10, onPick, picked, className = 'map', fit = false }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const pickLayer = useRef(null);
  const L = useRef(null);
  const fitted = useRef(false);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // create the map once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const leaflet = (await import('leaflet')).default;
      if (cancelled || map.current || !el.current) return;
      L.current = leaflet;
      const m = leaflet.map(el.current, { scrollWheelZoom: true }).setView(center || [12.38, 75.79], zoom);
      leaflet
        .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '&copy; OpenStreetMap contributors',
        })
        .addTo(m);
      layer.current = leaflet.layerGroup().addTo(m);
      pickLayer.current = leaflet.layerGroup().addTo(m);
      m.on('click', (e) => onPickRef.current?.(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))));
      map.current = m;
      draw();
      drawPick();
    })();
    return () => {
      cancelled = true;
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  function draw() {
    const leaflet = L.current;
    if (!leaflet || !layer.current) return;
    layer.current.clearLayers();
    const bounds = [];
    for (const p of points) {
      if (p.lat == null || p.lng == null) continue;
      const mk = leaflet.circleMarker([p.lat, p.lng], {
        radius: p.radius || 7,
        color: '#ffffff',
        weight: 1.5,
        fillColor: p.color || '#14213d',
        fillOpacity: 0.9,
      });
      if (p.popup) mk.bindPopup(p.popup);
      mk.addTo(layer.current);
      bounds.push([p.lat, p.lng]);
    }
    if (fit && !fitted.current && bounds.length > 1) {
      map.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
      fitted.current = true;
    }
  }

  function drawPick() {
    const leaflet = L.current;
    if (!leaflet || !pickLayer.current) return;
    pickLayer.current.clearLayers();
    if (picked?.lat != null) {
      leaflet
        .circleMarker([picked.lat, picked.lng], { radius: 10, color: '#e4572e', weight: 3, fillColor: '#e4572e', fillOpacity: 0.35 })
        .addTo(pickLayer.current);
    }
  }

  useEffect(draw, [points]);
  useEffect(drawPick, [picked?.lat, picked?.lng]);

  return <div ref={el} className={className} />;
}
