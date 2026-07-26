"use client";

import L from "leaflet";
import { MapContainer, Marker } from "react-leaflet";
import { VectorBaseLayer } from "@/components/VectorBaseLayer";
import "leaflet/dist/leaflet.css";

/**
 * MİNİ HARİTA BANDI — künyedeki "Konum" satırının altında dar bir şerit.
 *
 * Clay kişi-detayı referansının (Refero `754179d7`) sağ sütunundaki adres
 * bandının karşılığı: harita burada bir ARAÇ değil, bir DEĞER. Koordinatın
 * okunur hâli, kendi başına bir ekran değil.
 *
 * Bu yüzden tüm etkileşim kapalıdır — sürükleme, tekerlek zumu, çift tık,
 * klavye. Dar bir bantta tekerlek zumu açık kalsaydı sayfayı kaydırmak isteyen
 * yönetici haritayı zumlardı (kaydırma kapanı). Gerçek gezinme Rota
 * oynatıcıdadır; band yalnız "araç şu civarda"yı söyler.
 */
export function VehicleMiniMap({
  lat,
  lng,
  /** Pin rengi — filo kimliği (bordo/mavi). Süs değil, veri (DESIGN.md §2.3). */
  color,
  label,
}: {
  lat: number;
  lng: number;
  color: string;
  label: string;
}) {
  const icon = L.divIcon({
    className: "hak-marker-wrap",
    html: `<div class="hak-route-pin" style="background:${color}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  return (
    <MapContainer
      center={[lat, lng]}
      zoom={14}
      className="h-full w-full"
      style={{ background: "var(--muted)" }}
      // Statik band: her etkileşim kapalı.
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      boxZoom={false}
      keyboard={false}
      zoomControl={false}
      attributionControl={false}
    >
      <VectorBaseLayer />
      <Marker position={[lat, lng]} icon={icon} alt={label} />
    </MapContainer>
  );
}
