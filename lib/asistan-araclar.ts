import "server-only";
import { NextRequest } from "next/server";
import type { Locale } from "@/i18n/request";

import { GET as panoUc } from "@/app/api/mobile/dashboard/route";
import { GET as analizUc } from "@/app/api/mobile/analytics/route";
import { GET as alarmUc } from "@/app/api/mobile/alarms/route";
import { GET as skorUc } from "@/app/api/mobile/driver-scores/route";
import { GET as aracListeUc } from "@/app/api/mobile/vehicles/route";
import { GET as aracOzetUc } from "@/app/api/mobile/vehicles/[id]/ozet/route";
import { GET as isEmriUc } from "@/app/api/mobile/is-emirleri/route";
import { GET as izinUc } from "@/app/api/mobile/leaves/route";
import { GET as mevzuatUc } from "@/app/api/mobile/mevzuat/route";

/**
 * AI ASİSTAN — ARAÇ KATMANI (v1, 23.09.2026). SALT OKUMA.
 *
 * ═══ 1 · NEDEN UÇ İŞLEYİCİSİ DOĞRUDAN ÇAĞRILIYOR ═══════════════════════════
 *
 * Her araç, karşılığı olan mobil ucun `GET` fonksiyonunu SÜREÇ İÇİNDE çağırır.
 * Ağ yok, `fetch` yok, kendi kendine HTTP isteği yok. Üç şeyi birden çözdüğü
 * için böyle:
 *
 *   a) SAYI AYRIŞMAZ. Çekirdekleri ayrı ayrı çağırıp burada yeniden şekil
 *      verseydik, panelin/uygulamanın gördüğü sayı ile asistanın söylediği sayı
 *      bir gün ayrışırdı — bu depoda tekrar tekrar yazılmış olan tek kaynak
 *      kuralının ihlali. Burada ikinci bir hesap YOK; yanıtın alanları
 *      SEÇİLİYOR (bkz. §3), hiçbiri türetilmiyor.
 *
 *   b) KAPI DOĞRU KALIR. Kapılar uçtan uca AYNI DEĞİL ve bu bilinçli
 *      (lib/mobile-scope.ts "panel paritesi"): `/dashboard`, `/is-emirleri`,
 *      `/leaves`, `/mevzuat` → `requireMobileFleetView`; `/analytics`,
 *      `/alarms`, `/driver-scores`, `/vehicles*` → `requireMobileAdmin`.
 *      İşleyiciyi çağırmak, her aracın KENDİ kapısını da çalıştırır. Asistan
 *      ucuna tek bir kapı koyup sonra çekirdekleri çağırsaydık filo şefi
 *      panelde giremediği /admin/analiz ve /admin/alarmlar verisini asistan
 *      üzerinden okurdu — sessiz bir yetki genişlemesi.
 *
 *   c) KAPSAM SUNUCUDAN GELİR. İşleyici yetkiyi `Authorization` başlığından
 *      çözüyor; kapsam (`fleetScope`) o kimlikten DB'de hesaplanıyor. Modelin
 *      ürettiği argümanlar yalnız SÜZGEÇTİR (dönem, durum, plaka); hiçbiri
 *      kimlik ya da kapsam taşımaz. Modelin `workerId`/`fleet` uydurup kapsam
 *      genişletmesi mümkün değil — çünkü öyle bir parametre yok.
 *
 * ⚠️ BEDELİ BİLİNÇLİ: her araç çağrısı ucun kapısını yeniden koşturur, yani
 * `workers` tablosuna bir okuma daha yapar. Bunu kabul ediyoruz; alternatifi
 * kapıyı bir kez çalıştırıp kapsamı araçlara elden dağıtmaktı ve o, (b)'deki
 * yetki genişlemesini kodun içine gömmek olurdu.
 *
 * ═══ 2 · ROLE GÖRE ARAÇ LİSTESİ ════════════════════════════════════════════
 *
 * Kapı iki kademeli: uç `requireMobileFleetView` ile korunuyor (şoför 403), ama
 * MODELE VERİLEN ARAÇ LİSTESİ role göre süzülüyor (`araclarFor`). Filo şefi
 * yönetici araçlarını hiç GÖRMEZ, dolayısıyla çağıramaz ve "yetkin yok"
 * cevabıyla vakit kaybetmez. Süzme bir güvenlik katmanı DEĞİL bir kolaylıktır —
 * güvenliği sağlayan, çağrılsa bile ucun kendi kapısının 403 dönmesidir.
 *
 * ═══ 3 · DARALTMA: SEÇİM, TÜRETME DEĞİL ════════════════════════════════════
 *
 * Uç yanıtları telefon ekranı için tasarlandı; modele ham hâlde verilseydi bir
 * pano çağrısı tek başına on binlerce jeton yerdi. Bu yüzden her araç yanıtı
 * DARALTIYOR — ama daraltma yalnız ÜÇ işlemden ibaret:
 *
 *     • alan seçme / atma        (`alanlariAt`)
 *     • listeyi kesme            (`.slice`) + `kirpildi` bayrağı
 *     • olduğu gibi taşıma
 *
 * 🔴 ARİTMETİK YOK. Bu dosyada tek bir toplama, bölme, yuzde ya da yuvarlama
 * bulunmaz ve `scripts/check-asistan.mjs` bunu denetler. Sebebi §1a ile aynı:
 * burada hesaplanan bir sayı, hiçbir ekranda bulunmayan üçüncü bir sayı olurdu.
 * Kesilen listelerde toplamlar KIRPILMAZ — `sayfa.total` / `uyari.tur` gibi
 * gerçek sayılar yanıtta kalır, yalnız satırlar azalır.
 *
 * ═══ 4 · YAZMA YOK ═════════════════════════════════════════════════════════
 *
 * Dokuz aracın dokuzu da `GET`. Bu dosya `supabaseAdmin`'i İÇE AKTARMAZ; yani
 * buradan bir satır yazmanın yolu yoktur, yanlışlıkla bile. Muhafız hem o
 * içe aktarmayı hem `POST|PATCH|PUT|DELETE` işleyicisi çağrılmasını yasaklar.
 *
 * ⚠️ RAPOR VE GÜVENLİK UÇLARI ARAÇ DEĞİL. `/api/mobile/reports/*` bir BELGE
 * üretir (PDF/CSV) — asistanın işi değil, kullanıcı Raporlar ekranına gider.
 * `/api/mobile/guvenlik/*` ise patron kademesi: oturum izi, denetim kaydı,
 * kill-switch. Bir dil modelinin o yüzeye okuma erişimi bile olmamalı; kapı
 * (`requireMobileOwner`) zaten kapatırdı ama listeye HİÇ girmemeleri kuralın
 * kendisi ve muhafız bunu ayrıca denetler.
 */

// ── ortak yardımcılar ───────────────────────────────────────────────────────

/** Modelin göreceği araç adı → ucun gerçek yolu (iz ve belge için). */
export type AsistanKapi = "yonetici" | "filo";

export type AsistanBaglam = {
  /** İsteği yapanın `Authorization` başlığı — kimlik BUNDAN çözülür. */
  yetkiBasligi: string;
  /** Mutlak URL kurmak için taban; işleyiciler yalnız `searchParams` okur. */
  taban: string;
};

export type AsistanArac = {
  ad: string;
  kapi: AsistanKapi;
  /** Belgede ve izde görünen uç yolu. */
  uc: string;
  aciklama: string;
  sema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  calistir: (girdi: Record<string, unknown>, ctx: AsistanBaglam) => Promise<unknown>;
};

type Govde = Record<string, unknown>;

/** Sorgu parametreli `NextRequest` — yetki başlığı olduğu gibi taşınır. */
function istek(ctx: AsistanBaglam, yol: string, sorgu: Record<string, unknown>): NextRequest {
  const url = new URL(yol, ctx.taban);
  for (const [k, v] of Object.entries(sorgu)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return new NextRequest(url, { headers: { authorization: ctx.yetkiBasligi } });
}

/**
 * Uç yanıtını çözer.
 *
 * ⚠️ HATA YUTULMAZ. Uç 403/404/503 dönerse model bunu OLDUĞU GİBİ görür ve
 * sistem istemi ona hatayı saklamamasını söyler. Sessizce boş nesne dönseydik
 * model "veri yok" der, kullanıcı da bunu "sıfır" diye okurdu — bu depodaki
 * sessiz eksik yasağının tam olarak yasakladığı şey.
 */
async function coz(res: Response): Promise<{ ok: true; veri: Govde } | { ok: false; hata: Govde }> {
  let json: Govde | null = null;
  try {
    json = (await res.json()) as Govde;
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.ok !== true) {
    return {
      ok: false,
      hata: {
        hata: (json?.error as string) ?? "uc_cevabi_okunamadi",
        durum: res.status,
        ...(json?.sebep !== undefined ? { sebep: json.sebep } : {}),
        ...(json?.alan !== undefined ? { alan: json.alan } : {}),
        ...(json?.gecerli !== undefined ? { gecerli: json.gecerli } : {}),
      },
    };
  }
  return { ok: true, veri: json };
}

/** Bir nesneden adı verilen anahtarları ATAR. Yalnız seçim — değer üretmez. */
function alanlariAt<T extends Govde>(nesne: T, atilacak: readonly string[]): Govde {
  const cikti: Govde = {};
  for (const [k, v] of Object.entries(nesne)) {
    if (atilacak.includes(k)) continue;
    cikti[k] = v;
  }
  return cikti;
}

/** Bir nesneden YALNIZ adı verilen anahtarları alır (yoksa hiç yazmaz). */
function alanlar<T extends Govde>(nesne: T, alinacak: readonly string[]): Govde {
  const cikti: Govde = {};
  for (const k of alinacak) {
    if (nesne[k] !== undefined) cikti[k] = nesne[k];
  }
  return cikti;
}

function dizi(v: unknown): Govde[] {
  return Array.isArray(v) ? (v as Govde[]) : [];
}

/**
 * Listeyi keser ve kesildiyse SÖYLER.
 *
 * `kirpildi` bayrağı bu depodaki yerleşik sözleşme (dashboard `rosterKirpildi`,
 * alarmlar `ertelemeKirpildi`, mevzuat `page`): kırpma sessiz olamaz, yoksa
 * model 40 satıra bakıp "filoda 40 uyarı var" der.
 */
function kes(satirlar: Govde[], tavan: number, donustur: (s: Govde) => Govde) {
  return {
    satirlar: satirlar.slice(0, tavan).map(donustur),
    satirTavani: tavan,
    kirpildi: satirlar.length > tavan,
  };
}

// ── satır daraltıcıları ─────────────────────────────────────────────────────

/**
 * Dikkat kalemi — kimlik ve YÖNLENDİRME alanları düşer.
 *
 * ⚠️ `param` BİLEREK KALIYOR: sebep anahtarının yanındaki sayıları taşıyor
 * (`{gun: 5}` gibi). Onu atsaydık model "belge bitiyor" der ama kaç gün
 * kaldığını söyleyemezdi — yani sayı kaybolurdu. `hedef`/`id` ise ekran
 * yönlendirmesi içindir ve modele hiçbir şey anlatmaz.
 */
const UYARI_AT = ["id", "hedef", "vardiyaId"] as const;

const ROSTER_AL = [
  "ad",
  "durum",
  "plaka",
  "kullanilanPlaka",
  "aracDurum",
  "baslangic",
  "bitis",
  "alinanPaket",
  "telemetriBayat",
] as const;

const ARAC_AL = [
  "id",
  "plaka",
  "marka",
  "model",
  "yil",
  "filo",
  "filoEtiketi",
  "durum",
  "canliDurum",
  "sofor",
  "muayeneSon",
  "sigortaSon",
] as const;

const ALARM_AL = ["tur", "siddet", "plaka", "sofor", "an", "deger", "hizKmh", "sureMs"] as const;

const IS_EMRI_AL = [
  "id",
  "plaka",
  "aciklama",
  "durum",
  "oncelik",
  "kaynak",
  "bildiren",
  "maliyet",
  "olusturma",
  "kapanis",
] as const;

// ── araçlar ─────────────────────────────────────────────────────────────────

const ARALIK_SEMA = {
  aralik: {
    type: "string",
    enum: ["gun", "hafta", "ay", "tumzaman", "ozel"],
    description:
      [
        "Time window. gun = today, hafta = last 7 days (sliding), ay = last 30 days (sliding),",
        "tumzaman = since fleet start, ozel = custom (then from/to are required). Default: hafta.",
      ].join(" "),
  },
  from: { type: "string", description: "YYYY-MM-DD. Only with aralik=ozel." },
  to: { type: "string", description: "YYYY-MM-DD. Only with aralik=ozel." },
} as const;

const DONEM_SEMA = {
  donem: {
    type: "string",
    enum: ["gun", "hafta", "ay"],
    description:
      "Sliding window: gun = 1 day, hafta = 7 days, ay = 30 days. Default: hafta.",
  },
  tarih: {
    type: "string",
    description:
      "YYYY-MM-DD. Anchors the window so this date is its LAST day. Omit for a window ending today.",
  },
} as const;

export const ARACLAR: readonly AsistanArac[] = [
  {
    ad: "filo_panosu",
    kapi: "filo",
    uc: "/api/mobile/dashboard",
    aciklama:
      [
        "Today's operational snapshot for the whole fleet the caller can see: open shifts, vehicles",
        "on the road, packages loaded/delivered, total km today, fleet status counts, today's roster",
        "(who is out, with which vehicle, since when), the attention/action list (expiring",
        "inspections, insurance, licences, documents, silent vehicles, AZG over-limit shifts, open",
        "work orders, due maintenance), active DTC fault codes, and a 7-day performance summary.",
        "This is the right first call for open-ended questions like 'how is the fleet doing today'",
        "or 'what needs my attention'. Takes no arguments; the window is fixed (today, Vienna day).",
      ].join(" "),
    sema: { type: "object", properties: {}, additionalProperties: false },
    async calistir(_girdi, ctx) {
      const r = await coz(await panoUc(istek(ctx, "/api/mobile/dashboard", {})));
      if (!r.ok) return r.hata;
      const v = r.veri;
      const uyari = (v.uyari ?? {}) as Govde;
      return {
        kapsam: v.kapsam,
        bugun: v.bugun,
        filo: v.filo,
        gunun_panosu: kes(dizi(v.roster), 40, (s) => alanlar(s, ROSTER_AL)),
        rolanti: v.rolanti,
        alarm: v.alarm,
        onay_bekleyen_izin: ((v.onayBekleyen ?? {}) as Govde).izin,
        uyari: {
          toplam: uyari.toplam,
          tur: uyari.tur,
          ...kes(dizi(uyari.kalemler), 40, (s) => alanlariAt(s, UYARI_AT)),
        },
        dtc_arac_sayisi: v.dtcAracSayisi,
        dtc: kes(dizi(v.dtc), 15, (s) => alanlariAt(s, ["aracId"])),
        performans_7gun: v.performans7g,
        etkin_erteleme_sayisi: v.ertelemeToplam,
      };
    },
  },

  {
    ad: "filo_analizi",
    kapi: "yonetici",
    uc: "/api/mobile/analytics",
    aciklama:
      [
        "Fleet-wide analytics for a chosen window: total shifts, worked time, km (with measurement",
        "coverage), safety score summary, alarm counts by type, ownerless-event bridge, and idle",
        "waste (time, litres, euro, per-driver rows). Also returns the previous comparable window.",
        "Use for 'how did the fleet do last month' style questions.",
        "CO2 is NOT available through this tool. Admin only.",
      ].join(" "),
    sema: { type: "object", properties: { ...ARALIK_SEMA }, additionalProperties: false },
    async calistir(girdi, ctx) {
      const r = await coz(
        await analizUc(
          istek(ctx, "/api/mobile/analytics", {
            range: girdi.aralik,
            from: girdi.from,
            to: girdi.to,
          })
        )
      );
      if (!r.ok) return r.hata;
      const v = r.veri;
      const onceki = (v.oncekiDonem ?? null) as Govde | null;
      return {
        donem: v.donem,
        trendBloke: v.trendBloke,
        esikNotu: v.esikNotu,
        toplam: toplamDaralt(v.toplam as Govde),
        onceki_donem: onceki
          ? { ...alanlariAt(onceki, ["toplam"]), toplam: toplamDaralt(onceki.toplam as Govde) }
          : null,
        onceki_donem_yok: v.oncekiDonemYok,
        rolanti_katsayi: v.rolantiKatsayi,
      };
    },
  },

  {
    ad: "alarmlar",
    kapi: "yonetici",
    uc: "/api/mobile/alarms",
    aciklama:
      [
        "Driving-event alarm list for a window: harsh braking, harsh acceleration, harsh cornering,",
        "overspeeding, signal jamming and idling episodes, each with plate, the driver who was on",
        "shift at that moment (null if none matched — never guessed), time, value and speed. Also",
        "returns the count per event type for the whole window. Admin only.",
      ].join(" "),
    sema: {
      type: "object",
      properties: {
        aralik: {
          type: "string",
          enum: ["gun", "hafta", "ay", "tumzaman"],
          description: "Time window; default hafta (last 7 days).",
        },
        from: { type: "string", description: "YYYY-MM-DD; overrides aralik." },
        to: { type: "string", description: "YYYY-MM-DD; overrides aralik." },
        tur: {
          type: "string",
          description:
            "Filter by a single event type as it appears in turDagilim (e.g. harsh_braking).",
        },
        kademe: {
          type: "string",
          enum: ["kritik", "uyari", "rutin"],
          description: "Severity tier filter; combines with tur as an intersection.",
        },
      },
      additionalProperties: false,
    },
    async calistir(girdi, ctx) {
      const r = await coz(
        await alarmUc(
          istek(ctx, "/api/mobile/alarms", {
            range: girdi.aralik,
            from: girdi.from,
            to: girdi.to,
            tur: girdi.tur,
            kademe: girdi.kademe,
            limit: 200,
          })
        )
      );
      if (!r.ok) return r.hata;
      const v = r.veri;
      return {
        aralik: v.aralik,
        /** Pencerenin GERÇEK alarm sayısı — aşağıdaki liste kesilse de doğru. */
        sayfa: v.page,
        tur_dagilim: v.turDagilim,
        ...kes(dizi(v.alarmlar), 60, (s) => alanlar(s, ALARM_AL)),
      };
    },
  },

  {
    ad: "sofor_skorlari",
    kapi: "yonetici",
    uc: "/api/mobile/driver-scores",
    aciklama:
      [
        "Per-driver performance table for a window, in the same order the Reports > Performance",
        "screen shows: rank, safety score (null when it could not be computed — then `sebep` says",
        "why), shifts, worked time, km (null = not measurable, NOT zero), delivered/undelivered",
        "packages and the violation breakdown. Use for 'who drove worst/best' questions. Admin only.",
      ].join(" "),
    sema: { type: "object", properties: { ...DONEM_SEMA }, additionalProperties: false },
    async calistir(girdi, ctx) {
      const r = await coz(
        await skorUc(
          istek(ctx, "/api/mobile/driver-scores", {
            donem: girdi.donem,
            tarih: girdi.tarih,
            limit: 200,
          })
        )
      );
      if (!r.ok) return r.hata;
      const v = r.veri;
      return {
        donem: v.donem,
        skor: v.skor,
        toplam: v.toplam,
        sayfa: v.sayfa,
        ...kes(dizi(v.satirlar), 40, (s) =>
          alanlariAt(s, ["workerId", "oncekiSira", "siraDegisimi"])
        ),
      };
    },
  },

  {
    ad: "filo_araclari",
    kapi: "yonetici",
    uc: "/api/mobile/vehicles",
    aciklama:
      [
        "Vehicle list with live status: plate, make/model/year, fleet, status, live status, the",
        "assigned driver, and inspection/insurance due dates. Use this to find a vehicle's id",
        "before calling arac_ozeti. Admin only.",
      ].join(" "),
    sema: {
      type: "object",
      properties: {
        filo: { type: "string", description: "Fleet key filter, e.g. bordo or mavi." },
        durum: { type: "string", description: "Live status filter, as returned in canliDurum." },
      },
      additionalProperties: false,
    },
    async calistir(girdi, ctx) {
      const r = await coz(
        await aracListeUc(
          istek(ctx, "/api/mobile/vehicles", {
            filo: girdi.filo,
            durum: girdi.durum,
            limit: 200,
          })
        )
      );
      if (!r.ok) return r.hata;
      const v = r.veri;
      return {
        sayfa: v.page,
        ...kes(dizi(v.araclar), 60, (s) => alanlar(s, ARAC_AL)),
      };
    },
  },

  {
    ad: "arac_ozeti",
    kapi: "yonetici",
    uc: "/api/mobile/vehicles/[id]/ozet",
    aciklama:
      [
        "One vehicle's figures for a window: km (with the axis it came from), shift count, packages,",
        "idle time and fuel (litres, euro, L/100km). Every metric is either a number or null WITH a",
        "reason in `sebepler` — null never means zero. Needs the vehicle id from filo_araclari.",
        "Admin only.",
      ].join(" "),
    sema: {
      type: "object",
      properties: {
        aracId: { type: "string", description: "Vehicle id (uuid) from filo_araclari." },
        ...DONEM_SEMA,
      },
      required: ["aracId"],
      additionalProperties: false,
    },
    async calistir(girdi, ctx) {
      const id = String(girdi.aracId ?? "");
      const r = await coz(
        await aracOzetUc(
          istek(ctx, `/api/mobile/vehicles/${encodeURIComponent(id)}/ozet`, {
            donem: girdi.donem,
            tarih: girdi.tarih,
          }),
          { params: Promise.resolve({ id }) }
        )
      );
      if (!r.ok) return r.hata;
      return alanlariAt(r.veri, ["ok", "aracId"]);
    },
  },

  {
    ad: "is_emirleri",
    kapi: "filo",
    uc: "/api/mobile/is-emirleri",
    aciklama:
      [
        "Work-order / fault-report queue: plate, description (the reporter's own words), status,",
        "priority, source (driver report, DVIR, DTC, periodic, manual), who reported it, cost, and",
        "open/close timestamps. Defaults to OPEN orders only; pass durum=hepsi for the archive.",
      ].join(" "),
    sema: {
      type: "object",
      properties: {
        durum: {
          type: "string",
          description: "Status filter; 'hepsi' includes closed ones. Default: open only.",
        },
        oncelik: { type: "string", description: "Priority filter." },
        arac: { type: "string", description: "Vehicle id (uuid) to narrow to one vehicle." },
      },
      additionalProperties: false,
    },
    async calistir(girdi, ctx) {
      const r = await coz(
        await isEmriUc(
          istek(ctx, "/api/mobile/is-emirleri", {
            durum: girdi.durum,
            oncelik: girdi.oncelik,
            arac: girdi.arac,
            limit: 200,
          })
        )
      );
      if (!r.ok) return r.hata;
      const v = r.veri;
      return {
        sayfa: v.page,
        ...kes(dizi(v.emirler), 40, (s) => alanlar(s, IS_EMRI_AL)),
      };
    },
  },

  {
    ad: "izin_takvimi",
    kapi: "filo",
    uc: "/api/mobile/leaves",
    aciklama:
      [
        "One calendar month of leave: the people in scope (including those who left during that",
        "month) and every leave record touching the month, with type, start/end date and status",
        "(pending leave IS included and marked). Rejected records are never returned.",
      ].join(" "),
    sema: {
      type: "object",
      properties: {
        ay: { type: "string", description: "YYYY-MM. Defaults to the current month." },
      },
      additionalProperties: false,
    },
    async calistir(girdi, ctx) {
      const r = await coz(await izinUc(istek(ctx, "/api/mobile/leaves", { ay: girdi.ay })));
      if (!r.ok) return r.hata;
      const v = r.veri;
      const kisiler = dizi(v.kisiler);
      const adlar = new Map(kisiler.map((k) => [k.id as string, k.ad as string]));
      return {
        kapsam: v.kapsam,
        ay: v.ay,
        aralik: v.aralik,
        kadro: kes(kisiler, 60, (k) => alanlariAt(k, ["id"])),
        ...kes(dizi(v.izinler), 80, (l) => ({
          ad: adlar.get(l.personelId as string) ?? null,
          ...alanlariAt(l, ["id", "personelId"]),
        })),
        turler: dizi(v.turler).map((t) => alanlar(t, ["anahtar", "etiket", "ucretli"])),
      };
    },
  },

  {
    ad: "mevzuat_panosu",
    kapi: "filo",
    uc: "/api/mobile/mevzuat",
    aciklama:
      [
        "Working-time compliance board: the active rule set and its thresholds, who is on shift",
        "right now with how much time left before a limit, how many shifts have been open longer",
        "than 24h, the warning ledger for the last days, and driver document expiry counts.",
        "The ledger is immutable by design — there is no way to close or delete a warning.",
      ].join(" "),
    sema: {
      type: "object",
      properties: {
        gun: {
          type: "integer",
          description: "How many past days of the warning ledger to read. Default: server default.",
        },
        sofor: { type: "string", description: "Driver id (uuid) to narrow to one person." },
      },
      additionalProperties: false,
    },
    async calistir(girdi, ctx) {
      const r = await coz(
        await mevzuatUc(
          istek(ctx, "/api/mobile/mevzuat", {
            gun: girdi.gun,
            sofor: girdi.sofor,
            limit: 100,
          })
        )
      );
      if (!r.ok) return r.hata;
      const v = r.veri;
      const canli = (v.canli ?? {}) as Govde;
      const uyarilar = (v.uyarilar ?? {}) as Govde;
      const belgeler = (v.belgeler ?? {}) as Govde;
      return {
        kapsam: v.kapsam,
        ayar: alanlariAt(v.ayar as Govde, ["kuralSetleri"]),
        canli: {
          ...alanlariAt(canli, ["satirlar"]),
          ...kes(dizi(canli.satirlar), 40, (s) => alanlariAt(s, ["workerId", "entryId"])),
        },
        uyarilar: {
          sayfa: uyarilar.page,
          pencereGun: uyarilar.pencereGun,
          tabloYok: uyarilar.tabloYok,
          ...kes(dizi(uyarilar.satirlar), 40, (s) => alanlariAt(s, ["id", "workerId"])),
        },
        belgeler: alanlariAt(belgeler, ["satirlar"]),
        sinirlar: v.sinirlar,
      };
    },
  },
];

/**
 * `/analytics` toplam bloğu — sahipsiz olayın araç dökümü kesilir, geri kalan
 * olduğu gibi taşınır. Kesme `sahipsizOlay.sahipsiz` sayısını DEĞİŞTİRMEZ.
 */
function toplamDaralt(toplam: Govde | null | undefined): Govde | null {
  if (!toplam) return null;
  const sahipsiz = (toplam.sahipsizOlay ?? null) as Govde | null;
  return {
    ...alanlariAt(toplam, ["sahipsizOlay"]),
    ...(sahipsiz
      ? {
          sahipsizOlay: {
            ...alanlariAt(sahipsiz, ["araclar"]),
            ...kes(dizi(sahipsiz.araclar), 10, (a) => alanlariAt(a, ["aracId"])),
          },
        }
      : {}),
  };
}

/**
 * Bu aktörün çağırabileceği araçlar.
 *
 * ⚠️ BU BİR GÜVENLİK KAPISI DEĞİL. Güvenliği ucun kendi kapısı sağlıyor (§1b);
 * burası yalnız modele görünmeyen bir aracı çağırtmama kolaylığı. İkisini
 * karıştırıp ucun kapısını gevşetmek, tek koruma katmanını silmek olurdu.
 */
export function araclarFor(yonetici: boolean): readonly AsistanArac[] {
  return yonetici ? ARACLAR : ARACLAR.filter((a) => a.kapi === "filo");
}

export function aracBul(ad: string): AsistanArac | undefined {
  return ARACLAR.find((a) => a.ad === ad);
}

/** Anthropic `tools` dizisi. Sıra SABİT — ön ek önbelleği sıraya duyarlıdır. */
export function aracSemalari(
  liste: readonly AsistanArac[]
): { name: string; description: string; input_schema: AsistanArac["sema"] }[] {
  return liste.map((a) => ({
    name: a.ad,
    description: a.aciklama,
    input_schema: a.sema,
  }));
}

/** Dil, araç katmanını ETKİLEMEZ — sayılar dilden bağımsızdır. İmza belgesel. */
export type AsistanDil = Locale;
