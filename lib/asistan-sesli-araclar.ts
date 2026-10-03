import "server-only";
import { NextRequest } from "next/server";
import { ARACLAR, type AsistanArac, type AsistanBaglam } from "@/lib/asistan-araclar";
import { argumanCoz, type OpenAiArac } from "@/lib/asistan-sesli";
import { todayYmdVienna } from "@/lib/leaves";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { buildFuelReport, buildPerformanceReport } from "@/lib/reports";
import { SAFETY_SCORE_CALIBRATED } from "@/lib/tenant";
import { onbellekli, type OnbellekDurumu } from "@/lib/asistan-sesli-onbellek";
import {
  aksiyonOzeti,
  alanlar,
  alanlariAt,
  bir,
  bolgeListesi,
  dizi,
  gecmisGunOzeti,
  gunCoz as gunCozSaf,
  hareketDurumu,
  kes,
  plakaAnahtari,
  say,
  yerBul,
  type Govde,
  type Gun,
} from "@/lib/asistan-sesli-ozet";
import { donemCoz, donemGovdesi, performansSatiri, siraHaritasi } from "@/app/api/mobile/_performans/donem";

import { GET as haritaUc } from "@/app/api/mobile/map/route";
import { GET as bolgeUc } from "@/app/api/mobile/geofences/route";
import { GET as aracListeUc } from "@/app/api/mobile/vehicles/route";
import { GET as aracOzetUc } from "@/app/api/mobile/vehicles/[id]/ozet/route";
import { GET as vardiyaUc } from "@/app/api/mobile/shifts/route";
import { GET as seferUc } from "@/app/api/mobile/sefer/route";
import { GET as durakUc } from "@/app/api/mobile/sefer/[id]/duraklar/route";
import { GET as personelUc } from "@/app/api/mobile/workers/route";
import { GET as panoUc } from "@/app/api/mobile/dashboard/route";
import { GET as alarmUc } from "@/app/api/mobile/alarms/route";
import { GET as izinUc } from "@/app/api/mobile/leaves/route";

/**
 * SESLİ ASİSTAN — ARAÇ LİSTESİ (Faz 1 web prototipi, 03.10.2026; 1b özetler; 1c hız,
 * yer adı, tarihli sorular, yakıt). SALT OKUMA.
 *
 * v1'in (`lib/asistan-araclar.ts`) iki ilkesi AYNEN geçerli; gerekçeler orada:
 *   1) her araç ilgili mobil ucun `GET`ini SÜREÇ İÇİNDE, kullanıcının yetki başlığıyla
 *      çağırır → kapı ve kapsam ucun kendisinden gelir (filo şefi yalnız kendi filosu);
 *   2) YAZMA YOK: yalnız `GET` işleyicileri ve SALT OKUR rapor fonksiyonları içe
 *      aktarılır, `supabaseAdmin` hiç.
 *
 * ⚠️ İKİ BİLİNÇLİ İSTİSNA (Faz 1c): `sofor_skorlari` ve `yakit_verimliligi` uç yerine
 * panelin rapor fonksiyonunu (`buildPerformanceReport`, `buildFuelReport`) çağırır;
 * ÖNCE o raporların uçlarının kapısını (`requireMobileAdmin`) aynı istekle koşturur.
 *   • Sürücü skoru: `/driver-scores` sıralama değişimi için raporu İKİ KEZ kurar (önceki
 *     dönem) — sesli cevapta önceki dönem yok; tek rapor ≈ yarı süre (Test 2: 3,8 sn).
 *   • Yakıt: L/100 km yalnız Raporlar › Yakıt'ta var; mobilde JSON ucu yok (CSV/PDF var).
 * Sayılar aynı fonksiyondan geldiği için ekrandakiyle AYNI; ikinci bir tanım yazılmadı.
 *
 * Uç yanıtından özet kuran SAF hesaplar (yer adı, aksiyon kademeleri, geçmiş gün, tarih)
 * `lib/asistan-sesli-ozet.ts`te; orada veritabanı olmadan sınanırlar.
 *
 * HIZ (Faz 1c): her uç çağrısı 60 sn önbellekli (`lib/asistan-sesli-onbellek.ts`,
 * anahtar kiracı|kullanıcı|uç). Görüşme açılınca `sesliIsit` ağır araçları önceden
 * hesaplar. Önbellekten dönen veride ucun kapısı o turda yeniden koşmaz; ama her araç
 * isteği `/api/asistan/arac`'ta `sesliKapi()`dan (oturum + yönetici) geçmiş olur.
 */

type Coz = { ok: true; veri: Govde } | { ok: false; hata: Govde };

/** Sesli araç bağlamı: v1 bağlamı + önbellek kimliği + bu çağrının önbellek izi. */
export type SesliBaglam = AsistanBaglam & {
  /** `kiracı|kullanıcı`. null → önbellek KULLANILMAZ. */
  kimlik: string | null;
  /** Ön ısıtma: kayıt bu yaştan (ms) eskiyse yeniden hesaplanır. */
  tazeleMs?: number;
  /** Bu çağrıdaki her uç/rapor okumasının önbellek durumu (ekrandaki etiket). */
  iz: { durum: OnbellekDurumu; yasMs: number }[];
};

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
async function coz(res: Response): Promise<Coz> {
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

/** Önbellek sarmalı: anahtar `kimlik|ek`; kimlik yoksa doğrudan hesaplar. Hata saklanmaz. */
async function onbellekten<T>(
  ctx: AsistanBaglam,
  ek: string,
  uret: () => Promise<T>,
  saklanir: (deger: T) => boolean
): Promise<T> {
  const b = ctx as Partial<SesliBaglam>;
  const kimlik = typeof b.kimlik === "string" && b.kimlik ? b.kimlik : null;
  const r = await onbellekli(kimlik ? `${kimlik}|${ek}` : null, uret, saklanir, b.tazeleMs);
  b.iz?.push({ durum: r.durum, yasMs: r.yasMs });
  return r.deger;
}

/** Mobil ucun `GET`i — süreç içinde, kullanıcının yetkisiyle, 60 sn önbellekli. */
function uc(
  ctx: AsistanBaglam,
  yol: string,
  sorgu: Record<string, unknown>,
  isleyici: (req: NextRequest) => Promise<Response>
): Promise<Coz> {
  const req = istek(ctx, yol, sorgu);
  return onbellekten(ctx, `${req.nextUrl.pathname}${req.nextUrl.search}`, async () => coz(await isleyici(req)), (s) => s.ok);
}

/** Tarih çözümü (saf, `lib/asistan-sesli-ozet.ts`) + kiracının bugünü. */
const gunCoz = (girdi: Govde) => gunCozSaf(girdi, todayYmdVienna());

function gunSemasi(secenek: readonly Gun[]) {
  const ad: Record<Gun, string> = { dun: "dun = yesterday", bugun: "bugun = today", yarin: "yarin = tomorrow" };
  return {
    gun: {
      type: "string",
      enum: secenek,
      description: `Relative day in the company time zone (${secenek.map((g) => ad[g]).join(", ")}). Default: bugun.`,
    },
    tarih: { type: "string", description: "YYYY-MM-DD for any other day. Overrides gun." },
  };
}

function v1(ad: string): AsistanArac {
  const arac = ARACLAR.find((a) => a.ad === ad);
  if (!arac) throw new Error(`v1 aracı yok: ${ad}`);
  return arac;
}

// ── araçlar ─────────────────────────────────────────────────────────────────

/** Geçmiş gün modu: araç evreni + o günün vardiyaları → `gecmisGunOzeti` (tanım orada). */
async function gecmisGunAraclari(tarih: string, girdi: Govde, ctx: AsistanBaglam) {
  const [filo, vardiya] = await Promise.all([
    uc(ctx, "/api/mobile/vehicles", { limit: 200 }, aracListeUc),
    uc(ctx, "/api/mobile/shifts", { from: tarih, to: tarih, limit: 200 }, vardiyaUc),
  ]);
  if (!filo.ok) return filo.hata;
  if (!vardiya.ok) return vardiya.hata;
  return gecmisGunOzeti(tarih, filo.veri, vardiya.veri, girdi.plaka);
}

const aracListesi: AsistanArac = {
  ad: "arac_listesi",
  kapi: "filo",
  uc: "/api/mobile/map + /api/mobile/geofences (geçmiş gün: /api/mobile/vehicles + /api/mobile/shifts)",
  aciklama: [
    "TODAY (default): vehicles with live status. `ozet` holds the counts for the whole fleet, counted",
    "exactly like the app's map strip: yolda = on the road (driver on an active shift, not on a break),",
    "duruyor = stopped (break, idle or maintenance), sinyal_yok = no signal for 2+ hours; plus total",
    "vehicles and vehicles with a known position. Each row: plate, hareket, live status, driver, speed",
    "in km/h, ignition, minutes since the last signal and `yer` = where it is: bolgede = inside the",
    "named zone `ad`; yakininda = `mesafeKm` km from the named zone `ad`; adres_yok = no place name",
    "available. There are NO coordinates. Use for 'how many vehicles are on the road', 'where is",
    "W-GF-113'. PAST DAY (gun = dun, or tarih): which vehicles worked that day = had at least one shift;",
    "lists vehicles with no shift, vehicles with a shift but 0 km, and km per vehicle (null = not",
    "measurable). Use for 'which vehicle did not work yesterday'. Optional filters: plaka, hareket.",
  ].join(" "),
  sema: {
    type: "object",
    properties: {
      plaka: { type: "string", description: "Any part of a licence plate, e.g. 113 or W-GF-113." },
      hareket: {
        type: "string",
        enum: ["yolda", "duruyor", "sinyal_yok"],
        description: "Today only: list vehicles in this state. The summary always covers the whole fleet.",
      },
      ...gunSemasi(["bugun", "dun"]),
    },
    additionalProperties: false,
  },
  async calistir(girdi, ctx) {
    const g = gunCoz(girdi);
    if (!g.ok) return g.hata;
    if (g.tarih > g.bugun) return { hata: "gelecek_gun", tarih: g.tarih };
    if (g.tarih < g.bugun) return gecmisGunAraclari(g.tarih, girdi, ctx);

    const [harita, bolge] = await Promise.all([
      uc(ctx, "/api/mobile/map", {}, haritaUc),
      uc(ctx, "/api/mobile/geofences", { arsiv: 1 }, bolgeUc),
    ]);
    if (!harita.ok) return harita.hata;
    const bolgeler = bolge.ok ? bolgeListesi(bolge.veri) : null;
    const araclar = dizi(harita.veri.araclar).map((a): Govde => ({ ...a, hareket: hareketDurumu(a) }));
    const sayim = (harita.veri.sayim ?? {}) as Govde;
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
      olcumAni: harita.veri.olcumAni,
      ...(bolgeler ? {} : { yerAdi: "bolgeler_okunamadi" }),
      ...kes(satirlar, 40, (s) => ({
        ...alanlar(s, ["plaka", "hareket", "durum", "sofor", "hizKmh", "kontak"]),
        yer: yerBul(s.konum, bolgeler),
        sinyalYasiDk: typeof s.sonSinyalMs === "number" ? Math.round(s.sonSinyalMs / 60000) : null,
      })),
    };
  },
};

const DONEM_SEMA = {
  donem: {
    type: "string",
    enum: ["gun", "hafta", "ay"],
    description: "Sliding window: gun = 1 day (today), hafta = last 7 days, ay = last 30 days. Default: hafta.",
  },
  tarih: {
    type: "string",
    description: "YYYY-MM-DD. Anchors the window so this date is its LAST day. Omit for a window ending today.",
  },
} as const;

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
    const liste = await uc(ctx, "/api/mobile/vehicles", { limit: 200 }, aracListeUc);
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
    const ozet = await uc(
      ctx,
      `/api/mobile/vehicles/${encodeURIComponent(id)}/ozet`,
      { donem: girdi.donem, tarih: girdi.tarih },
      (req) => aracOzetUc(req, { params: Promise.resolve({ id }) })
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
    "Trips planned for a day: today by default, or gun = dun (yesterday) / yarin (tomorrow), or a",
    "tarih. `ozet` holds the number of trips and their counts per status (atandi = assigned, kabul =",
    "accepted, yolda = under way, tamamlandi = completed, iptal = cancelled). Each row: driver name,",
    "vehicle plate, status, next stop name, stops done/total, package target and actual, notes, and",
    "the ordered stop list (sequence, name, address, status, time window, arrival time). Use for 'what",
    "trips are there today/tomorrow', 'which stop is next for X'. Admin only.",
  ].join(" "),
  sema: {
    type: "object",
    properties: { ...gunSemasi(["dun", "bugun", "yarin"]) },
    additionalProperties: false,
  },
  async calistir(girdi, ctx) {
    const g = gunCoz(girdi);
    if (!g.ok) return g.hata;
    const s = await uc(ctx, "/api/mobile/sefer", { tarih: g.tarih }, seferUc);
    if (!s.ok) return s.hata;
    const seferler = dizi(s.veri.seferler);
    const ilk = seferler.slice(0, SEFER_TAVANI);
    const [personel, filo, durakSonuclari] = await Promise.all([
      uc(ctx, "/api/mobile/workers", { aktif: "all", limit: 200 }, personelUc),
      uc(ctx, "/api/mobile/vehicles", { limit: 200 }, aracListeUc),
      Promise.all(
        ilk.map((x) => {
          const id = String(x.id);
          return uc(ctx, `/api/mobile/sefer/${encodeURIComponent(id)}/duraklar`, {}, (req) =>
            durakUc(req, { params: Promise.resolve({ id }) })
          );
        })
      ),
    ]);
    const adlar = new Map(personel.ok ? dizi(personel.veri.personel).map((w) => [String(w.id), w.adSoyad]) : []);
    const plakalar = new Map(filo.ok ? dizi(filo.veri.araclar).map((a) => [String(a.id), a.plaka]) : []);
    return {
      ozet: { seferSayisi: seferler.length, durumlar: say(seferler.map((x) => x.durum)) },
      tarih: s.veri.tarih ?? g.tarih,
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
  uc: "/api/mobile/dashboard + /api/mobile/alarms?range=gun",
  aciklama: [
    "The action centre: what needs the manager's attention, tiered exactly like the app's Action Centre.",
    "`ozet`: kritik (critical) and uyari (warning) counts, rutin (routine) count, leave requests waiting",
    "for approval, and `enCokTurler` = the top 3 critical/warning types with their counts and a",
    "readable name `ad` (say the name, never the code). Alarms are TODAY's device alarms; the",
    "attention list (working-time limits, missing signal, expiring documents, fines, fault codes,",
    "work orders…) is the current state. Snoozed items are included and counted in `ertelenen`.",
    "`kritikKalemler`: a few critical items with plate or driver. Use for 'what needs my attention',",
    "'anything urgent', 'which alarm types'. Takes no arguments.",
  ].join(" "),
  sema: { type: "object", properties: {}, additionalProperties: false },
  async calistir(_girdi, ctx) {
    const [pano, alarm] = await Promise.all([
      uc(ctx, "/api/mobile/dashboard", {}, panoUc),
      // limit=1: satır gerekmiyor; `turDagilim` TAM küme üzerinden sayılıyor (uç notu).
      uc(ctx, "/api/mobile/alarms", { range: "gun", limit: 1 }, alarmUc),
    ]);
    if (!pano.ok) return pano.hata;
    return aksiyonOzeti(pano.veri, alarm.ok ? alarm.veri : null);
  },
};

const bugunIzinliler: AsistanArac = {
  ad: "bugun_izinliler",
  kapi: "filo",
  uc: "/api/mobile/leaves",
  aciklama: [
    "Who is on leave on a day: today by default, or gun = dun / yarin, or a tarih. `ozet`: how many",
    "people, how many approved and how many pending. Rows: name, leave type with its label, start and",
    "end date and status (approved, or pending — pending IS included and marked). Rejected leave is",
    "never returned. Use for 'who is off today', 'who is off tomorrow', 'is X on leave'.",
  ].join(" "),
  sema: {
    type: "object",
    properties: { ...gunSemasi(["dun", "bugun", "yarin"]) },
    additionalProperties: false,
  },
  async calistir(girdi, ctx) {
    const g = gunCoz(girdi);
    if (!g.ok) return g.hata;
    const tarih = g.tarih;
    const r = await uc(ctx, "/api/mobile/leaves", { ay: tarih.slice(0, 7) }, izinUc);
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

// ── rapor araçları: önce ucun kapısı, sonra panelin rapor fonksiyonu ────────────

/**
 * Raporun KENDİ ucunun kapısı (`requireMobileAdmin`) aynı yetki başlığıyla koşar; geçmezse
 * rapor HİÇ çalışmaz ve hata uçtaki gibi döner. Muhafız bu sırayı denetler.
 */
async function raporKapisi(ctx: AsistanBaglam, yol: string): Promise<{ ok: false; hata: Govde } | null> {
  const kapi = await requireMobileAdmin(istek(ctx, yol, {}));
  if (kapi.ok) return null;
  const r = await coz(kapi.response);
  return { ok: false, hata: r.ok ? { hata: "kapi_reddetti", durum: kapi.response.status } : r.hata };
}

/** `donem`/`tarih` → pencere; `/driver-scores` ile AYNI çözümleyici (`donemCoz`). */
function donemArgumani(ctx: AsistanBaglam, girdi: Govde, varsayilan: "hafta" | "ay") {
  const url = new URL("/api/mobile/driver-scores", ctx.taban);
  url.searchParams.set("donem", typeof girdi.donem === "string" ? girdi.donem : varsayilan);
  if (typeof girdi.tarih === "string" && girdi.tarih) url.searchParams.set("tarih", girdi.tarih);
  return donemCoz(url);
}

const soforSkorlari: AsistanArac = {
  ad: "sofor_skorlari",
  kapi: "yonetici",
  uc: "buildPerformanceReport (Raporlar › Performans; /api/mobile/driver-scores kapısı)",
  aciklama: [
    "Driver ranking for a window, the same numbers and order as Reports > Performance: donem = hafta",
    "(last 7 days, default), ay (last 30 days) or gun (today); tarih anchors the window's last day.",
    "`ozet`: the window in days, average score, how many drivers were scored, `enIyi` (best 3) and",
    "`enKotu` (weakest 3, weakest first) with name and score. Rows: rank, name, score (null = not",
    "enough data, NOT zero), shifts, km (null = not measurable), total violations. If `skorKalibre` is",
    "false the scores are not calibrated yet: name the ranking, do not say score numbers. Admin only.",
  ].join(" "),
  sema: { type: "object", properties: { ...DONEM_SEMA }, additionalProperties: false },
  async calistir(girdi, ctx) {
    const d = donemArgumani(ctx, girdi, "hafta");
    if (!d.ok) return { hata: "gecersiz_arguman", alan: d.kod === "invalid_donem" ? "donem" : "tarih" };
    const { range } = d.cozum;
    const sonuc = await onbellekten(
      ctx,
      `rapor:performans:${range.start.toISOString()}:${range.end.toISOString()}`,
      async (): Promise<Coz> => {
        const kapali = await raporKapisi(ctx, "/api/mobile/driver-scores");
        if (kapali) return kapali;
        const rapor = await buildPerformanceReport(range);
        const siralar = siraHaritasi(rapor.rows);
        return {
          ok: true,
          veri: {
            ortalama: rapor.avgScore,
            skorlanan: rapor.scoredCount,
            satirlar: rapor.rows.map((r) => performansSatiri(r, siralar.get(r.workerId) ?? 0, null)),
          },
        };
      },
      (s) => s.ok
    );
    if (!sonuc.ok) return sonuc.hata;
    const satirlar = dizi(sonuc.veri.satirlar);
    const kalibre = SAFETY_SCORE_CALIBRATED;
    const skorlu = satirlar.filter((x) => typeof x.guvenlikSkoru === "number");
    const kisa = (x: Govde) => ({ ad: x.adSoyad ?? null, ...(kalibre ? { skor: x.guvenlikSkoru } : {}) });
    return {
      ozet: {
        donemGun: d.cozum.gun,
        ortalamaSkor: kalibre ? (sonuc.veri.ortalama ?? null) : null,
        skorlanan: sonuc.veri.skorlanan ?? null,
        soforSayisi: satirlar.length,
        enIyi: skorlu.slice(0, 3).map(kisa),
        enKotu: skorlu.length > 1 ? skorlu.slice(-3).reverse().map(kisa) : [],
        skorKalibre: kalibre,
      },
      donem: donemGovdesi(d.cozum),
      ...kes(satirlar, 15, (x) => ({
        sira: x.sira,
        ad: x.adSoyad,
        ...(kalibre ? { skor: x.guvenlikSkoru } : {}),
        yetersizVeri: x.yetersizVeri,
        vardiya: x.vardiya,
        km: x.km,
        ihlal: ((x.ihlal ?? {}) as Govde).toplam ?? null,
      })),
    };
  },
};

type YakitRaporu = Awaited<ReturnType<typeof buildFuelReport>>;

/**
 * YAKIT VERİMLİLİĞİ (Faz 1c) — Raporlar › Yakıt'ın kaynağı `buildFuelReport`. Litre ve
 * L/100 km ARAÇ eksenlidir; "şoför" alanı aracın ATANMIŞ şoförünün etiketi, şoför başına
 * yakıt ölçümü DEĞİL (rapor böyle kurulu). Güvenilmez sensörlü araç ve L/100'ü
 * hesaplanamayan araç sıralamaya girmez, sebebiyle sayılır. L/100 km en az 7 günlük
 * aralıkta hesaplanır (`FUEL_L100_MIN_DAYS`); daha kısa aralık "ölçülemiyor" döner.
 */
const yakitVerimliligi: AsistanArac = {
  ad: "yakit_verimliligi",
  kapi: "yonetici",
  uc: "buildFuelReport (Raporlar › Yakıt; /api/mobile/reports/fuel.csv kapısı)",
  aciklama: [
    "Fuel efficiency per vehicle from Reports > Fuel: donem = ay (last 30 days, default) or hafta",
    "(last 7 days); at least 7 days are needed for litres per 100 km. `ozet`: fleet average L/100 km,",
    "how many vehicles could be measured out of all, total litres. `enKotu` = the 3 vehicles with the",
    "highest consumption, `enIyi` = the 3 lowest: plate, L/100 km, km and `atanmisSofor` (the vehicle's",
    "assigned driver — fuel is measured per vehicle, not per driver). If `olculemiyor` is set, say that",
    "fuel efficiency cannot be measured and why. Admin only.",
  ].join(" "),
  sema: {
    type: "object",
    properties: {
      donem: { type: "string", enum: ["hafta", "ay"], description: "hafta = last 7 days, ay = last 30 days. Default: ay." },
      tarih: DONEM_SEMA.tarih,
    },
    additionalProperties: false,
  },
  async calistir(girdi, ctx) {
    const d = donemArgumani(ctx, girdi, "ay");
    if (!d.ok) return { hata: "gecersiz_arguman", alan: d.kod === "invalid_donem" ? "donem" : "tarih" };
    const { range } = d.cozum;
    const sonuc = await onbellekten(
      ctx,
      `rapor:yakit:${range.start.toISOString()}:${range.end.toISOString()}`,
      async (): Promise<{ ok: true; rapor: YakitRaporu } | { ok: false; hata: Govde }> => {
        const kapali = await raporKapisi(ctx, "/api/mobile/reports/fuel.csv");
        if (kapali) return kapali;
        const rapor = await buildFuelReport(range);
        return { ok: true, rapor };
      },
      (s) => s.ok
    );
    if (!sonuc.ok) return sonuc.hata;
    const r = sonuc.rapor;
    if (!r.available) return { olculemiyor: true, sebep: r.unavailableReason, donemGun: d.cozum.gun };
    if (!r.l100Available) return { olculemiyor: true, sebep: "aralik_7_gunden_kisa", donemGun: r.rangeDays };

    const olculen = r.rows
      .filter((x) => x.lPer100Km !== null && !x.dataUnreliable)
      .sort((a, b) => (b.lPer100Km ?? 0) - (a.lPer100Km ?? 0));
    const satir = (x: YakitRaporu["rows"][number]) => ({
      plaka: x.plate,
      l100: x.lPer100Km === null ? null : bir(x.lPer100Km),
      km: x.km === null ? null : Math.round(x.km),
      atanmisSofor: x.driverName,
    });
    const disarida = r.rows.filter((x) => x.lPer100Km === null || x.dataUnreliable);
    return {
      ozet: {
        donemGun: r.rangeDays,
        filoOrtalamaL100: r.fleetLPer100Km === null ? null : bir(r.fleetLPer100Km),
        olculenArac: olculen.length,
        aracSayisi: r.vehicleCount,
        toplamLitre: Math.round(r.totalConsumedLiters),
      },
      enKotu: olculen.slice(0, 3).map(satir),
      enIyi: olculen.length > 3 ? olculen.slice(-3).reverse().map(satir) : [],
      olculemeyen: {
        sayi: disarida.length,
        sebepler: say(disarida.map((x) => (x.dataUnreliable ? "guvenilmez_sensor" : x.lPer100Reason))),
      },
      ...(r.partialVehicles.length > 0 ? { eksikAraclar: r.partialVehicles.slice(0, 10) } : {}),
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
 * Modele verilen liste — SIRA SABİT (ön ek önbelleği sıraya duyarlı; yeni araç SONA).
 * Yalnız bu adlar çalışır; `/api/asistan/arac` başka bir adı 400 ile reddeder.
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
  yakitVerimliligi,
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

/**
 * ÖN ISITMA (Faz 1c). Görüşme açılınca ve açık kaldıkça (istemci 45 sn'de bir) çağrılır:
 * ağır araçlar SIRAYLA çalışır ve önbelleği doldurur. Sıralı, çünkü iki performans
 * raporunu aynı anda koşturmak veritabanı zaman aşımı payını düşürür (lib/db-fanout.ts
 * dersi). `tazeleMs`: 40 sn'den eski kayıt yenilenir, 60 sn'lik ömür dolmadan yenisi
 * hazır olur — görüşme boyunca soru önbellekten cevaplanır. Yakıt yalnız ilk ısıtmada.
 */
const ISITMA: readonly { ad: string; girdi: Govde; ilkSefer?: true }[] = [
  { ad: "arac_listesi", girdi: {} },
  { ad: "aksiyon_merkezi", girdi: {} },
  { ad: "sofor_skorlari", girdi: { donem: "hafta" } },
  { ad: "yakit_verimliligi", girdi: {}, ilkSefer: true },
];
const TAZELEME_MS = 40_000;

export type IsitmaSonucu = { ad: string; sureMs: number; onbellek: "tam" | "kismi" | "yok"; hata: string | null };

/** Bir çağrının önbellek izi → ekrandaki etiket. */
export function onbellekEtiketi(iz: SesliBaglam["iz"]): "tam" | "kismi" | "yok" {
  if (iz.length === 0) return "yok";
  const bellekten = iz.filter((x) => x.durum !== "yok").length;
  return bellekten === iz.length ? "tam" : bellekten > 0 ? "kismi" : "yok";
}

export async function sesliIsit(ctx: SesliBaglam, ilk: boolean): Promise<IsitmaSonucu[]> {
  const sonuclar: IsitmaSonucu[] = [];
  for (const is of ISITMA) {
    if (is.ilkSefer && !ilk) continue;
    const arac = sesliAracBul(is.ad);
    if (!arac) continue;
    const iz: SesliBaglam["iz"] = [];
    const t0 = Date.now();
    let hata: string | null = null;
    try {
      const s = (await arac.calistir(is.girdi, { ...ctx, iz, tazeleMs: TAZELEME_MS } as SesliBaglam)) as Govde | null;
      if (s && typeof s === "object" && typeof s.hata === "string") hata = s.hata;
    } catch {
      hata = "arac_calismadi";
    }
    sonuclar.push({ ad: is.ad, sureMs: Date.now() - t0, onbellek: onbellekEtiketi(iz), hata });
  }
  return sonuclar;
}

/** Araç başına süre tavanı (tasarım belgesi §1.4). Aşılırsa model bunu duyar. */
const ARAC_ZAMAN_ASIMI_MS = 20_000;
/** Sonuç modele metin olarak gider; bağlam pahalı (belge §5.3). */
const SONUC_TAVANI_KARAKTER = 12_000;

export type AracYurutmeSonucu = { ad: string; sonuc: unknown; sureMs: number; onbellek: "tam" | "kismi" | "yok" };

/**
 * Tek araç çağrısı: argüman süzgeci → çalıştırma (20 sn tavan) → 12.000 karakter tavanı →
 * önbellek etiketi. `/api/asistan/arac` (sesli) ve `/api/asistan/yazi` (yazılı yol) AYNI
 * yürütücüyü kullanır. Argüman hatası, zaman aşımı ve uç hataları `sonuc.hata` olarak döner:
 * bunlar modelin duyması gereken bilgiler, tarayıcının hatası değil.
 */
export async function sesliAracYurut(arac: AsistanArac, girdiHam: unknown, ctx: SesliBaglam): Promise<AracYurutmeSonucu> {
  const a = argumanCoz(arac.sema, girdiHam);
  if (!a.ok) return { ad: arac.ad, sonuc: a.hata, sureMs: 0, onbellek: "yok" };

  const baslangic = Date.now();
  let zamanlayici: ReturnType<typeof setTimeout> | undefined;
  const zamanAsimi = new Promise<Govde>((coz) => {
    zamanlayici = setTimeout(() => coz({ hata: "zaman_asimi", sureMs: ARAC_ZAMAN_ASIMI_MS }), ARAC_ZAMAN_ASIMI_MS);
  });
  let sonuc: unknown;
  try {
    sonuc = await Promise.race([arac.calistir(a.girdi, ctx), zamanAsimi]);
  } catch {
    sonuc = { hata: "arac_calismadi" };
  } finally {
    clearTimeout(zamanlayici);
  }
  const metin = JSON.stringify(sonuc ?? null);
  if (metin.length > SONUC_TAVANI_KARAKTER) {
    sonuc = { hata: "sonuc_cok_buyuk", karakter: metin.length, oneri: "daha dar bir süzgeçle tekrar sor" };
  }
  return { ad: arac.ad, sonuc, sureMs: Date.now() - baslangic, onbellek: onbellekEtiketi(ctx.iz) };
}
