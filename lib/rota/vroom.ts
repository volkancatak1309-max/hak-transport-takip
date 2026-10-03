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

/**
 * BİRİNCİL SAĞLAYICI — VROOM + OSRM (kendi sunucumuz).
 *
 * ═══ NEREDE KOŞUYOR (03.10.2026 ölçümü) ═══
 *
 * Hetzner CX33 (Nürnberg), Faz 0 kurulumu 18.07.2026 (galzura-brain
 * `rota-motoru-osrm-vroom.md`): Docker, ikisi de YALNIZ localhost.
 *   · OSRM v26.7.3, MLD, car profili, 127.0.0.1:5000 — veri Geofabrik
 *     Avusturya, OSM zaman damgası 2026-07-16T20:21:30Z
 *   · VROOM v1.13.0 (vroom-express), 127.0.0.1:3000, OSRM'e konteyner adıyla
 * Panel (Vercel) bu adreslere doğrudan ULAŞAMAZ. Erişim, takograf servisinin
 * deseniyle: Fleet tüneli (`galzura-fleet`) + kimlik doğrulayan küçük vekil
 * (`servis/rota-vekil/`). Panel tarafında iki adres + bir sır:
 *   ROTA_VROOM_URL=https://rota.galzura.com/vroom
 *   ROTA_OSRM_URL=https://rota.galzura.com/osrm
 *   ROTA_SERVIS_SIRRI=<vekilin sırrı>
 *
 * ═══ MALİYET ═══
 * Çağrı başına dış maliyet YOK (kendi sunucu, açık kaynak). `maliyetUsd` 0.
 *
 * ═══ LİSANS ═══
 * Yol verisi OpenStreetMap (ODbL) — sonuç her haritada çizilebilir, atıf
 * şartıyla ("© OpenStreetMap katkıcıları"; harita tabanı zaten basıyor, liste
 * görünümü ayrıca yazıyor).
 */

export type VroomAyari = {
  vroomUrl: string;
  osrmUrl: string;
  /** Vekilin Bearer sırrı — yerel (loopback) denemede boş olabilir. */
  sir: string | null;
};

const VROOM_ZAMAN_ASIMI_MS = 30_000;
const OSRM_ZAMAN_ASIMI_MS = 15_000;

/** [boylam, enlem] — VROOM ve OSRM ikisi de bu sırayı ister. */
const lonLat = (k: Konum): [number, number] => [
  Number(k.lng.toFixed(6)),
  Number(k.lat.toFixed(6)),
];

/** VROOM istek gövdesi — SAF (testler doğrudan denetliyor). */
export function vroomIstegi(p: SiralamaProblemi) {
  const ufuk = Math.round(p.hareketSn + UFUK_SN);
  return {
    vehicles: [
      {
        id: 1,
        profile: "car",
        start: lonLat(p.baslangic),
        ...(p.bitis ? { end: lonLat(p.bitis) } : {}),
        // Araç hareket saatinden ÖNCE yola çıkamaz; üst sınır geniş — günü
        // aşan bir tur sessizce durak düşürmesin.
        time_window: [Math.round(p.hareketSn), ufuk],
      },
    ],
    jobs: p.duraklar.map((d, i) => ({
      id: i + 1,
      location: lonLat(d.konum),
      service: Math.max(0, Math.round(d.servisSn)),
      ...(d.pencere
        ? {
            time_windows: [
              [
                Math.max(0, Math.round(d.pencere.bas ?? 0)),
                Math.round(d.pencere.bit ?? ufuk),
              ],
            ],
          }
        : {}),
    })),
    options: { g: false },
  };
}

type VroomCevap = {
  code?: number;
  error?: string;
  routes?: { steps?: { type?: string; id?: number }[] }[];
  unassigned?: { id?: number }[];
};

/** VROOM cevabı → sıra. SAF. */
export function vroomCevabi(p: SiralamaProblemi, j: VroomCevap): SiralamaCevabi {
  if (j.code !== 0) {
    // vroom-express kodları: 1 iç hata, 2 girdi hatası, 3 yönlendirme hatası.
    const tur = j.code === 2 ? "reddedildi" : "erisilemedi";
    throw new SaglayiciHatasi(tur, `vroom code=${j.code ?? "?"} ${(j.error ?? "").slice(0, 160)}`);
  }
  const idOf = (n: number | undefined) => {
    const d = typeof n === "number" ? p.duraklar[n - 1] : undefined;
    if (!d) throw new SaglayiciHatasi("gecersiz_cevap", `vroom bilinmeyen iş id=${n}`);
    return d.id;
  };
  const adimlar = j.routes?.[0]?.steps ?? [];
  return {
    sira: adimlar.filter((s) => s.type === "job").map((s) => idOf(s.id)),
    atanamayan: (j.unassigned ?? []).map((u) => idOf(u.id)),
  };
}

type OsrmCevap = {
  code?: string;
  message?: string;
  routes?: { legs?: { distance?: number; duration?: number }[]; geometry?: string }[];
  waypoints?: { distance?: number }[];
};

/** OSRM /route cevabı → yol hesabı. SAF. */
export function osrmCevabi(noktaSayisi: number, j: OsrmCevap): RotaHesabi {
  if (j.code !== "Ok") {
    // NoRoute / NoSegment / InvalidQuery … — girdi bu haritada yürünemez.
    throw new SaglayiciHatasi("reddedildi", `osrm ${j.code ?? "?"} ${(j.message ?? "").slice(0, 160)}`);
  }
  const rota = j.routes?.[0];
  const bacaklar = (rota?.legs ?? []).map((l) => ({
    mesafeM: Number(l.distance ?? 0),
    sureSn: Number(l.duration ?? 0),
  }));
  if (bacaklar.length !== noktaSayisi - 1) {
    throw new SaglayiciHatasi(
      "gecersiz_cevap",
      `osrm ${bacaklar.length} bacak döndü, beklenen ${noktaSayisi - 1}`
    );
  }
  const yapisma = (j.waypoints ?? []).map((w) =>
    typeof w.distance === "number" ? w.distance : null
  );
  return {
    bacaklar,
    geometri: typeof rota?.geometry === "string" ? rota.geometry : null,
    yapismaM: yapisma.length === noktaSayisi ? yapisma : null,
    istekSayisi: 1,
  };
}

/**
 * HTTP — iki başarısızlık türü AYRI (takograf istemcisinin dersi):
 * ulaşılamayan servis yedeğe devredilebilir; reddedilen girdi devredilemez.
 */
async function istek(
  url: string,
  init: RequestInit,
  sir: string | null,
  zamanAsimiMs: number
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        ...(sir ? { Authorization: `Bearer ${sir}` } : {}),
      },
      signal: AbortSignal.timeout(zamanAsimiMs),
      cache: "no-store",
    });
  } catch (e) {
    throw new SaglayiciHatasi("erisilemedi", String((e as Error)?.message ?? e).slice(0, 160));
  }
  if (res.status === 401 || res.status === 403) {
    throw new SaglayiciHatasi("yetkisiz", `HTTP ${res.status}`);
  }
  let govde: unknown = null;
  try {
    govde = await res.json();
  } catch {
    // 5xx'in gövdesi çoğu zaman HTML; aşağıdaki durum koduna göre ayrılıyor.
  }
  if (res.status >= 500) throw new SaglayiciHatasi("erisilemedi", `HTTP ${res.status}`);
  // OSRM ve vroom-express girdi hatasında 400 + JSON döner; JSON'u
  // ayrıştırıcıya bırakmak hata kodunu (NoRoute, code=2) korur.
  if (govde === null) {
    throw new SaglayiciHatasi(
      res.ok ? "gecersiz_cevap" : "reddedildi",
      `HTTP ${res.status}, gövde JSON değil`
    );
  }
  return govde;
}

/** Teşhis ucunun tek ölçümü — yalnız durum kodu, süre ve motorun kendi kodu. */
export type TeshisOlcumu = {
  kod: number | null;
  ms: number;
  motor?: number | string | null;
  km?: number | null;
};

/** `app/api/rota/saglik` cevabı. Sır, adres, kullanıcı verisi GİRMEZ. */
export type RotaTeshisi = {
  saglik: TeshisOlcumu;
  sirsiz: TeshisOlcumu;
  vroom: TeshisOlcumu;
  osrm: TeshisOlcumu;
};

const TESHIS_ZAMAN_ASIMI_MS = 15_000;
/** Sabit test noktaları (Dornbirn → Bregenz, Lustenau) — kullanıcı verisi değil. */
const TESHIS_PROBLEMI = JSON.stringify({
  vehicles: [{ id: 1, profile: "car", start: [9.7417, 47.4125] }],
  jobs: [
    { id: 1, location: [9.7471, 47.5031] },
    { id: 2, location: [9.6589, 47.4268] },
  ],
});
const TESHIS_ROTASI = "9.7417,47.4125;9.7471,47.5031";

/** Ham ölçüm: istek() gibi hata FIRLATMAZ — 401 de ölçümün parçası. */
async function olc(
  url: string,
  init: RequestInit,
  sir: string | null
): Promise<{ kod: number | null; ms: number; govde: unknown }> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        ...(sir ? { Authorization: `Bearer ${sir}` } : {}),
      },
      signal: AbortSignal.timeout(TESHIS_ZAMAN_ASIMI_MS),
      cache: "no-store",
    });
    let govde: unknown = null;
    try {
      govde = await res.json();
    } catch {
      // gövde JSON değil (401'in gövdesi önemsiz)
    }
    return { kod: res.status, ms: Math.round(performance.now() - t0), govde };
  } catch {
    return { kod: null, ms: Math.round(performance.now() - t0), govde: null };
  }
}

export class VroomSaglayici implements RotaOptimizasyonSaglayici {
  readonly kod = "vroom" as const;
  readonly ad = "VROOM + OSRM";
  readonly haritaSerbest = true;

  private readonly ayar: VroomAyari;

  constructor(ayar: VroomAyari) {
    this.ayar = ayar;
  }

  async sirala(p: SiralamaProblemi): Promise<SiralamaCevabi> {
    if (p.duraklar.length === 0) return { sira: [], atanamayan: [] };
    const j = (await istek(
      this.ayar.vroomUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vroomIstegi(p)),
      },
      this.ayar.sir,
      VROOM_ZAMAN_ASIMI_MS
    )) as VroomCevap;
    return vroomCevabi(p, j);
  }

  async rotaHesapla(noktalar: Konum[]): Promise<RotaHesabi> {
    if (noktalar.length < 2) {
      return { bacaklar: [], geometri: null, yapismaM: null, istekSayisi: 0 };
    }
    const koordinat = noktalar.map((k) => lonLat(k).join(",")).join(";");
    const url =
      `${this.ayar.osrmUrl.replace(/\/+$/, "")}/route/v1/driving/${koordinat}` +
      "?overview=simplified&geometries=polyline&steps=false&annotations=false";
    const j = (await istek(url, { method: "GET" }, this.ayar.sir, OSRM_ZAMAN_ASIMI_MS)) as OsrmCevap;
    return osrmCevabi(noktalar.length, j);
  }

  maliyetUsd(): number {
    return 0;
  }

  /**
   * TEŞHİS — panelden motora uçtan uca yol (vekil + tünel) girişsiz ölçülsün
   * diye (`app/api/rota/saglik`, yalnız önizleme). Dört ölçüm: vekil sağlığı,
   * sırsız istek (401 beklenir), sırlı VROOM, sırlı OSRM. Cevaba yalnız durum
   * kodu, süre ve motorun kodu girer — sır ve adres GİRMEZ.
   */
  async teshis(): Promise<RotaTeshisi> {
    const kok = new URL(this.ayar.vroomUrl).origin;
    const post: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: TESHIS_PROBLEMI,
    };
    const osrmUrl =
      `${this.ayar.osrmUrl.replace(/\/+$/, "")}/route/v1/driving/${TESHIS_ROTASI}?overview=false`;
    const saglik = await olc(`${kok}/health`, { method: "GET" }, null);
    const sirsiz = await olc(this.ayar.vroomUrl, post, null);
    const vroom = await olc(this.ayar.vroomUrl, post, this.ayar.sir);
    const osrm = await olc(osrmUrl, { method: "GET" }, this.ayar.sir);
    const v = vroom.govde as { code?: number } | null;
    const o = osrm.govde as { code?: string; routes?: { distance?: number }[] } | null;
    const metre = o?.routes?.[0]?.distance;
    return {
      saglik: { kod: saglik.kod, ms: saglik.ms },
      sirsiz: { kod: sirsiz.kod, ms: sirsiz.ms },
      vroom: { kod: vroom.kod, ms: vroom.ms, motor: v?.code ?? null },
      osrm: {
        kod: osrm.kod,
        ms: osrm.ms,
        motor: o?.code ?? null,
        km: typeof metre === "number" ? Math.round(metre / 100) / 10 : null,
      },
    };
  }
}
