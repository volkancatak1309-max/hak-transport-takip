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
 * v1'in (`lib/asistan-araclar.ts`) iki ilkesi AYNEN geçerli; gerekçeler orada:
 *   1) her araç ilgili mobil ucun `GET`ini SÜREÇ İÇİNDE, kullanıcının yetki başlığıyla
 *      çağırır → kapı ve kapsam ucun kendisinden gelir (filo şefi yalnız kendi filosu);
 *   2) YAZMA YOK: yalnız `GET` işleyicileri içe aktarılır, `supabaseAdmin` hiç.
 *
 * ⚠️ v1'in "aritmetik yok" ilkesi burada BİLİNÇLİ olarak gevşedi (Faz 1b, Volkan):
 * 03.10 testinde "Bugün kaç araç yolda?" cevapsız kaldı — istem "hesap yapma" diyordu,
 * araç da sayıyı vermiyordu. Artık her araç kısa bir `ozet` döndürür. Kural: özet,
 * uygulamada aynı sayıyı gösteren ekranın KURALIYLA sayılır (araçlar için mobil
 * haritanın şeridi, `galzura-fleet-app/lib/map-api.ts` `countVehicles`), yeni bir
 * tanım uydurulmaz; bir sayı ölçülemiyorsa `null` kalır.
 *
 * Görev tanımının başlangıç seti (8 araç). Üçü v1'den alındı (sürücü sıralaması, açık
 * iş emirleri, çalışma süresi uyarıları) ve v1'e dokunmadan bir `ozet` ile sarıldı;
 * beşi sesli kullanım için yeni: plakayla çalışır, tek çağrıda cevap verir, kısa tutar.
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

/** Bir dizideki değerlerin sayımı: `{ tamamlandi: 2, yolda: 1 }`. Yalnız SAYMA. */
function say(degerler: unknown[]): Record<string, number> {
  const sayim: Record<string, number> = {};
  for (const d of degerler) {
    const k = String(d ?? "bilinmiyor");
    sayim[k] = (sayim[k] ?? 0) + 1;
  }
  return sayim;
}

// ── yeni araçlar ─────────────────────────────────────────────────────────────

/**
 * Haritadaki "Yolda / Duruyor / Sinyal yok" şeridinin KURALI — mobil
 * `lib/map-api.ts` (`SIGNAL_STALE_MS`, `STATUS_EN_ROUTE`, `toneFor`, `countVehicles`):
 *  • son sinyal ≥ 2 sa eski → sinyal yok (konumu eski aracı "yolda" saymak yanlış olurdu);
 *  • değilse sunucunun canlı durumu `sevkiyatta` → yolda (vardiyası açık, molada değil);
 *  • geri kalan (`molada`, `bosta`, `bakimda`) → duruyor.
 * "Yolda" HIZDAN değil vardiyadan türüyor — anlık hız ayrıca `hizKmh` alanında.
 */
const SINYAL_YOK_MS = 2 * 60 * 60 * 1000;
const YOLDA_DURUMU = "sevkiyatta";

function hareketDurumu(a: Govde): "yolda" | "duruyor" | "sinyal_yok" {
  const yas = typeof a.sonSinyalMs === "number" ? a.sonSinyalMs : undefined;
  if (yas !== undefined && yas >= SINYAL_YOK_MS) return "sinyal_yok";
  return a.durum === YOLDA_DURUMU ? "yolda" : "duruyor";
}

const aracListesi: AsistanArac = {
  ad: "arac_listesi",
  kapi: "filo",
  uc: "/api/mobile/map",
  aciklama: [
    "Vehicles the caller can see with live status. `ozet` holds the counts for the whole fleet,",
    "counted exactly like the app's map strip: yolda = on the road (driver on an active shift, not",
    "on a break), duruyor = stopped (break, idle or maintenance), sinyal_yok = no signal for 2+",
    "hours; plus total vehicles and vehicles with a known position. Each row: plate, hareket",
    "(yolda/duruyor/sinyal_yok), live status, driver, speed in km/h, ignition, minutes since the",
    "last signal and latitude/longitude. Use for 'how many vehicles are on the road', 'where is",
    "W-GF-113', 'is it moving'. Coordinates cannot be turned into an address. Optional filters:",
    "plaka (any part of a plate) and hareket.",
  ].join(" "),
  sema: {
    type: "object",
    properties: {
      plaka: { type: "string", description: "Any part of a licence plate, e.g. 113 or W-GF-113." },
      hareket: {
        type: "string",
        enum: ["yolda", "duruyor", "sinyal_yok"],
        description: "Only list vehicles in this state. The summary always covers the whole fleet.",
      },
    },
    additionalProperties: false,
  },
  async calistir(girdi, ctx) {
    const r = await coz(await haritaUc(istek(ctx, "/api/mobile/map", {})));
    if (!r.ok) return r.hata;
    const araclar = dizi(r.veri.araclar).map((a): Govde => ({ ...a, hareket: hareketDurumu(a) }));
    const sayim = (r.veri.sayim ?? {}) as Govde;
    const hareketler = say(araclar.map((a) => a.hareket));
    const p = plakaAnahtari(girdi.plaka);
    const satirlar = araclar.filter(
      (a) => (!p || plakaAnahtari(a.plaka).includes(p)) && (!girdi.hareket || a.hareket === girdi.hareket)
    );
    return {
      ozet: {
        toplamArac: sayim.toplamArac ?? null,
        konumuBilinen: sayim.konumlu ?? null,
        yolda: hareketler.yolda ?? 0,
        duruyor: hareketler.duruyor ?? 0,
        sinyalYok: hareketler.sinyal_yok ?? 0,
      },
      olcumAni: r.veri.olcumAni,
      ...kes(satirlar, 40, (s) => ({
        ...alanlar(s, ["id", "plaka", "hareket", "durum", "sofor", "hizKmh", "kontak", "konum"]),
        sinyalYasiDk: typeof s.sonSinyalMs === "number" ? Math.round(s.sonSinyalMs / 60000) : null,
      })),
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
    "Trips planned for a day (default: today in the company time zone). `ozet` holds the number",
    "of trips and their counts per status (atandi = assigned, kabul = accepted, yolda = under way,",
    "tamamlandi = completed, iptal = cancelled). Each row: driver name, vehicle plate, status,",
    "next stop name, stops done/total, package target and actual, notes, and the ordered stop list",
    "(sequence, name, address, status, time window, arrival time). Use for 'what trips are there",
    "today', 'which stop is next for X'. Admin only.",
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
      ozet: { seferSayisi: seferler.length, durumlar: say(seferler.map((x) => x.durum)) },
      tarih: s.veri.tarih,
      kapsam: s.veri.kapsam,
      satirlar: ilk.map((x, i) => {
        const d = durakSonuclari[i];
        const durakOzeti = (x.duraklar ?? {}) as Govde;
        return {
          sofor: adlar.get(String(x.soforId)) ?? null,
          plaka: plakalar.get(String(x.aracId)) ?? null,
          durum: x.durum,
          siradakiDurak: ((durakOzeti.sonraki ?? null) as Govde | null)?.ad ?? null,
          durakBiten: durakOzeti.biten ?? null,
          durakToplam: durakOzeti.toplam ?? null,
          acik: x.acik,
          paketHedef: x.paketHedef,
          paketGerceklesen: x.paketGerceklesen,
          notlar: x.notlar ?? null,
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
    "The action centre: what needs the manager's attention right now. `ozet` holds the counts:",
    "attention items in total, leave requests waiting for approval, open and critical alarms (null",
    "when not available to this account), vehicles with active fault codes, snoozed items. The",
    "attention list itself (expiring inspections, insurance, licences and documents, silent",
    "vehicles, working-time over-limit shifts, open work orders, due maintenance) follows with",
    "per-type counts. Use for 'what needs my attention', 'anything urgent'. Takes no arguments.",
  ].join(" "),
  sema: { type: "object", properties: {}, additionalProperties: false },
  async calistir(_girdi, ctx) {
    const r = await coz(await panoUc(istek(ctx, "/api/mobile/dashboard", {})));
    if (!r.ok) return r.hata;
    const v = r.veri;
    const uyari = (v.uyari ?? {}) as Govde;
    const alarm = (v.alarm ?? null) as Govde | null;
    return {
      // Uçtaki sayılar AYNEN: dikkat listesi toplamı, onay bekleyen izin, alarm (yalnız patrona
      // dolu gelir; diğer yöneticide null = "ölçülmedi", sıfır değil).
      ozet: {
        dikkatToplam: uyari.toplam ?? null,
        onayBekleyenIzin: ((v.onayBekleyen ?? {}) as Govde).izin ?? null,
        acikAlarm: alarm?.acik ?? null,
        kritikAlarm: alarm?.kritik ?? null,
        arizaKoduOlanArac: v.dtcAracSayisi ?? null,
        ertelenen: v.ertelemeToplam ?? null,
      },
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
    "Who is on leave on a given day (default: today). `ozet`: how many people, how many approved",
    "and how many pending. Rows: name, leave type with its label, start and end date and status",
    "(approved, or pending — pending IS included and marked). Rejected leave is never returned.",
    "Use for 'who is off today', 'is X on leave'.",
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
    const durumlar = say(oGun.map((l) => l.durum));
    return {
      ozet: { izinliSayisi: oGun.length, onayli: durumlar.approved ?? 0, bekleyen: durumlar.pending ?? 0 },
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

// ── v1 araçları + özet (v1 koduna dokunulmaz; sonuç sarılır) ───────────────────

/** v1 aracını olduğu gibi çalıştırır, başarılı sonucun başına `ozet` koyar. Hata aynen geçer. */
function ozetli(ad: string, ekAciklama: string, ozetle: (sonuc: Govde) => Govde): AsistanArac {
  const temel = v1(ad);
  return {
    ...temel,
    aciklama: `${temel.aciklama} ${ekAciklama}`,
    async calistir(girdi, ctx) {
      const sonuc = (await temel.calistir(girdi, ctx)) as Govde | null;
      if (!sonuc || typeof sonuc !== "object" || "hata" in sonuc) return sonuc;
      return { ozet: ozetle(sonuc), ...sonuc };
    },
  };
}

const isEmirleri = ozetli(
  "is_emirleri",
  "`ozet`: total matching orders and, when the list is complete, counts per priority (dusuk, normal, yuksek, kritik).",
  (s) => {
    const satirlar = dizi(s.satirlar);
    return {
      toplam: ((s.sayfa ?? {}) as Govde).total ?? null,
      oncelikler: s.kirpildi ? null : say(satirlar.map((x) => x.oncelik)),
    };
  }
);

const soforSkorlari = ozetli(
  "sofor_skorlari",
  "`ozet`: average score, how many drivers were scored, and the first and last scored driver in the ranking.",
  (s) => {
    const skor = (s.skor ?? {}) as Govde;
    const skorlu = dizi(s.satirlar).filter((x) => typeof x.guvenlikSkoru === "number");
    const kisa = (x: Govde | undefined) => (x ? { ad: x.adSoyad ?? null, skor: x.guvenlikSkoru } : null);
    return {
      ortalamaSkor: skor.ortalama ?? null,
      skorlanan: skor.skorlanan ?? null,
      soforSayisi: skor.soforSayisi ?? null,
      siralamadaIlk: kisa(skorlu[0]),
      siralamadaSon: skorlu.length > 1 ? kisa(skorlu[skorlu.length - 1]) : null,
    };
  }
);

const mevzuatPanosu = ozetli(
  "mevzuat_panosu",
  "`ozet`: people on shift right now (when the list is complete) and the number of warnings in the ledger window.",
  (s) => {
    const canli = (s.canli ?? {}) as Govde;
    const uyarilar = (s.uyarilar ?? {}) as Govde;
    return {
      suAnVardiyada: canli.kirpildi ? null : dizi(canli.satirlar).length,
      uyariSayisi: ((uyarilar.sayfa ?? {}) as Govde).total ?? null,
      pencereGun: uyarilar.pencereGun ?? null,
    };
  }
);

/**
 * Modele verilen liste — SIRA SABİT (ön ek önbelleği sıraya duyarlı). Yalnız bu
 * adlar çalışır; `/api/asistan/arac` başka bir adı 400 ile reddeder.
 */
export const SESLI_ARACLAR: readonly AsistanArac[] = [
  aracListesi,
  aracDetayi,
  bugununSeferleri,
  aksiyonMerkezi,
  isEmirleri,
  bugunIzinliler,
  soforSkorlari,
  mevzuatPanosu,
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
