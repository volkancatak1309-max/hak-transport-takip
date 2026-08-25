import "server-only";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu } from "@/lib/fault-reports";
import { haversineM } from "@/lib/geo";
import {
  TAKIP_LINK_TTL_MIN,
  TAKIP_SOFOR_ADI,
  TAKIP_VARSAYILAN_HIZ_KMS,
  TAKIP_YOL_KATSAYISI,
} from "@/lib/tenant";
import { etaHesapla, konumBayatMi, type EtaSonuc } from "@/lib/takip-eta";
import { seferHedefi } from "@/lib/sefer-duraklari";

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

const LINK_COLS =
  "id, sefer_id, token, expires_at, revoked_at, alici_not, created_at, created_by, hit_count, last_hit_at";

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
  };
}

export type YazmaSonuc<T> =
  | { ok: true; veri: T }
  | { ok: false; sebep: "tablo_yok" | "sefer_yok" | "sefer_kapali" | "hata"; mesaj?: string };

/**
 * Yeni link üretir.
 *
 * ⚠️ KAPALI SEFERE LİNK ÜRETİLMEZ. Üretilseydi doğar doğmaz ölü olurdu
 * (okuma yolu seferin durumuna bakıyor) ve yönetici çalışmayan bir link
 * göndermiş olurdu. Hata, sessiz bir ölü linkten iyidir.
 */
export async function createTakipLink(
  seferId: string,
  actorWorkerId: string | null,
  aliciNot: string | null
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

  const token = randomBytes(TOKEN_BAYT).toString("base64url");
  const expiresAt = new Date(Date.now() + TAKIP_LINK_TTL_MIN * 60_000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("sefer_takip_linkleri")
    .insert({
      sefer_id: seferId,
      token,
      expires_at: expiresAt,
      alici_not: aliciNot,
      created_by: actorWorkerId,
    })
    .select(LINK_COLS)
    .maybeSingle();
  if (error || !data) {
    return {
      ok: false,
      sebep: error && tabloYokMu(error) ? "tablo_yok" : "hata",
      mesaj: error?.message,
    };
  }
  return { ok: true, veri: linkCevir(data as Record<string, unknown>) };
}

/** Seferin linkleri — YÖNETİCİ yüzeyi (token dahil: yeniden gönderilebilsin). */
export async function listTakipLinks(
  seferId: string
): Promise<{ linkler: TakipLink[]; tabloYok: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("sefer_takip_linkleri")
    .select(LINK_COLS)
    .eq("sefer_id", seferId)
    .order("created_at", { ascending: false });
  if (error) return { linkler: [], tabloYok: tabloYokMu(error) };
  return {
    linkler: ((data ?? []) as Record<string, unknown>[]).map(linkCevir),
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

// ── GİRİŞSİZ OKUMA ────────────────────────────────────────────────────────

/** Linkin neden çalışmadığı — ekran her birine ayrı cümle yazar. */
export type TakipKapali =
  | "bulunamadi"
  | "suresi_doldu"
  | "iptal_edildi"
  | "sefer_kapandi"
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
  /** Hedef bölge merkezi — müşteri zaten kendi adresini bilir. */
  hedef: { lat: number; lng: number; yaricapM: number } | null;
  /** Tahmini varış; hedef ya da konum yoksa null. */
  eta: EtaSonuc | null;
  /** Linkin bitiş anı — sayfa "bu link X'te kapanır" der. */
  linkBitisISO: string;
  /** YALNIZ kiracı açıkça izin verdiyse dolu (TAKIP_SOFOR_ADI). */
  soforAdi: string | null;
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
  const { data: linkRow, error: linkHata } = await supabaseAdmin
    .from("sefer_takip_linkleri")
    .select("id, sefer_id, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (linkHata) {
    return { ok: false, sebep: tabloYokMu(linkHata) ? "tablo_yok" : "bulunamadi" };
  }
  if (!linkRow) return { ok: false, sebep: "bulunamadi" };
  const link = linkRow as { id: string; sefer_id: string; expires_at: string; revoked_at: string | null };
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
   * ⚠️ KAYNAK `seferler.zone_id` DEĞİL, ÇÖZÜLMÜŞ HEDEF (082): durak listesi
   * varsa SIRADAKİ durağın bölgesi ya da koordinatı, yoksa eski tek hedef.
   * Bitmiş bir durağı hedef göstermek, aracı çoktan geçtiği bir noktaya
   * yaklaşıyormuş gibi gösterirdi.
   *
   * ⚠️ BİLİNEN SINIR: link SEFERE bağlı (079), durağa değil. Çok duraklı bir
   * seferde müşteri kendi durağının değil ARACIN SIRADAKİ durağının ETA'sını
   * görür. Yanlış değil, DAR — araç yaklaştıkça sıradaki durak müşterininki
   * olur. Kapatmak 079'a `durak_id` eklemeyi gerektirir (bkz. lib/sefer-duraklari.ts).
   */
  const cozulen = await seferHedefi({ id: link.sefer_id, zone_id: sefer.zone_id });
  const hedef: TakipGorunum["hedef"] = cozulen
    ? { lat: cozulen.lat, lng: cozulen.lng, yaricapM: cozulen.yaricapM }
    : null;

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

  // 5) ETA — iki uç da varsa.
  let eta: EtaSonuc | null = null;
  if (konum && hedef) {
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

  // 6) DURUM — beş değerli iç çizgi, müşteri için ÜÇE indiriliyor.
  //    "atandi"/"kabul" ayrımı müşteriyi ilgilendirmez ve şoförün seferi ne
  //    zaman kabul ettiğini sızdırır (çalışan davranışı).
  const vardi = Boolean(sefer.vardi_at) || eta?.vardi === true;
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
    gorunum: { durum, konum, hedef, eta, linkBitisISO: link.expires_at, soforAdi },
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
