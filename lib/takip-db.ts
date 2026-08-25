import "server-only";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu, kolonYokMu } from "@/lib/fault-reports";
import { haversineM } from "@/lib/geo";
import {
  TAKIP_LINK_TTL_MIN,
  TAKIP_SOFOR_ADI,
  TAKIP_VARSAYILAN_HIZ_KMS,
  TAKIP_VARSAYILAN_SERVIS_DK,
  TAKIP_SIRA_ESIGI,
  TAKIP_YOL_KATSAYISI,
} from "@/lib/tenant";
import {
  etaHesapla,
  durakEtaHesapla,
  konumBayatMi,
  type EtaSonuc,
  type ZincirDuragi,
} from "@/lib/takip-eta";
import {
  seferHedefi,
  listDuraklar,
  durakHedefleri,
  DURAK_ACIK,
  type DurakRow,
} from "@/lib/sefer-duraklari";

/**
 * MÜŞTERİ CANLI TAKİP LİNKİ — veri katmanı (migration 079).
 *
 * ═══ EN AZ VERİ İLKESİ, KODLA UYGULANIYOR ═══
 *
 * Girişsiz sayfaya giden gövde bu dosyada kuruluyor ve içinde plaka, şoför
 * adı, filo kodu, araç kimliği ya da başka bir seferin izi YOKTUR. Bu bir
 * "ekranda gizleme" değil: alanlar sunucudan HİÇ ÇIKMAZ. Gizlemek olsaydı
 * sayfa kaynağında durur, HTML'e bakan herkes okurdu.
 *
 * ⚠️ `vehicle_id` bile dönmüyor. Müşterinin elindeki kimlik yalnız TOKEN'dır;
 * araç kimliğini vermek, iki linki karşılaştıran birine "aynı araç" dedirtir
 * ve filo büyüklüğü/rotası hakkında çıkarım kapısı açardı.
 *
 * ═══ ŞOFÖR ADI — HUKUKİ ANAHTAR ═══
 *
 * `TAKIP_SOFOR_ADI` varsayılan KAPALI (lib/tenant.ts'teki gerekçe: AT DSG §10,
 * DE BetrVG §87). Kapalıyken sorgu adı OKUMAZ bile.
 *
 * ═══ 079 YOKSA ═══
 *
 * Tüm yollar `tabloYok` ile boş döner; sefer ve panel etkilenmez. Aynı kademeli
 * düşüş 056/058/077/078'de de var.
 */

/** URL'deki gizli parçanın uzunluğu (bayt) — base64url'de 43 karakter. */
const TOKEN_BAYT = 32;

/**
 * ⚠️ İKİ KOLON LİSTESİ — 083 UYGULANMAMIŞ KURULUM İÇİN.
 *
 * `durak_id` / `durak_bagli` 083 ile geliyor. Koşulsuz seçmek, 083'ü
 * çalıştırmamış bir kiracıda TÜM TAKİP ÖZELLİĞİNİ 42703 ile düşürürdü — yani
 * 079 ile gelen çalışan bir şeyi yeni bir migration'a rehin almak. Okuma önce
 * yeni listeyle denenir, kolon yoksa ESKİ listeye düşer ve durum BİR KEZ
 * loglanır. Sessiz düşüş yok, kırılma da yok (lib/teslimat-db.ts aynı desen).
 */
const LINK_COLS =
  "id, sefer_id, token, expires_at, revoked_at, alici_not, created_at, created_by, hit_count, last_hit_at, durak_id, durak_bagli";
const LINK_COLS_083_ONCESI =
  "id, sefer_id, token, expires_at, revoked_at, alici_not, created_at, created_by, hit_count, last_hit_at";

let durakKolonuUyarildi = false;
function durakKolonuYok(): string {
  if (!durakKolonuUyarildi) {
    durakKolonuUyarildi = true;
    console.warn(
      "[takip-db] `sefer_takip_linkleri.durak_id` yok — migration 083 uygulanmamış. " +
        "Takip linkleri SEFER bazlı çalışmaya devam ediyor; durak bazlı link KAPALI."
    );
  }
  return LINK_COLS_083_ONCESI;
}

export type TakipLink = {
  id: string;
  seferId: string;
  token: string;
  expiresAt: string;
  revokedAt: string | null;
  aliciNot: string | null;
  createdAt: string;
  hitCount: number;
  lastHitAt: string | null;
  /** Bağlı olduğu durak (083). null + `durakBagli=false` → sefer bazlı link. */
  durakId: string | null;
  /** Bu link bir DURAĞA bağlı üretildi mi (083). */
  durakBagli: boolean;
};

function linkCevir(r: Record<string, unknown>): TakipLink {
  return {
    id: String(r.id),
    seferId: String(r.sefer_id),
    token: String(r.token),
    expiresAt: String(r.expires_at),
    revokedAt: r.revoked_at ? String(r.revoked_at) : null,
    aliciNot: r.alici_not ? String(r.alici_not) : null,
    createdAt: String(r.created_at),
    hitCount: Number(r.hit_count ?? 0),
    lastHitAt: r.last_hit_at ? String(r.last_hit_at) : null,
    // 083 öncesi kurulumda alanlar HİÇ gelmez → sefer bazlı link.
    durakId: r.durak_id ? String(r.durak_id) : null,
    durakBagli: r.durak_bagli === true,
  };
}

export type YazmaSonuc<T> =
  | { ok: true; veri: T }
  | {
      ok: false;
      sebep:
        | "tablo_yok"
        | "sefer_yok"
        | "sefer_kapali"
        | "durak_yok"
        | "durak_kapali"
        | "durak_hedefsiz"
        | "durak_ozelligi_kapali"
        | "hata";
      mesaj?: string;
    };

/**
 * Yeni link üretir — SEFER ya da DURAK bazlı (083).
 *
 * ⚠️ KAPALI SEFERE LİNK ÜRETİLMEZ. Üretilseydi doğar doğmaz ölü olurdu
 * (okuma yolu seferin durumuna bakıyor) ve yönetici çalışmayan bir link
 * göndermiş olurdu. Hata, sessiz bir ölü linkten iyidir. Aynı kural DURAK için
 * de geçerli: kapanmış (tamamlandi/atlandi) durağa link üretilmez.
 *
 * ⚠️ DURAK GERÇEKTEN BU SEFERİN Mİ — denetleniyor. Başka seferin durağına link
 * üretmek, müşteriye BAŞKA BİR MÜŞTERİNİN konumunu göstermek olurdu.
 *
 * ⚠️ HEDEFSİZ DURAĞA LİNK YOK. Yalnız adı olan (koordinatsız, bölgesiz) bir
 * durakta harita boş, ETA yok — müşteriye "bozuk" görünen bir sayfa gönderilir.
 * Panel de bu yüzden o satırda düğmeyi pasif tutuyor; sunucu son sözü söylüyor.
 */
export async function createTakipLink(
  seferId: string,
  actorWorkerId: string | null,
  aliciNot: string | null,
  durakId?: string | null
): Promise<YazmaSonuc<TakipLink>> {
  const { data: sefer, error: seferHata } = await supabaseAdmin
    .from("seferler")
    .select("id, durum")
    .eq("id", seferId)
    .maybeSingle();
  if (seferHata) {
    return { ok: false, sebep: tabloYokMu(seferHata) ? "tablo_yok" : "hata", mesaj: seferHata.message };
  }
  if (!sefer) return { ok: false, sebep: "sefer_yok" };
  const durum = String((sefer as { durum: string }).durum);
  if (durum === "tamamlandi" || durum === "iptal") {
    return { ok: false, sebep: "sefer_kapali", mesaj: durum };
  }

  // ── DURAK DENETİMİ (083) — link üretmeden ÖNCE.
  if (durakId) {
    const { duraklar, tabloYok } = await listDuraklar(seferId);
    if (tabloYok) return { ok: false, sebep: "durak_ozelligi_kapali", mesaj: "082" };
    const durak = duraklar.find((d) => d.id === durakId);
    if (!durak) return { ok: false, sebep: "durak_yok" };
    if (!DURAK_ACIK.includes(durak.durum)) {
      return { ok: false, sebep: "durak_kapali", mesaj: durak.durum };
    }
    const geo = await durakHedefleri([durak]);
    if (!geo.get(durak.id)) return { ok: false, sebep: "durak_hedefsiz" };
  }

  const token = randomBytes(TOKEN_BAYT).toString("base64url");
  const expiresAt = new Date(Date.now() + TAKIP_LINK_TTL_MIN * 60_000).toISOString();

  const yaz = (cols: string) =>
    supabaseAdmin
      .from("sefer_takip_linkleri")
      .insert({
        sefer_id: seferId,
        token,
        expires_at: expiresAt,
        alici_not: aliciNot,
        created_by: actorWorkerId,
        // ⚠️ Alanlar YALNIZ durak bazlı linkte gönderiliyor: 083 uygulanmamış
        // kurulumda kolonlar YOK ve null göndermek insert'i 42703 ile düşürürdü.
        ...(durakId ? { durak_id: durakId, durak_bagli: true } : {}),
      })
      .select(cols)
      .maybeSingle();

  let { data, error } = await yaz(LINK_COLS);
  if (error && kolonYokMu(error)) {
    // 083 yok. Durak bazlı link İSTENDİYSE sessizce sefer bazlı üretmeyiz —
    // müşteriye yanlış durağın ETA'sı gider. Açıkça reddediyoruz.
    if (durakId) return { ok: false, sebep: "durak_ozelligi_kapali", mesaj: "083" };
    ({ data, error } = await yaz(durakKolonuYok()));
  }
  if (error || !data) {
    return {
      ok: false,
      sebep: error && tabloYokMu(error) ? "tablo_yok" : "hata",
      mesaj: error?.message,
    };
  }
  return { ok: true, veri: linkCevir(data as unknown as Record<string, unknown>) };
}

/** Seferin linkleri — YÖNETİCİ yüzeyi (token dahil: yeniden gönderilebilsin). */
export async function listTakipLinks(
  seferId: string
): Promise<{ linkler: TakipLink[]; tabloYok: boolean }> {
  const oku = (cols: string) =>
    supabaseAdmin
      .from("sefer_takip_linkleri")
      .select(cols)
      .eq("sefer_id", seferId)
      .order("created_at", { ascending: false });

  let { data, error } = await oku(LINK_COLS);
  if (error && kolonYokMu(error)) ({ data, error } = await oku(durakKolonuYok()));
  if (error) return { linkler: [], tabloYok: tabloYokMu(error) };
  return {
    linkler: ((data ?? []) as unknown as Record<string, unknown>[]).map(linkCevir),
    tabloYok: false,
  };
}

/**
 * Linki iptal eder. İdempotent: zaten iptalliyse damga TAZELENMEZ.
 *
 * `revoked_at is null` koşulu bilerek: ikinci iptal "ne zaman iptal edildi"
 * cevabını bugüne kaydırırdı.
 */
export async function revokeTakipLink(
  linkId: string,
  actorWorkerId: string | null
): Promise<YazmaSonuc<{ etkilenen: number }>> {
  const { data, error } = await supabaseAdmin
    .from("sefer_takip_linkleri")
    .update({ revoked_at: new Date().toISOString(), revoked_by: actorWorkerId })
    .eq("id", linkId)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error.message };
  }
  return { ok: true, veri: { etkilenen: (data ?? []).length } };
}

/**
 * BİR DURAĞIN AÇIK LİNKLERİNİ TOPLUCA İPTAL ET (083).
 *
 * ═══ NEDEN VAR — DURAK SİLİNMEDEN ÖNCE ÇAĞRILIYOR ═══
 *
 * Durak silinince FK `durak_id`yi NULL'a çeker ve link "durağı silinmiş" hâline
 * düşer; okuma yolu ona `durak_kapandi` der. Doğru ama YETERSİZ: müşterinin
 * gördüğü cümle "gönderen bu linki kapattı" olmalı, çünkü olan tam olarak
 * budur. Bu yüzden silme yolu ÖNCE iptal ediyor — 083 kolon ayrımı yalnız ham
 * SQL ile silinme hâlinin emniyet ağı olarak kalıyor.
 *
 * İdempotent: zaten iptalli linklerin damgası TAZELENMEZ.
 * 083 yoksa (kolon yok) sessizce 0 döner — durak bazlı link zaten üretilemiyor.
 */
export async function revokeDurakLinks(
  durakId: string,
  actorWorkerId: string | null
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("sefer_takip_linkleri")
    .update({ revoked_at: new Date().toISOString(), revoked_by: actorWorkerId })
    .eq("durak_id", durakId)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    if (!kolonYokMu(error) && !tabloYokMu(error)) {
      console.warn(`[takip-db] durak linkleri iptal edilemedi (${durakId}): ${error.message}`);
    }
    return 0;
  }
  return (data ?? []).length;
}

// ── GİRİŞSİZ OKUMA ────────────────────────────────────────────────────────

/** Linkin neden çalışmadığı — ekran her birine ayrı cümle yazar. */
export type TakipKapali =
  | "bulunamadi"
  | "suresi_doldu"
  | "iptal_edildi"
  | "sefer_kapandi"
  /**
   * DÖRDÜNCÜ ÖLÜM YOLU (083): bağlı olduğu DURAK kapandı — tamamlandı,
   * atlandı ya da plandan silindi.
   *
   * ⚠️ HANGİSİ OLDUĞU SÖYLENMEZ. "Teslimat yapıldı" ile "durak atlandı" müşteri
   * için çok farklı iki haber ve ikisini de SATICI bildirmeli — bir takip linki
   * bildirim kanalı değildir. Ayrıca "atlandı" demek, şoförün o gün ne yaptığını
   * girişsiz bir sayfadan sızdırmak olurdu (079'un en az veri ilkesi).
   */
  | "durak_kapandi"
  | "tablo_yok";

/**
 * Girişsiz sayfaya giden GÖVDE.
 *
 * Alan listesi bilerek KISA. Buraya bir alan eklemek, onu linke tıklayan
 * herkese vermektir — eklemeden önce "müşteri bunu görmeli mi" değil,
 * "GÖRMESİ ŞART mı" diye sorun.
 */
export type TakipGorunum = {
  /** Sefer durumu — yalnız üç değere indirgenmiş hâli. */
  durum: "hazirlaniyor" | "yolda" | "vardi";
  /** Aracın son bilinen konumu; cihaz hiç veri göndermediyse null. */
  konum: { lat: number; lng: number; anISO: string; bayat: boolean } | null;
  /**
   * Hedefin merkezi — müşteri zaten kendi adresini bilir.
   * ⚠️ DURAK BAZLI linkte bu MÜŞTERİNİN KENDİ DURAĞIdır, aracın sıradaki durağı
   * DEĞİL. 083'ün varlık sebebi tam olarak bu ayrım.
   */
  hedef: { lat: number; lng: number; yaricapM: number } | null;
  /**
   * Tahmini varış; hedef ya da konum yoksa null.
   *
   * ⚠️ ZİNCİR SONUCU DOĞRUDAN ATANMAZ. `durakEtaHesapla` fazladan iki alan
   * döndürüyor (`onunuzdeDurak`, `kaba`) ve nesneyi olduğu gibi buraya koymak
   * onları JSON'a SIZDIRIRDI — üstelik `onunuzdeDurak` eşiği (TAKIP_SIRA_ESIGI)
   * atlayarak. Alanlar tek tek yansıtılıyor; "ne çıkıyor" sorusu okunarak
   * cevaplanabilsin.
   */
  eta: EtaSonuc | null;
  /** Zincirde koordinatsız durak vardı → tahmin kaba. Ekran dili yumuşar. */
  etaKaba: boolean;
  /** Linkin bitiş anı — sayfa "bu link X'te kapanır" der. */
  linkBitisISO: string;
  /** YALNIZ kiracı açıkça izin verdiyse dolu (TAKIP_SOFOR_ADI). */
  soforAdi: string | null;
  /**
   * Bu link bir DURAĞA mı bağlı (083). Ekran dilini belirler: durak bazlı
   * linkte "sizin durağınız", sefer bazlıda eski genel cümle.
   */
  durakBagli: boolean;
  /**
   * "Önünüzde N durak var" — Onfleet'in aynı öğesi (bkz. TAKIP_SIRA_ESIGI).
   *
   * ⚠️ SIZINTI SINIRI: müşteriye kendi durağının SIRA NUMARASI da turdaki
   * TOPLAM durak sayısı da GÖNDERİLMEZ; yalnız önünde kaç tane kaldığı.
   * Sıra + toplam, rota büyüklüğünü ve müşterinin turdaki yerini ele verirdi.
   * Eşiğin üstünde ya da sefer bazlı linkte null.
   */
  onunuzdeDurak: number | null;
  /**
   * Müşterinin KENDİ durağının zaman penceresi (varsa). Kendi kısıtı olduğu
   * için sızıntı değil; başka durağın penceresi ASLA gönderilmez.
   */
  pencere: { bas: string | null; bit: string | null } | null;
};

export type TakipOkuma =
  | { ok: true; gorunum: TakipGorunum }
  | { ok: false; sebep: TakipKapali };

/**
 * Token → görünüm. Girişsiz yolun TEK okuma noktası.
 *
 * Sıra önemli: önce linkin kendisi, sonra sefer, en son telemetri. Ölü bir
 * link için araç konumu SORGULANMAZ — hem gereksiz yük, hem de "geçersiz
 * token'a ne kadar sürede cevap dönüyor" farkını küçültür.
 */
export async function readTakipByToken(token: string, simdi = new Date()): Promise<TakipOkuma> {
  // 1) LİNK — anahtarlı okuma (unique indeks).
  const linkOku = (cols: string) =>
    supabaseAdmin.from("sefer_takip_linkleri").select(cols).eq("token", token).maybeSingle();

  let { data: linkRow, error: linkHata } = await linkOku(
    "id, sefer_id, expires_at, revoked_at, durak_id, durak_bagli"
  );
  // 083 yoksa durak alanları olmadan oku — takip 079 davranışını sürdürür.
  if (linkHata && kolonYokMu(linkHata)) {
    durakKolonuYok();
    ({ data: linkRow, error: linkHata } = await linkOku("id, sefer_id, expires_at, revoked_at"));
  }
  if (linkHata) {
    return { ok: false, sebep: tabloYokMu(linkHata) ? "tablo_yok" : "bulunamadi" };
  }
  if (!linkRow) return { ok: false, sebep: "bulunamadi" };
  const link = linkRow as unknown as {
    id: string;
    sefer_id: string;
    expires_at: string;
    revoked_at: string | null;
    durak_id?: string | null;
    durak_bagli?: boolean | null;
  };
  if (link.revoked_at) return { ok: false, sebep: "iptal_edildi" };
  if (Date.parse(link.expires_at) <= simdi.getTime()) {
    return { ok: false, sebep: "suresi_doldu" };
  }

  // 2) SEFER — durum ve hedef. Kapalıysa link de kapalıdır (türetilen gerçek).
  const { data: seferRow, error: seferHata } = await supabaseAdmin
    .from("seferler")
    .select("id, durum, vehicle_id, zone_id, worker_id, vardi_at")
    .eq("id", link.sefer_id)
    .maybeSingle();
  if (seferHata || !seferRow) return { ok: false, sebep: "bulunamadi" };
  const sefer = seferRow as {
    durum: string;
    vehicle_id: string | null;
    zone_id: string | null;
    worker_id: string;
    vardi_at: string | null;
  };
  if (sefer.durum === "tamamlandi" || sefer.durum === "iptal") {
    return { ok: false, sebep: "sefer_kapandi" };
  }

  /**
   * 3) HEDEF — yalnız GEOMETRİ. Hedefin ADI bile alınmıyor: müşteri kendi
   *    adresini biliyor, isim ise kiracının müşteri listesinden bir veri.
   *
   * İKİ YOL (083):
   *   · DURAK BAZLI link → hedef MÜŞTERİNİN KENDİ DURAĞI. Aracın sıradaki
   *     durağını göstermek, BAŞKA BİR MÜŞTERİNİN konumunu sızdırmak olurdu.
   *   · SEFER BAZLI link → 082'deki çözüm aynen: durak listesi varsa sıradaki
   *     durak, yoksa eski `seferler.zone_id`. 079'un davranışı KORUNUYOR.
   */
  const durakBagli = link.durak_bagli === true;
  let hedef: TakipGorunum["hedef"] = null;
  let eta: EtaSonuc | null = null;
  let onunuzdeDurak: number | null = null;
  let pencere: TakipGorunum["pencere"] = null;
  let etaKaba = false;
  /** Durak zinciri — ETA adımında kullanılıyor; hiçbir alanı gövdeye SIZMAZ. */
  let zincir: DurakRow[] | null = null;

  if (durakBagli) {
    // Durak SİLİNMİŞSE `durak_id` NULL'a düşer ama `durak_bagli` TRUE kalır
    // (083'ün iki kolonlu ayrımı) → link kapanmıştır.
    if (!link.durak_id) return { ok: false, sebep: "durak_kapandi" };

    const { duraklar, tabloYok: durakTabloYok } = await listDuraklar(link.sefer_id);
    if (durakTabloYok) return { ok: false, sebep: "tablo_yok" };

    const benim = duraklar.find((d) => d.id === link.durak_id);
    if (!benim) return { ok: false, sebep: "durak_kapandi" };
    // DÖRDÜNCÜ ÖLÜM YOLU: durak tamamlandı ya da atlandı.
    if (!DURAK_ACIK.includes(benim.durum)) return { ok: false, sebep: "durak_kapandi" };

    /**
     * ZİNCİR: aracın önündeki AÇIK duraklar, sırayla, müşterininki DAHİL ve
     * SONUNCUSU. Kapanmış duraklar zincire girmez — araç oraya gitmeyecek.
     */
    zincir = duraklar
      .filter((d) => DURAK_ACIK.includes(d.durum) && d.sira <= benim.sira)
      .sort((a, b) => a.sira - b.sira);

    const geo = await durakHedefleri(zincir);
    const benimGeo = geo.get(benim.id);
    hedef = benimGeo
      ? { lat: benimGeo.lat, lng: benimGeo.lng, yaricapM: benimGeo.yaricapM }
      : null;

    // Zaman penceresi: müşterinin KENDİ kısıtı, sızıntı değil.
    if (benim.pencere_bas || benim.pencere_bit) {
      pencere = { bas: benim.pencere_bas, bit: benim.pencere_bit };
    }

    /**
     * "ÖNÜNÜZDE N DURAK VAR" — eşiğin ÜSTÜNDE gösterilmez (TAKIP_SIRA_ESIGI,
     * Onfleet'in aynı ayarı). Eşik 0 ise özellik tamamen kapalıdır.
     */
    const onunde = zincir.length - 1;
    if (TAKIP_SIRA_ESIGI > 0 && onunde <= TAKIP_SIRA_ESIGI) onunuzdeDurak = onunde;
  } else {
    const cozulen = await seferHedefi({ id: link.sefer_id, zone_id: sefer.zone_id });
    hedef = cozulen
      ? { lat: cozulen.lat, lng: cozulen.lng, yaricapM: cozulen.yaricapM }
      : null;
  }

  // 4) KONUM — tek aracın son noktası, ANAHTARLI okuma. Plaka/filo SEÇİLMEZ.
  let konum: TakipGorunum["konum"] = null;
  let hizKms: number | null = null;
  if (sefer.vehicle_id) {
    const { data: t } = await supabaseAdmin
      .from("device_telemetry")
      .select("latitude, longitude, speed_kmh, recorded_at")
      .eq("vehicle_id", sefer.vehicle_id)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (t) {
      const tt = t as { latitude: number; longitude: number; speed_kmh: number | null; recorded_at: string };
      if (Number.isFinite(tt.latitude) && Number.isFinite(tt.longitude)) {
        konum = {
          lat: Number(tt.latitude),
          lng: Number(tt.longitude),
          anISO: String(tt.recorded_at),
          bayat: konumBayatMi(String(tt.recorded_at), simdi),
        };
        hizKms = tt.speed_kmh == null ? null : Number(tt.speed_kmh);
      }
    }
  }

  /**
   * 5) ETA — iki uç da varsa.
   *
   * İKİ HESAP, İKİ FONKSİYON:
   *   · DURAK BAZLI → `durakEtaHesapla`: araç → ara duraklar → MÜŞTERİNİN
   *     durağı. Ara durakların servis süreleri DAHİL (sektör formülü,
   *     bkz. lib/takip-eta.ts).
   *   · SEFER BAZLI → `etaHesapla` AYNEN 079'daki hâliyle. Tek satırı bile
   *     değişmedi: mevcut linklerin davranışı korunuyor.
   */
  if (konum && hedef) {
    if (durakBagli && zincir) {
      const geo = await durakHedefleri(zincir);
      const bacaklar: ZincirDuragi[] = zincir.map((d) => {
        const g = geo.get(d.id);
        return {
          lat: g ? g.lat : null,
          lng: g ? g.lng : null,
          yaricapM: g ? g.yaricapM : d.yaricap_m,
          servisDk: d.tahmini_sure_dk,
        };
      });
      const zincirSonuc = durakEtaHesapla({
        aracLat: konum.lat,
        aracLng: konum.lng,
        hizKms,
        yolKatsayisi: TAKIP_YOL_KATSAYISI,
        varsayilanHizKms: TAKIP_VARSAYILAN_HIZ_KMS,
        varsayilanServisDk: TAKIP_VARSAYILAN_SERVIS_DK,
        duraklar: bacaklar,
        mesafe: haversineM,
      });
      // ⚠️ ALAN ALAN YANSITMA — gerekçe `TakipGorunum.eta` yorumunda.
      if (zincirSonuc) {
        eta = {
          dakika: zincirSonuc.dakika,
          ustSinirAsildi: zincirSonuc.ustSinirAsildi,
          vardi: zincirSonuc.vardi,
          kullanilanHizKms: zincirSonuc.kullanilanHizKms,
          ustSinirDk: zincirSonuc.ustSinirDk,
        };
        etaKaba = zincirSonuc.kaba;
      }
    } else {
      const mesafeM = haversineM(konum.lat, konum.lng, hedef.lat, hedef.lng);
      eta = etaHesapla({
        aracLat: konum.lat,
        aracLng: konum.lng,
        hedefLat: hedef.lat,
        hedefLng: hedef.lng,
        hedefYaricapM: hedef.yaricapM,
        hizKms,
        yolKatsayisi: TAKIP_YOL_KATSAYISI,
        varsayilanHizKms: TAKIP_VARSAYILAN_HIZ_KMS,
        mesafeM,
      });
    }
  }

  // 6) DURUM — beş değerli iç çizgi, müşteri için ÜÇE indiriliyor.
  //    "atandi"/"kabul" ayrımı müşteriyi ilgilendirmez ve şoförün seferi ne
  //    zaman kabul ettiğini sızdırır (çalışan davranışı).
  /**
   * ⚠️ DURAK BAZLI LİNKTE `seferler.vardi_at` KULLANILMAZ. O damga seferin İLK
   * varışıdır — yani BAŞKA bir durağa varılmış olabilir. Onu "vardı" saymak,
   * müşteriye aracın kendisine ulaştığını söylemek olurdu. Durak bazlı linkte
   * tek ölçüt zincirin kendi sonucudur (`eta.vardi`, yalnız müşterinin durağı
   * SIRADAKİ ise true olur).
   */
  const vardi = durakBagli
    ? eta?.vardi === true
    : Boolean(sefer.vardi_at) || eta?.vardi === true;
  const durum: TakipGorunum["durum"] = vardi
    ? "vardi"
    : sefer.durum === "yolda"
      ? "yolda"
      : "hazirlaniyor";

  // 7) ŞOFÖR ADI — yalnız kiracı açtıysa. Kapalıyken sorgu HİÇ ATILMAZ.
  let soforAdi: string | null = null;
  if (TAKIP_SOFOR_ADI) {
    const { data: w } = await supabaseAdmin
      .from("workers")
      .select("name")
      .eq("id", sefer.worker_id)
      .maybeSingle();
    if (w) soforAdi = String((w as { name: string }).name);
  }

  return {
    ok: true,
    gorunum: {
      durum,
      konum,
      hedef,
      eta,
      linkBitisISO: link.expires_at,
      soforAdi,
      etaKaba,
      durakBagli,
      onunuzdeDurak,
      pencere,
    },
  };
}

/**
 * Açılma sayacı — KISILMIŞ yazma (dakikada en fazla bir).
 *
 * Sayaç bir kötüye kullanım izidir, muhasebe değil. Her istekte yazmak okuma
 * yolunu yazma yoluna çevirirdi (migration 079 başlığı).
 *
 * Hata YUTULUR: sayaç yazılamadı diye müşteriye sayfa gösterilmemesi saçma
 * olurdu.
 */
const KISMA_MS = 60_000;

export async function takipVurusKaydet(token: string, simdi = new Date()): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("sefer_takip_linkleri")
      .select("id, hit_count, last_hit_at")
      .eq("token", token)
      .maybeSingle();
    if (!data) return;
    const r = data as { id: string; hit_count: number; last_hit_at: string | null };
    if (r.last_hit_at && simdi.getTime() - Date.parse(r.last_hit_at) < KISMA_MS) return;
    await supabaseAdmin
      .from("sefer_takip_linkleri")
      .update({ hit_count: (r.hit_count ?? 0) + 1, last_hit_at: simdi.toISOString() })
      .eq("id", r.id);
  } catch {
    // Sayaç yolu ASLA çağıranı düşürmez.
  }
}
