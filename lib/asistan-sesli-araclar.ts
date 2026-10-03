import "server-only";
import { NextRequest } from "next/server";
import { ARACLAR, type AsistanArac, type AsistanBaglam } from "@/lib/asistan-araclar";
import type { OpenAiArac } from "@/lib/asistan-sesli";
import { todayYmdVienna } from "@/lib/leaves";

import { GET as haritaUc } from "@/app/api/mobile/map/route";
import { GET as aracListeUc } from "@/app/api/mobile/vehicles/route";
import { GET as aracOzetUc } from "@/app/api/mobile/vehicles/[id]/ozet/route";
import { GET as seferUc } from "@/app/api/mobile/sefer/route";
import { GET as durakUc } from "@/app/api/mobile/sefer/[id]/duraklar/route";
import { GET as personelUc } from "@/app/api/mobile/workers/route";
import { GET as panoUc } from "@/app/api/mobile/dashboard/route";
import { GET as izinUc } from "@/app/api/mobile/leaves/route";

/**
 * SESLİ ASİSTAN — ARAÇ LİSTESİ (Faz 1 web prototipi, 03.10.2026). SALT OKUMA.
 *
 * v1'in (`lib/asistan-araclar.ts`) üç ilkesi AYNEN geçerli; gerekçeler orada:
 *   1) her araç ilgili mobil ucun `GET`ini SÜREÇ İÇİNDE, kullanıcının yetki başlığıyla
 *      çağırır → kapı ve kapsam ucun kendisinden gelir (filo şefi yalnız kendi filosu);
 *   2) daraltma yalnız SEÇMEDİR: alan seç/at, listeyi kes + `kirpildi`. Aritmetik yok —
 *      söylenen her sayı bir ekranda da duran sayıdır;
 *   3) YAZMA YOK: yalnız `GET` işleyicileri içe aktarılır, `supabaseAdmin` hiç.
 *
 * Görev tanımının başlangıç seti (8 araç). Üçü v1'den olduğu gibi alındı (sürücü
 * sıralaması, açık iş emirleri, çalışma süresi uyarıları); beşi sesli kullanım için
 * yeni: plakayla çalışır, tek çağrıda cevap verir, cevabı küçük tutar.
 */

type Govde = Record<string, unknown>;

function istek(ctx: AsistanBaglam, yol: string, sorgu: Record<string, unknown>): NextRequest {
  const url = new URL(yol, ctx.taban);
  for (const [k, v] of Object.entries(sorgu)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return new NextRequest(url, { headers: { authorization: ctx.yetkiBasligi } });
}

/**
 * Uç yanıtını çözer. v1'den farkı: bazı uçlar (`/sefer`) gövdeye `ok` yazmıyor, bu
 * yüzden başarı HTTP durumundan okunur; `ok:false` yazan gövde yine hatadır.
 * ⚠️ HATA YUTULMAZ — model 403/404/503'ü olduğu gibi görür (v1 `coz` notu).
 */
async function coz(res: Response): Promise<{ ok: true; veri: Govde } | { ok: false; hata: Govde }> {
  let json: Govde | null = null;
  try {
    json = (await res.json()) as Govde;
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.ok === false) {
    return {
      ok: false,
      hata: {
        hata: (json?.error as string) ?? "uc_cevabi_okunamadi",
        durum: res.status,
        ...(json?.sebep !== undefined ? { sebep: json.sebep } : {}),
        ...(json?.alan !== undefined ? { alan: json.alan } : {}),
      },
    };
  }
  return { ok: true, veri: json };
}

function alanlar(nesne: Govde, alinacak: readonly string[]): Govde {
  const cikti: Govde = {};
  for (const k of alinacak) if (nesne[k] !== undefined) cikti[k] = nesne[k];
  return cikti;
}

function alanlariAt(nesne: Govde, atilacak: readonly string[]): Govde {
  const cikti: Govde = {};
  for (const [k, v] of Object.entries(nesne)) if (!atilacak.includes(k)) cikti[k] = v;
  return cikti;
}

const dizi = (v: unknown): Govde[] => (Array.isArray(v) ? (v as Govde[]) : []);

/** Listeyi keser ve kesildiyse SÖYLER (`kirpildi`). */
function kes(satirlar: Govde[], tavan: number, donustur: (s: Govde) => Govde) {
  return {
    satirlar: satirlar.slice(0, tavan).map(donustur),
    satirTavani: tavan,
    kirpildi: satirlar.length > tavan,
  };
}

/** Konuşulan plaka ile kayıttaki plakayı karşılaştırmak için: büyük harf, yalnız A-Z0-9. */
const plakaAnahtari = (p: unknown): string => String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const TARIH = /^\d{4}-\d{2}-\d{2}$/;

const DONEM_SEMA = {
  donem: {
    type: "string",
    enum: ["gun", "hafta", "ay"],
    description: "Sliding window: gun = 1 day, hafta = 7 days, ay = 30 days. Default: hafta.",
  },
  tarih: {
    type: "string",
    description: "YYYY-MM-DD. Anchors the window so this date is its LAST day. Omit for a window ending today.",
  },
} as const;

function v1(ad: string): AsistanArac {
  const arac = ARACLAR.find((a) => a.ad === ad);
  if (!arac) throw new Error(`v1 aracı yok: ${ad}`);
  return arac;
}

// ── yeni araçlar ─────────────────────────────────────────────────────────────

const aracListesi: AsistanArac = {
  ad: "arac_listesi",
  kapi: "filo",
  uc: "/api/mobile/map",
  aciklama: [
    "All vehicles the caller can see with their latest known position and live status: plate,",
    "live status, driver, speed in km/h, ignition on/off, the time of the last signal (ISO) and",
    "latitude/longitude. Use for 'where is W-GF-113', 'which vehicles are on the road', 'is it",
    "moving'. You cannot turn coordinates into an address; give the last signal time instead.",
    "Optional filters: plaka (any part of a plate) and durum (live status exactly as returned).",
  ].join(" "),
  sema: {
    type: "object",
    properties: {
      plaka: { type: "string", description: "Any part of a licence plate, e.g. 113 or W-GF-113." },
      durum: { type: "string", description: "Live status filter, exactly as returned in durum." },
    },
    additionalProperties: false,
  },
  async calistir(girdi, ctx) {
    const r = await coz(await haritaUc(istek(ctx, "/api/mobile/map", {})));
    if (!r.ok) return r.hata;
    const p = plakaAnahtari(girdi.plaka);
    const satirlar = dizi(r.veri.araclar).filter(
      (a) => (!p || plakaAnahtari(a.plaka).includes(p)) && (!girdi.durum || a.durum === girdi.durum)
    );
    return {
      olcumAni: r.veri.olcumAni,
      sayim: r.veri.sayim,
      ...kes(satirlar, 40, (s) =>
        alanlar(s, ["id", "plaka", "durum", "sofor", "soforCanli", "hizKmh", "kontak", "sonSinyal", "konum"])
      ),
    };
  },
};

const aracDetayi: AsistanArac = {
  ad: "arac_detayi",
  kapi: "yonetici",
  uc: "/api/mobile/vehicles + /api/mobile/vehicles/[id]/ozet",
  aciklama: [
    "One vehicle by licence plate: its record (make, model, year, fleet, status, live status,",
    "driver, inspection and insurance due dates) plus its figures for a window: km (with the axis",
    "it came from), shift count, packages, idle time and fuel. Every metric is a number or null",
    "WITH a reason in `sebepler` — null never means zero. If the plate is unknown or ambiguous the",
    "result lists candidate plates; ask the user which one. Admin only.",
  ].join(" "),
  sema: {
    type: "object",
    properties: {
      plaka: { type: "string", description: "Licence plate as heard, e.g. W-GF-113 or just 113." },
      ...DONEM_SEMA,
    },
    required: ["plaka"],
    additionalProperties: false,
  },
  async calistir(girdi, ctx) {
    const liste = await coz(await aracListeUc(istek(ctx, "/api/mobile/vehicles", { limit: 200 })));
    if (!liste.ok) return liste.hata;
    const araclar = dizi(liste.veri.araclar);
    const p = plakaAnahtari(girdi.plaka);
    const tam = araclar.filter((a) => plakaAnahtari(a.plaka) === p);
    const aday = tam.length > 0 ? tam : araclar.filter((a) => p !== "" && plakaAnahtari(a.plaka).includes(p));
    if (aday.length !== 1) {
      return {
        hata: aday.length === 0 ? "arac_bulunamadi" : "plaka_belirsiz",
        adaylar: aday.slice(0, 8).map((a) => a.plaka),
      };
    }
    const arac = aday[0];
    const id = String(arac.id);
    const ozet = await coz(
      await aracOzetUc(
        istek(ctx, `/api/mobile/vehicles/${encodeURIComponent(id)}/ozet`, {
          donem: girdi.donem,
          tarih: girdi.tarih,
        }),
        { params: Promise.resolve({ id }) }
      )
    );
    return {
      arac: alanlar(arac, [
        "plaka",
        "marka",
        "model",
        "yil",
        "filoEtiketi",
        "durum",
        "canliDurum",
        "sofor",
        "muayeneSon",
        "sigortaSon",
      ]),
      ozet: ozet.ok ? alanlariAt(ozet.veri, ["ok", "aracId"]) : ozet.hata,
    };
  },
};

const SEFER_TAVANI = 10;

const bugununSeferleri: AsistanArac = {
  ad: "bugunun_seferleri",
  kapi: "yonetici",
  uc: "/api/mobile/sefer + /api/mobile/sefer/[id]/duraklar",
  aciklama: [
    "Trips planned for a day (default: today in the company time zone): driver name, vehicle",
    "plate, trip status, package target and actual, notes, a stop summary (total, done, waiting,",
    "next stop) and the ordered stop list (sequence, name, address, status, time window, arrival",
    "time). Use for 'what trips are there today', 'which stop is next for X'. Admin only.",
  ].join(" "),
  sema: {
    type: "object",
    properties: { tarih: { type: "string", description: "YYYY-MM-DD. Default: today." } },
    additionalProperties: false,
  },
  async calistir(girdi, ctx) {
    if (girdi.tarih !== undefined && !TARIH.test(String(girdi.tarih))) {
      return { hata: "gecersiz_arguman", alan: "tarih", bicim: "YYYY-MM-DD" };
    }
    const s = await coz(await seferUc(istek(ctx, "/api/mobile/sefer", { tarih: girdi.tarih })));
    if (!s.ok) return s.hata;
    const seferler = dizi(s.veri.seferler);
    const ilk = seferler.slice(0, SEFER_TAVANI);
    const [personel, filo, durakSonuclari] = await Promise.all([
      personelUc(istek(ctx, "/api/mobile/workers", { aktif: "all", limit: 200 })).then(coz),
      aracListeUc(istek(ctx, "/api/mobile/vehicles", { limit: 200 })).then(coz),
      Promise.all(
        ilk.map((x) => {
          const id = String(x.id);
          return durakUc(istek(ctx, `/api/mobile/sefer/${encodeURIComponent(id)}/duraklar`, {}), {
            params: Promise.resolve({ id }),
          }).then(coz);
        })
      ),
    ]);
    const adlar = new Map(personel.ok ? dizi(personel.veri.personel).map((w) => [String(w.id), w.adSoyad]) : []);
    const plakalar = new Map(filo.ok ? dizi(filo.veri.araclar).map((a) => [String(a.id), a.plaka]) : []);
    return {
      tarih: s.veri.tarih,
      kapsam: s.veri.kapsam,
      satirlar: ilk.map((x, i) => {
        const d = durakSonuclari[i];
        return {
          sofor: adlar.get(String(x.soforId)) ?? null,
          plaka: plakalar.get(String(x.aracId)) ?? null,
          durum: x.durum,
          acik: x.acik,
          paketHedef: x.paketHedef,
          paketGerceklesen: x.paketGerceklesen,
          notlar: x.notlar ?? null,
          durakOzeti: x.duraklar,
          duraklar: d.ok
            ? kes(dizi(d.veri.duraklar), 12, (y) => ({
                ...alanlar(y, ["sira", "ad", "adres", "durum", "pencere"]),
                varildi: ((y.damgalar ?? {}) as Govde).varildi ?? null,
              }))
            : d.hata,
        };
      }),
      satirTavani: SEFER_TAVANI,
      kirpildi: seferler.length > SEFER_TAVANI,
    };
  },
};

const aksiyonMerkezi: AsistanArac = {
  ad: "aksiyon_merkezi",
  kapi: "filo",
  uc: "/api/mobile/dashboard",
  aciklama: [
    "The action centre: what needs the manager's attention right now — the attention list",
    "(expiring inspections, insurance, licences and documents, silent vehicles, working-time",
    "over-limit shifts, open work orders, due maintenance) with its total and per-type counts,",
    "leave requests waiting for approval, today's alarm summary, the number of vehicles with",
    "active fault codes and the number of snoozed items. Use for 'what needs my attention',",
    "'anything urgent'. Takes no arguments.",
  ].join(" "),
  sema: { type: "object", properties: {}, additionalProperties: false },
  async calistir(_girdi, ctx) {
    const r = await coz(await panoUc(istek(ctx, "/api/mobile/dashboard", {})));
    if (!r.ok) return r.hata;
    const v = r.veri;
    const uyari = (v.uyari ?? {}) as Govde;
    return {
      kapsam: v.kapsam,
      uyari: {
        toplam: uyari.toplam,
        tur: uyari.tur,
        ...kes(dizi(uyari.kalemler), 25, (s) => alanlariAt(s, ["id", "hedef", "vardiyaId"])),
      },
      onay_bekleyen_izin: ((v.onayBekleyen ?? {}) as Govde).izin,
      alarm: v.alarm,
      dtc_arac_sayisi: v.dtcAracSayisi,
      etkin_erteleme_sayisi: v.ertelemeToplam,
    };
  },
};

const bugunIzinliler: AsistanArac = {
  ad: "bugun_izinliler",
  kapi: "filo",
  uc: "/api/mobile/leaves",
  aciklama: [
    "Who is on leave on a given day (default: today): name, leave type with its label, start and",
    "end date and status (approved, or pending — pending IS included and marked). Rejected leave",
    "is never returned. Use for 'who is off today', 'is X on leave'.",
  ].join(" "),
  sema: {
    type: "object",
    properties: { tarih: { type: "string", description: "YYYY-MM-DD. Default: today." } },
    additionalProperties: false,
  },
  async calistir(girdi, ctx) {
    if (girdi.tarih !== undefined && !TARIH.test(String(girdi.tarih))) {
      return { hata: "gecersiz_arguman", alan: "tarih", bicim: "YYYY-MM-DD" };
    }
    const tarih = typeof girdi.tarih === "string" ? girdi.tarih : todayYmdVienna();
    const r = await coz(await izinUc(istek(ctx, "/api/mobile/leaves", { ay: tarih.slice(0, 7) })));
    if (!r.ok) return r.hata;
    const v = r.veri;
    const adlar = new Map(dizi(v.kisiler).map((k) => [String(k.id), k.ad]));
    const etiketler = new Map(dizi(v.turler).map((t) => [String(t.anahtar), t.etiket]));
    const oGun = dizi(v.izinler).filter((l) => String(l.baslangic) <= tarih && tarih <= String(l.bitis));
    return {
      tarih,
      kapsam: v.kapsam,
      ...kes(oGun, 40, (l) => ({
        ad: adlar.get(String(l.personelId)) ?? null,
        tur: l.tur,
        turEtiketi: etiketler.get(String(l.tur)) ?? null,
        baslangic: l.baslangic,
        bitis: l.bitis,
        durum: l.durum,
      })),
    };
  },
};

/**
 * Modele verilen liste — SIRA SABİT (ön ek önbelleği sıraya duyarlı). Yalnız bu
 * adlar çalışır; `/api/asistan/arac` başka bir adı 400 ile reddeder.
 */
export const SESLI_ARACLAR: readonly AsistanArac[] = [
  aracListesi,
  aracDetayi,
  bugununSeferleri,
  aksiyonMerkezi,
  v1("is_emirleri"),
  bugunIzinliler,
  v1("sofor_skorlari"),
  v1("mevzuat_panosu"),
];

export function sesliAracBul(ad: string): AsistanArac | undefined {
  return SESLI_ARACLAR.find((a) => a.ad === ad);
}

/** OpenAI Realtime `tools` biçimi: `type: "function"`, `name`, `description`, `parameters`. */
export function sesliAracSemalari(): OpenAiArac[] {
  return SESLI_ARACLAR.map((a) => ({
    type: "function" as const,
    name: a.ad,
    description: a.aciklama,
    parameters: a.sema,
  }));
}
