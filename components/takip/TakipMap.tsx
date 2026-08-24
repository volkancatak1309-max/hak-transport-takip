"use client";

import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, Marker, Circle, useMap } from "react-leaflet";
import { VectorBaseLayer } from "@/components/VectorBaseLayer";
import "leaflet/dist/leaflet.css";

/**
 * MÜŞTERİ TAKİP HARİTASI — girişsiz sayfanın haritası.
 *
 * ═══ NEDEN FleetMap DEĞİL ═══
 *
 * `FleetMap` filo ekranının haritasıdır: TÜM araçları çizer, pil rengini
 * `fleet` (bordo/mavi) alanından alır ve popup'ında plaka + şoför gösterir.
 * Yani kimlik sızdırmak onun İŞİDİR. Girişsiz bir sayfada kullanılması
 * yalnız yanlış değil, tehlikeli olurdu.
 *
 * ═══ NEDEN VehicleMiniMap DE DEĞİL ═══
 *
 * `VehicleMiniMap` doğru ATA: kimliksiz, tek nokta, statik bant. Ama tek bir
 * koordinat alıyor ve müşteriye lazım olan İKİ nokta arasındaki ilişki:
 * "araç nerede" değil, "araç bana göre nerede". Bu yüzden aynı ilkelerle
 * (kimliksiz, anahtarsız harita, sade) ama iki işaretçi ve otomatik
 * çerçeveleme ile ayrı bir bileşen yazıldı.
 *
 * ═══ RENK KİMLİK TAŞIMAZ ═══
 *
 * Pil rengi sabittir. `FLEET_STYLE`den renk almak, bordo/mavi ayrımını
 * müşteriye göstermek olurdu — filo büyüklüğü ve iç yapı hakkında bilgi.
 * Buradaki renk yalnız "araç" ile "hedef"i ayırır.
 */

/** Araç pili — nötr mercan; filo kimliği DEĞİL. */
const ARAC_RENK = "#e2725b";
/** Hedef pili — sakin gri-mavi. */
const HEDEF_RENK = "#4a6fa5";

function pin(renk: string, atan: boolean) {
  return L.divIcon({
    className: "hak-marker-wrap",
    html: `<div class="hak-route-pin${atan ? " hak-takip-atan" : ""}" style="background:${renk}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

/**
 * İki noktayı da çerçeveye alır. Araç hareket ettikçe yeniden çerçeveler —
 * müşterinin haritayı elle takip etmesi gerekmesin.
 *
 * Kullanıcı haritayı ELLE oynattıysa artık müdahale edilmez: otomatik
 * çerçeveleme, incelemeye çalışan birinin ekranını sürekli geri çekerdi.
 */
function Cerceve({
  arac,
  hedef,
}: {
  arac: [number, number] | null;
  hedef: [number, number] | null;
}) {
  const map = useMap();
  useEffect(() => {
    const eldeOynatildi = { current: false };
    const isaret = () => {
      eldeOynatildi.current = true;
    };
    map.on("dragstart", isaret);
    map.on("zoomstart", isaret);
    if (!eldeOynatildi.current) {
      const noktalar = [arac, hedef].filter(Boolean) as [number, number][];
      if (noktalar.length === 2) {
        map.fitBounds(L.latLngBounds(noktalar).pad(0.35), { animate: false });
      } else if (noktalar.length === 1) {
        map.setView(noktalar[0], 14, { animate: false });
      }
    }
    return () => {
      map.off("dragstart", isaret);
      map.off("zoomstart", isaret);
    };
  }, [map, arac, hedef]);
  return null;
}

export function TakipMap({
  arac,
  hedef,
  bayat,
}: {
  arac: { lat: number; lng: number } | null;
  hedef: { lat: number; lng: number; yaricapM: number } | null;
  /** Konum eskiyse pil solar — "canlı" ile "son bilinen" ayrımı görünsün. */
  bayat: boolean;
}) {
  const merkez: [number, number] = arac
    ? [arac.lat, arac.lng]
    : hedef
      ? [hedef.lat, hedef.lng]
      : [47.5, 9.7];

  return (
    <MapContainer
      center={merkez}
      zoom={13}
      className="h-full w-full"
      style={{ background: "var(--muted)" }}
      // Müşteri yakınlaşabilsin: bu bir DEĞER değil, izlenecek bir ekran.
      // Yalnız kutu-zum ve klavye kapalı — dokunmatikte kazara tetikleniyor.
      boxZoom={false}
      keyboard={false}
      zoomControl
      attributionControl
    >
      <VectorBaseLayer />
      {hedef && (
        <>
          <Circle
            center={[hedef.lat, hedef.lng]}
            radius={hedef.yaricapM}
            pathOptions={{ color: HEDEF_RENK, weight: 1, fillOpacity: 0.08 }}
          />
          <Marker position={[hedef.lat, hedef.lng]} icon={pin(HEDEF_RENK, false)} />
        </>
      )}
      {arac && (
        <Marker
          position={[arac.lat, arac.lng]}
          icon={pin(ARAC_RENK, !bayat)}
          opacity={bayat ? 0.55 : 1}
        />
      )}
      <Cerceve
        arac={arac ? [arac.lat, arac.lng] : null}
        hedef={hedef ? [hedef.lat, hedef.lng] : null}
      />
    </MapContainer>
  );
}
