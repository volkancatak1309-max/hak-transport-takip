import "server-only";
import {
  SaglayiciHatasi,
  type Konum,
  type RotaHesabi,
  type RotaOptimizasyonSaglayici,
  type SiralamaCevabi,
  type SiralamaProblemi,
} from "./tipler";
import { UFUK_SN } from "./plan";
import { polylineBirlestir } from "./polyline";
import { erisimJetonu, type ServisHesabi } from "./google-oauth";

/**
 * İKİNCİ (YEDEK) SAĞLAYICI — Google Maps Platform. Anahtar yoksa PASİF.
 *
 * Birincil sağlayıcı VROOM + OSRM'dir (lib/rota/vroom.ts). Google yalnız
 * `ROTA_SAGLAYICI=google` ya da `ROTA_YEDEK=google` + `GOOGLE_ROTA_ANAHTARI`
 * ile devreye girer.
 *
 * ═══ NEDEN İKİ GOOGLE API'Sİ (03.10.2026, belgeler okunarak) ═══
 *
 *   · SIRA → Route Optimization API `optimizeTours`, tek araç = "Single Vehicle
 *     Routing" SKU, durak (shipment) başına 10 $ / 1.000, ayda 5.000 ücretsiz.
 *     Durak süresi + zaman penceresi destekli. Routes API'nin
 *     `optimizeWaypointOrder`ı ELENDİ: istek başına en fazla 25 ara nokta
 *     ("Maximum allowed number of intermediate waypoints per ComputeRoutes
 *     request is 25") ve pencere/süre desteği yok — 50 durak gereksinimini
 *     karşılamıyor.
 *   · KM/SÜRE/GEOMETRİ → Routes API `computeRoutes` (önce ve sonra İÇİN aynı
 *     motor; 25 ara noktadan uzun diziler parçalanır). İstek başına ücret.
 *
 * ═══ KULLANIM KOŞULU — HARİTA ═══
 *
 * EEA DIŞI koşullarda (Service Specific Terms §18.2 Route Optimization,
 * §19.2 Routes): "Customer must not use Google Maps Content … in conjunction
 * with a non-Google map." Panelin haritası OpenFreeMap/OSM — Google DEĞİL.
 * EEA koşullarında bu madde yok. Karar `GOOGLE_HARITA_KOSULU=eea` ile verilir
 * (fatura adresi AB'deyse); verilmezse sonuç haritasız (liste) gösterilir.
 * Önbellek: lat/lng en fazla 30 gün (§18.3) — bu sağlayıcı hiçbir şey SAKLAMAZ.
 */

const RO_UC = "https://routeoptimization.googleapis.com/v1";
const ROUTES_UC = "https://routes.googleapis.com/directions/v2:computeRoutes";
/** Routes API: 25 ara nokta + başlangıç + bitiş. */
const PARCA_NOKTA = 27;

const latLng = (k: Konum) => ({ latitude: k.lat, longitude: k.lng });

/** Route Optimization istek gövdesi — SAF (testler denetliyor). */
export function googleSiralamaIstegi(p: SiralamaProblemi) {
  const iso = (sn: number) => new Date(p.anMs(Math.round(sn))).toISOString();
  const ufuk = p.hareketSn + UFUK_SN;
  return {
    timeout: "15s",
    model: {
      globalStartTime: iso(p.hareketSn),
      globalEndTime: iso(ufuk),
      shipments: p.duraklar.map((d) => {
        // Pencere hareketten önce kapanmışsa (geçmişte kalmışsa) model onu
        // doğrulama hatasıyla reddedebilir; yetişilemeyecek bir pencere zaten
        // çizelgede "geç" olarak görünür — sıralamaya taşınmaz.
        const bas = d.pencere?.bas ?? null;
        const bit = d.pencere?.bit ?? null;
        const pencereGecerli = d.pencere !== null && (bit === null || bit > p.hareketSn);
        return {
          label: d.id,
          // Ceza tanımsızsa gönderi ZORUNLU sayılır ve olanaksız pencere tüm
          // isteği düşürebilir. Yüksek ceza: mümkünse yapılır, değilse
          // "skippedShipments"a düşer ve çekirdek pencereyi gevşetip yeniden sorar.
          penaltyCost: 1_000_000,
          deliveries: [
            {
              arrivalLocation: latLng(d.konum),
              duration: `${Math.max(0, Math.round(d.servisSn))}s`,
              ...(pencereGecerli
                ? {
                    timeWindows: [
                      {
                        ...(bas !== null ? { startTime: iso(Math.max(bas, p.hareketSn)) } : {}),
                        ...(bit !== null ? { endTime: iso(bit) } : {}),
                      },
                    ],
                  }
                : {}),
            },
          ],
        };
      }),
      vehicles: [
        {
          startLocation: latLng(p.baslangic),
          ...(p.bitis ? { endLocation: latLng(p.bitis) } : {}),
          startTimeWindows: [{ startTime: iso(p.hareketSn) }],
          // Maliyet tanımsızsa optimizer bütün çözümleri eşit sayar (belgenin
          // uyarısı). Saat ağırlıklı: VROOM'un varsayılanı (süre) ile aynı amaç,
          // km de az bir payla katılıyor.
          costPerHour: 30,
          costPerKilometer: 0.3,
        },
      ],
    },
  };
}

type GoogleRoCevap = {
  routes?: { visits?: { shipmentIndex?: number; shipmentLabel?: string }[] }[];
  skippedShipments?: { index?: number; label?: string }[];
};

/**
 * Cevap → sıra. SAF.
 * ⚠️ proto3 JSON'da varsayılan değer YAZILMAZ: `shipmentIndex` 0 ise alan hiç
 * gelmez. Önce etikete (kendi kimliğimiz), sonra dizine bakılıyor.
 */
export function googleSiralamaCevabi(p: SiralamaProblemi, j: GoogleRoCevap): SiralamaCevabi {
  const idOf = (etiket: string | undefined, dizin: number | undefined): string => {
    if (etiket && p.duraklar.some((d) => d.id === etiket)) return etiket;
    const d = p.duraklar[dizin ?? 0];
    if (!d) throw new SaglayiciHatasi("gecersiz_cevap", `google bilinmeyen gönderi ${dizin}`);
    return d.id;
  };
  return {
    sira: (j.routes?.[0]?.visits ?? []).map((v) => idOf(v.shipmentLabel, v.shipmentIndex)),
    atanamayan: (j.skippedShipments ?? []).map((s) => idOf(s.label, s.index)),
  };
}

/** n nokta → en fazla 27'lik, uçları paylaşan parçalar. SAF. */
export function rotaParcalari<T>(noktalar: T[], boy = PARCA_NOKTA): T[][] {
  if (noktalar.length < 2) return [];
  const parcalar: T[][] = [];
  for (let i = 0; i < noktalar.length - 1; i += boy - 1) {
    parcalar.push(noktalar.slice(i, Math.min(noktalar.length, i + boy)));
  }
  return parcalar;
}

/** Routes API "123s" → 123. */
const sureSn = (s: string | undefined) => (s ? Number.parseFloat(s) : 0) || 0;

export class GoogleSaglayici implements RotaOptimizasyonSaglayici {
  readonly kod = "google" as const;
  readonly ad = "Google Maps Platform";

  private readonly sa: ServisHesabi;
  /** Yalnız EEA koşullarında true — bkz. dosya başlığı. */
  readonly haritaSerbest: boolean;

  constructor(sa: ServisHesabi, haritaSerbest: boolean) {
    this.sa = sa;
    this.haritaSerbest = haritaSerbest;
  }

  private async post(url: string, govde: unknown, ekBaslik: Record<string, string> = {}) {
    const jeton = await erisimJetonu(this.sa);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jeton}`,
          "Content-Type": "application/json",
          ...ekBaslik,
        },
        body: JSON.stringify(govde),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
    } catch (e) {
      throw new SaglayiciHatasi("erisilemedi", String((e as Error)?.message ?? e).slice(0, 160));
    }
    if (res.status === 401 || res.status === 403) {
      throw new SaglayiciHatasi("yetkisiz", `google HTTP ${res.status}`);
    }
    if (res.status >= 500 || res.status === 429) {
      throw new SaglayiciHatasi("erisilemedi", `google HTTP ${res.status}`);
    }
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      const mesaj = (j as { error?: { message?: string } } | null)?.error?.message ?? "";
      throw new SaglayiciHatasi("reddedildi", `google HTTP ${res.status} ${mesaj.slice(0, 160)}`);
    }
    if (j === null) throw new SaglayiciHatasi("gecersiz_cevap", "google: gövde JSON değil");
    return j;
  }

  async sirala(p: SiralamaProblemi): Promise<SiralamaCevabi> {
    if (p.duraklar.length === 0) return { sira: [], atanamayan: [] };
    const j = await this.post(
      `${RO_UC}/projects/${encodeURIComponent(this.sa.project_id)}:optimizeTours`,
      googleSiralamaIstegi(p)
    );
    return googleSiralamaCevabi(p, j as GoogleRoCevap);
  }

  async rotaHesapla(noktalar: Konum[]): Promise<RotaHesabi> {
    const parcalar = rotaParcalari(noktalar);
    const bacaklar: RotaHesabi["bacaklar"] = [];
    const cizgiler: (string | null)[] = [];
    for (const parca of parcalar) {
      const j = (await this.post(
        ROUTES_UC,
        {
          origin: { location: { latLng: latLng(parca[0]) } },
          destination: { location: { latLng: latLng(parca[parca.length - 1]) } },
          intermediates: parca.slice(1, -1).map((k) => ({ location: { latLng: latLng(k) } })),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
          polylineQuality: "OVERVIEW",
          computeAlternativeRoutes: false,
        },
        {
          "X-Goog-FieldMask":
            "routes.legs.distanceMeters,routes.legs.duration,routes.polyline.encodedPolyline",
        }
      )) as {
        routes?: {
          legs?: { distanceMeters?: number; duration?: string }[];
          polyline?: { encodedPolyline?: string };
        }[];
      };
      const rota = j.routes?.[0];
      const parcaBacak = (rota?.legs ?? []).map((l) => ({
        mesafeM: Number(l.distanceMeters ?? 0),
        sureSn: sureSn(l.duration),
      }));
      if (parcaBacak.length !== parca.length - 1) {
        throw new SaglayiciHatasi(
          "gecersiz_cevap",
          `routes ${parcaBacak.length} bacak, beklenen ${parca.length - 1}`
        );
      }
      bacaklar.push(...parcaBacak);
      cizgiler.push(rota?.polyline?.encodedPolyline ?? null);
    }
    return {
      bacaklar,
      geometri: parcalar.length > 0 ? polylineBirlestir(cizgiler) : null,
      // Google yapışma mesafesi vermiyor; kapsamı küresel.
      yapismaM: null,
      istekSayisi: parcalar.length,
    };
  }

  /**
   * Liste fiyatı ÜST SINIRI (ücretsiz kademe düşülmeden): Single Vehicle
   * Routing 10 $/1.000 gönderi, Compute Routes Pro 10 $/1.000 istek
   * (10'dan fazla ara nokta Pro'ya düşer; Essentials 5 $ — ihtiyatlı tarafta
   * kalınıyor). Kaynak: developers.google.com/maps/billing-and-pricing/pricing.
   */
  maliyetUsd(c: { siralananDurak: number; rotaIstegi: number }): number {
    return Math.round((c.siralananDurak * 0.01 + c.rotaIstegi * 0.01) * 10_000) / 10_000;
  }
}
