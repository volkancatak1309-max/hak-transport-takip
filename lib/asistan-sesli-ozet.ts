import { alarmKademe } from "@/lib/event-ui";
import { haversineM } from "@/lib/geo";

/**
 * SESLİ ASİSTAN — SAF ÖZET HESAPLARI (Faz 1c, 03.10.2026).
 *
 * Araçların (`lib/asistan-sesli-araclar.ts`) uç yanıtından modele giden ÖZETİ kuran
 * kısımları. Ağ, veritabanı, saat okumaz: girdi uç gövdesi (ve "bugün"), çıktı özet. Bu
 * yüzden `scripts/check-asistan-sesli-ozet.mjs` onları veritabanı olmadan, örnek uç
 * gövdeleriyle sınar.
 *
 * Kural (Faz 1b'den): özet, uygulamada aynı sayıyı gösteren ekranın KURALIYLA sayılır;
 * yeni bir tanım uydurulmaz; ölçülemeyen sayı `null` kalır.
 */

export type Govde = Record<string, unknown>;

export const dizi = (v: unknown): Govde[] => (Array.isArray(v) ? (v as Govde[]) : []);

export function alanlar(nesne: Govde, alinacak: readonly string[]): Govde {
  const cikti: Govde = {};
  for (const k of alinacak) if (nesne[k] !== undefined) cikti[k] = nesne[k];
  return cikti;
}

export function alanlariAt(nesne: Govde, atilacak: readonly string[]): Govde {
  const cikti: Govde = {};
  for (const [k, v] of Object.entries(nesne)) if (!atilacak.includes(k)) cikti[k] = v;
  return cikti;
}

/** Listeyi keser ve kesildiyse SÖYLER (`kirpildi`). */
export function kes(satirlar: Govde[], tavan: number, donustur: (s: Govde) => Govde) {
  return {
    satirlar: satirlar.slice(0, tavan).map(donustur),
    satirTavani: tavan,
    kirpildi: satirlar.length > tavan,
  };
}

/** Bir dizideki değerlerin sayımı: `{ tamamlandi: 2, yolda: 1 }`. Yalnız SAYMA. */
export function say(degerler: unknown[]): Record<string, number> {
  const sayim: Record<string, number> = {};
  for (const d of degerler) {
    const k = String(d ?? "bilinmiyor");
    sayim[k] = (sayim[k] ?? 0) + 1;
  }
  return sayim;
}

/** Konuşulan plaka ile kayıttaki plakayı karşılaştırmak için: büyük harf, yalnız A-Z0-9. */
export const plakaAnahtari = (p: unknown): string => String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Sayfalı ucun listesi tam mı (`page.total` dönen satır sayısını aşmıyor mu). */
export function tamMi(veri: Govde, satir: number): boolean {
  const toplam = Number(((veri.page ?? {}) as Govde).total ?? satir);
  return Number.isFinite(toplam) && toplam <= satir;
}

export const bir = (n: number) => Math.round(n * 10) / 10;

// ── harita şeridi ────────────────────────────────────────────────────────────

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

export function hareketDurumu(a: Govde): "yolda" | "duruyor" | "sinyal_yok" {
  const yas = typeof a.sonSinyalMs === "number" ? a.sonSinyalMs : undefined;
  if (yas !== undefined && yas >= SINYAL_YOK_MS) return "sinyal_yok";
  return a.durum === YOLDA_DURUMU ? "yolda" : "duruyor";
}

// ── tarih ───────────────────────────────────────────────────────────────────

const TARIH = /^\d{4}-\d{2}-\d{2}$/;

export function gecerliTarih(s: unknown): s is string {
  if (typeof s !== "string" || !TARIH.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function gunKaydir(ymd: string, gun: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + gun);
  return d.toISOString().slice(0, 10);
}

export const GUN_KAYMASI = { dun: -1, bugun: 0, yarin: 1 } as const;
export type Gun = keyof typeof GUN_KAYMASI;

/**
 * Faz 1c (Test 2): "dün çalışmayan araç", "yarınki seferler" gibi tarihli sorular.
 * `tarih` verildiyse o (takvimde var mı denetlenir), yoksa `gun` (dün/bugün/yarın), yoksa
 * bugün. `bugun` kiracının günüdür (çağıran verir). Model tarihi kendisi hesaplamak
 * zorunda kalmaz; "dün" demek yeter.
 */
export function gunCoz(girdi: Govde, bugun: string): { ok: true; tarih: string; bugun: string } | { ok: false; hata: Govde } {
  if (girdi.tarih !== undefined && girdi.tarih !== null && girdi.tarih !== "") {
    if (!gecerliTarih(girdi.tarih)) {
      return { ok: false, hata: { hata: "gecersiz_arguman", alan: "tarih", bicim: "YYYY-MM-DD" } };
    }
    return { ok: true, tarih: girdi.tarih, bugun };
  }
  const kayma = GUN_KAYMASI[(girdi.gun ?? "bugun") as Gun] ?? 0;
  return { ok: true, tarih: gunKaydir(bugun, kayma), bugun };
}

// ── yer adı ─────────────────────────────────────────────────────────────────

/**
 * KOORDİNAT SÖYLENMEZ (Test 2: GPT-Live enlem/boylamı rakam rakam okudu). Panelde ters
 * kodlama (adres çözümü) YOK — ne harita ne rota sayfası adres üretiyor. Elde olan tek
 * "yer adı" kaynağı panelin BÖLGELERİ (geofence: depo, müşteri, yasak bölge…; merkez +
 * yarıçap). Sıra Volkan'ın kuralıyla:
 *   1) araç bir bölgenin İÇİNDE → o bölgenin adı (iç içe bölgede en küçüğü);
 *   2) değilse merkezi ≤ 10 km olan en yakın bölge → "X'e N km";
 *   3) değilse → adres yok.
 * Bugünkü durak adresleri kullanılmadı: araç başına ek uç çağrısı gerekir (hız hedefi).
 */
export const YAKIN_TAVAN_M = 10_000;

export type Bolge = { ad: string; kategori: unknown; lat: number; lng: number; yaricapM: number };

/** `/api/mobile/geofences` gövdesi → etkin, arşivlenmemiş, koordinatlı bölgeler. */
export function bolgeListesi(veri: Govde): Bolge[] {
  const sonuc: Bolge[] = [];
  for (const b of dizi(veri.bolgeler)) {
    if (b.aktif === false || b.archivedAt) continue;
    const { lat, lng, yaricapM } = b;
    if (typeof lat !== "number" || typeof lng !== "number" || typeof yaricapM !== "number") continue;
    sonuc.push({ ad: String(b.ad ?? ""), kategori: b.kategori ?? null, lat, lng, yaricapM });
  }
  return sonuc;
}

export function yerBul(konum: unknown, bolgeler: Bolge[] | null): Govde {
  const k = (konum ?? null) as { lat?: unknown; lng?: unknown } | null;
  if (!k || typeof k.lat !== "number" || typeof k.lng !== "number") return { tur: "konum_yok" };
  if (!bolgeler) return { tur: "adres_yok" };
  let icinde: Bolge | null = null;
  let yakin: { b: Bolge; m: number } | null = null;
  for (const b of bolgeler) {
    const m = haversineM(k.lat, k.lng, b.lat, b.lng);
    if (m <= b.yaricapM) {
      if (!icinde || b.yaricapM < icinde.yaricapM) icinde = b;
    } else if (m <= YAKIN_TAVAN_M && (!yakin || m < yakin.m)) {
      yakin = { b, m };
    }
  }
  if (icinde) return { tur: "bolgede", ad: icinde.ad, kategori: icinde.kategori };
  if (yakin) return { tur: "yakininda", ad: yakin.b.ad, kategori: yakin.b.kategori, mesafeKm: bir(yakin.m / 1000) };
  return { tur: "adres_yok" };
}

// ── aksiyon merkezi ─────────────────────────────────────────────────────────

export type Kademe = "kritik" | "uyari" | "rutin";

/**
 * MOBİL AKSİYON MERKEZİNİN KADEMELERİ — `galzura-fleet-app/lib/attention.ts`
 * (`TIER_BY_KIND`, `tierOf`) ve `lib/action-center.ts` (tehlike → kritik, süre → uyarı,
 * bilgi → rutin). Belge türleri (muayene, sigorta, ehliyet) KALAN GÜNDEN: geçmişse
 * kritik, değilse uyarı. Tanınmayan tür uyarı. Alarmlar panelin `ALARM_KADEME`'si
 * (`alarmKademe`). Burada yeni bir aciliyet tanımı YOK.
 */
export const DIKKAT_KADEME: Record<string, Kademe> = {
  overLimit: "kritik",
  silent: "kritik",
  penalty: "kritik",
  movingNoShift: "kritik",
  unassignedMoving: "kritik",
  driverless: "kritik",
  dtc: "kritik",
  break45: "uyari",
  undelivered: "rutin",
  locationUnverified: "rutin",
  startEstimated: "rutin",
  vehicleIdle: "rutin",
  manualStart: "rutin",
};
export const BELGE_TURLERI = new Set(["inspection", "insurance", "license"]);

/**
 * Tür adları İNGİLİZCE: model kullanıcının dilinde söyler (Türkçe/Almanca). Kod değil,
 * anlam veriyoruz ("overspeeding" yerine "speeding") — sesli cevapta kod okunmasın.
 */
export const TUR_ADI: Record<string, string> = {
  crash: "crash",
  towing: "towing (moved with ignition off)",
  jamming: "GPS signal jamming",
  unplug: "tracker unplugged",
  overspeeding: "speeding",
  harsh_braking: "harsh braking",
  harsh_acceleration: "harsh acceleration",
  harsh_cornering: "harsh cornering",
  idling: "idling",
  overLimit: "daily working-time limit exceeded",
  break45: "45-minute break missing",
  secondShift: "second shift on the same day",
  inspection: "vehicle inspection due",
  insurance: "insurance due",
  license: "driving licence expiring",
  document: "driver document expiring",
  undelivered: "undelivered packages",
  penalty: "unpaid traffic fines",
  kmUnmeasured: "km not measurable",
  silent: "no signal for 24+ hours",
  movingNoShift: "vehicle moving without an open shift",
  unassignedMoving: "vehicle moving with no assigned driver",
  driverless: "vehicle still assigned to a driver who has left",
  locationUnverified: "shift start location not verified",
  startEstimated: "shift start time estimated",
  vehicleIdle: "vehicle not used",
  manualStart: "shift started manually",
  maintenanceDue: "maintenance due",
  workOrder: "open work order",
  dtc: "active fault codes",
};

type TurSayimi = { tur: string; ad: string; kaynak: "alarm" | "dikkat"; kademe: Kademe; adet: number };

/**
 * `/api/mobile/dashboard` + `/api/mobile/alarms?range=gun` gövdeleri → aksiyon özeti.
 * Dikkat listesinin tür sayıları `uyari.tur`dan (TAM toplam); belge kalemlerinin kademesi
 * `uyari.kalemler`deki kalan günden (kalemler tür başına tavanlı → tavan dışı kalan
 * belge kalemi "kademesi ölçülemeyen" olarak söylenir). Arıza kodlu araçlar ayrı `dtc[]`
 * dizisinde gelir; uygulama onları aynı listeye araç başına bir `dtc` kalemi olarak katar.
 * `alarm` null → alarmlar ölçülemedi.
 */
export function aksiyonOzeti(pano: Govde, alarm: Govde | null) {
  const uyari = (pano.uyari ?? {}) as Govde;
  const turler = (uyari.tur ?? {}) as Record<string, unknown>;
  const kalemler = dizi(uyari.kalemler);

  const sayim: TurSayimi[] = [];
  let kademesiBelirsiz = 0;
  const ekle = (tur: string, kaynak: TurSayimi["kaynak"], kademe: Kademe, adet: number) => {
    if (adet > 0) sayim.push({ tur, ad: TUR_ADI[tur] ?? tur, kaynak, kademe, adet });
  };
  for (const [tur, adet] of Object.entries(turler)) {
    if (typeof adet !== "number") continue;
    if (BELGE_TURLERI.has(tur)) {
      const liste = kalemler.filter((k) => k.tur === tur);
      const gecmis = liste.filter((k) => typeof k.kalanGun === "number" && k.kalanGun < 0).length;
      ekle(tur, "dikkat", "kritik", gecmis);
      ekle(tur, "dikkat", "uyari", liste.length - gecmis);
      kademesiBelirsiz += Math.max(0, adet - liste.length);
    } else {
      ekle(tur, "dikkat", DIKKAT_KADEME[tur] ?? "uyari", adet);
    }
  }
  ekle("dtc", "dikkat", "kritik", typeof pano.dtcAracSayisi === "number" ? pano.dtcAracSayisi : 0);
  if (alarm) {
    for (const [tur, adet] of Object.entries((alarm.turDagilim ?? {}) as Record<string, unknown>)) {
      if (typeof adet === "number") ekle(tur, "alarm", alarmKademe(tur), adet);
    }
  }

  const toplam = (k: Kademe) => sayim.filter((s) => s.kademe === k).reduce((t, s) => t + s.adet, 0);
  const enCokTurler = sayim
    .filter((s) => s.kademe !== "rutin")
    .sort((a, b) => b.adet - a.adet)
    .slice(0, 3)
    .map((s) => ({ ad: s.ad, kademe: s.kademe, adet: s.adet }));
  const kritikKalemler = kalemler
    .filter(
      (k) =>
        DIKKAT_KADEME[String(k.tur)] === "kritik" ||
        (BELGE_TURLERI.has(String(k.tur)) && typeof k.kalanGun === "number" && k.kalanGun < 0)
    )
    .slice(0, 6)
    .map((k) => ({ ad: TUR_ADI[String(k.tur)] ?? k.tur, ...alanlar(k, ["plaka", "sofor", "kalanGun", "adet", "saat"]) }));

  return {
    ozet: {
      kritik: toplam("kritik"),
      uyari: toplam("uyari"),
      rutin: toplam("rutin"),
      onayBekleyenIzin: ((pano.onayBekleyen ?? {}) as Govde).izin ?? null,
      ertelenen: pano.ertelemeToplam ?? null,
      enCokTurler,
      ...(kademesiBelirsiz > 0 ? { kademesiOlculemeyen: kademesiBelirsiz } : {}),
      ...(alarm ? {} : { alarmlar: "olculemedi" }),
    },
    alarmAraligi: "today",
    kapsam: pano.kapsam,
    kritikKalemler,
    kalemListesiKirpildi: uyari.kirpildi === true,
  };
}

// ── geçmiş gün ──────────────────────────────────────────────────────────────

/**
 * GEÇMİŞ GÜN (Faz 1c): "dün çalışmayan araç hangisi?". Tanım VARDİYADAN: o gün en az bir
 * vardiya açılan araç çalıştı sayılır (`/api/mobile/shifts?from=&to=`, panelin vardiya
 * listesiyle aynı elemeler). Vardiyası olup km'si ölçülmüş 0 olan araç ayrıca söylenir;
 * km ölçülemediyse `null` (sıfır DEĞİL). Geçmiş gün için canlı durum/konum YOKTUR.
 * Liste 200 satırda kesilirse "çalışmayan" sayısı ÖLÇÜLEMEZ → null.
 */
export function gecmisGunOzeti(tarih: string, filo: Govde, vardiya: Govde, plaka: unknown) {
  const araclar = dizi(filo.araclar);
  const vardiyalar = dizi(vardiya.vardiyalar);
  const filoTam = tamMi(filo, araclar.length);
  const vardiyaTam = tamMi(vardiya, vardiyalar.length);

  const aracBasi = new Map<string, { vardiya: number; km: number; kmOlculemeyen: number }>();
  for (const v of vardiyalar) {
    if (!v.aracId) continue;
    const id = String(v.aracId);
    const s = aracBasi.get(id) ?? { vardiya: 0, km: 0, kmOlculemeyen: 0 };
    s.vardiya += 1;
    if (typeof v.km === "number") s.km += v.km;
    else s.kmOlculemeyen += 1;
    aracBasi.set(id, s);
  }
  const p = plakaAnahtari(plaka);
  const uygun = (a: Govde) => !p || plakaAnahtari(a.plaka).includes(p);
  const istatistik = (a: Govde) => aracBasi.get(String(a.id));
  const vardiyasiz = araclar.filter((a) => !istatistik(a));
  const vardiyali = araclar.filter((a) => istatistik(a));
  const sifirKm = vardiyali.filter((a) => {
    const s = istatistik(a);
    return !!s && s.kmOlculemeyen === 0 && s.km === 0;
  });

  return {
    mod: "gecmis_gun",
    tarih,
    tanim: "worked = at least one shift was started with the vehicle that day (shift records); no live status or position for past days",
    ozet: {
      toplamArac: filoTam ? araclar.length : null,
      vardiyaAcilanArac: vardiyaTam ? vardiyali.length : null,
      vardiyaAcilmayanArac: vardiyaTam && filoTam ? vardiyasiz.length : null,
      vardiyaliAmaSifirKm: vardiyaTam ? sifirKm.length : null,
      vardiyaSayisi: Number(((vardiya.page ?? {}) as Govde).total ?? vardiyalar.length),
    },
    vardiyaAcilmayanlar: vardiyaTam ? kes(vardiyasiz.filter(uygun), 30, (a) => alanlar(a, ["plaka", "durum"])) : null,
    vardiyaliAmaSifirKm: sifirKm.filter(uygun).slice(0, 15).map((a) => a.plaka),
    vardiyaAcilanlar: kes(vardiyali.filter(uygun), 30, (a) => {
      const s = istatistik(a)!;
      return {
        plaka: a.plaka,
        vardiya: s.vardiya,
        km: s.vardiya === s.kmOlculemeyen ? null : Math.round(s.km),
        kmOlculemeyenVardiya: s.kmOlculemeyen,
      };
    }),
    ...(vardiyaTam ? {} : { eksik: "vardiya_listesi_kirpildi" }),
  };
}
