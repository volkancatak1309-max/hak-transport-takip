"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, useMap } from "react-leaflet";
import { VectorBaseLayer } from "@/components/VectorBaseLayer";
import "leaflet/dist/leaflet.css";
import { polylineCoz, type LatLng } from "@/lib/rota/polyline";
import type { RotaHaritaVerisi } from "@/lib/rota/tipler";

/**
 * ÖNCE / SONRA ROTA HARİTASI — iki rota üst üste: şimdiki GRİ ve kesikli,
 * önerilen MERCAN ve düz. Duraklar önerilen sıra numarasıyla.
 *
 * ⚠️ Bu bileşen yalnız sunucu `harita` verisi gönderdiyse çizilir. Lisans
 * izin vermiyorsa (Google sonucu, EEA dışı koşullar) sunucu geometriyi hiç
 * göndermiyor — karar istemcide değil (app/actions/rota.ts).
 *
 * Taban harita OpenFreeMap/OSM (VectorBaseLayer) ve atfı kendisi basıyor; VROOM
 * + OSRM sonucu da OSM türevi, ek atıf gerekmiyor.
 *
 * Animasyon yok: rota çizimi, işaret düşüşü ya da kayan kamera eklenmedi —
 * yalnız ilk açılışta sınırlara sığdırma (VectorBaseLayer zaten
 * prefers-reduced-motion'a uyuyor).
 */

const AVUSTURYA: [number, number] = [47.5162, 14.5501];

function numaraIkonu(n: number): L.DivIcon {
  return L.divIcon({
    className: "hak-marker-wrap",
    html:
      `<div style="width:22px;height:22px;border-radius:9999px;background:var(--accent-coral);` +
      `color:var(--accent-coral-fg);font:600 11px/22px system-ui,sans-serif;text-align:center;` +
      `box-shadow:0 0 0 2px var(--background)">${n}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

const BASLANGIC_IKONU = L.divIcon({
  className: "hak-marker-wrap",
  html:
    `<div style="width:16px;height:16px;border-radius:3px;background:var(--foreground);` +
    `box-shadow:0 0 0 2px var(--background)"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

/**
 * Sınırlara sığdır — kutu açılış geçişi BİTTİKTEN sonra.
 *
 * ⚠️ Ölçüldü (03.10.2026): harita bir Dialog içinde ve kutu açılırken
 * ölçeklenerek (zoom-in-95) büyüyor; Leaflet kabın boyutunu o ara anda okuyup
 * yanlış yakınlık seçiyordu (Vorarlberg turu St. Gallen–Oberstdorf genişliğinde
 * göründü, numaralar üst üste bindi). Boyut geçişten sonra yeniden okunuyor.
 */
function Sigdir({ noktalar }: { noktalar: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (noktalar.length === 0) return;
    const sigdir = () => {
      map.invalidateSize();
      // animate:false — kayan kamera efekti yok (görev: animasyon eklenmez).
      if (noktalar.length === 1) map.setView(noktalar[0], 13, { animate: false });
      else map.fitBounds(noktalar, { padding: [28, 28], maxZoom: 14, animate: false });
    };
    sigdir();
    const t = setTimeout(sigdir, 250);
    return () => clearTimeout(t);
  }, [noktalar, map]);
  return null;
}

export function RotaKarsilastirmaHaritasi({
  veri,
  baslangicEtiketi,
}: {
  veri: RotaHaritaVerisi;
  baslangicEtiketi: string;
}) {
  const once = useMemo(() => (veri.once ? polylineCoz(veri.once) : []), [veri.once]);
  const sonra = useMemo(() => (veri.sonra ? polylineCoz(veri.sonra) : []), [veri.sonra]);
  const sinir = useMemo<LatLng[]>(
    () => [
      [veri.baslangic.lat, veri.baslangic.lng],
      ...veri.noktalar.map((n) => [n.konum.lat, n.konum.lng] as LatLng),
      ...once,
      ...sonra,
    ],
    [veri, once, sonra]
  );

  return (
    <MapContainer
      center={AVUSTURYA}
      zoom={8}
      // Kesirli yakınlık: kuzey-güney uzanan bir tur (Vorarlberg, 29 km) tam
      // sayı kademede kutunun yarısını boş bırakıyordu (ölçüldü: 145/258 px).
      zoomSnap={0.25}
      scrollWheelZoom={false}
      className="h-full w-full"
      style={{ background: "var(--muted)" }}
    >
      <VectorBaseLayer />
      <Sigdir noktalar={sinir} />
      {once.length > 1 && (
        <Polyline
          positions={once}
          pathOptions={{ color: "var(--muted-foreground)", weight: 4, opacity: 0.75, dashArray: "6 8" }}
        />
      )}
      {sonra.length > 1 && (
        <Polyline positions={sonra} pathOptions={{ color: "var(--accent-coral)", weight: 5, opacity: 0.95 }} />
      )}
      <Marker
        position={[veri.baslangic.lat, veri.baslangic.lng]}
        icon={BASLANGIC_IKONU}
        title={baslangicEtiketi}
      />
      {veri.noktalar.map((n) => (
        <Marker
          key={n.id}
          position={[n.konum.lat, n.konum.lng]}
          icon={numaraIkonu(n.yeniSira)}
          title={`${n.yeniSira}. ${n.ad}`}
        />
      ))}
    </MapContainer>
  );
}
