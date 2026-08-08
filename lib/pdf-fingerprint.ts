import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { SECURITY_LAYER_ENABLED } from "@/lib/tenant";

/**
 * PDF PARMAK İZİ (migration 047) — belgeye gömülen görünmez tekil işaret.
 *
 * ── NEDEN SUNUCUDA ÜRETİLİYOR ──────────────────────────────────────────────
 * PDF'ler TARAYICIDA üretiliyor (@react-pdf/renderer). İşareti de istemcide
 * üretseydik kullanıcı DevTools'ta başka bir değer koyabilir, hatta boş
 * bırakabilirdi — yani işaret tam da kurcalanmaya karşı var olduğu yerde
 * kurcalanabilir olurdu. Bu yüzden değer bir sunucu action'ında üretilip
 * pdf_fingerprints'e YAZILIYOR, sonra istemciye veriliyor.
 *
 * İstemci onu belgeden silebilir. Silmesi ÖNEMLİ DEĞİL: satır sunucuda
 * kalır, yani "kim ne zaman indirdi" kaydı belgeden bağımsız yaşar.
 * Kurcalamaya karşı korunan şey İNDİRMENİN KAYDI; belgedeki iz ise sızan bir
 * kopyayı o kayda bağlamaya yarar.
 *
 * ── İŞARET ANLAMSIZ ────────────────────────────────────────────────────────
 * İçinde kimlik, tarih ya da IP YOK. Filigranlı belge elden ele dolaşsın diye
 * üretiliyor; içine kişisel veri gömmek, belge kaybolduğunda o veriyi de
 * kaybetmek demekti. Eşleme yalnız veritabanında.
 *
 * ── BİÇİM ──────────────────────────────────────────────────────────────────
 * HAK-XXXX-XXXX-XXXX · Crockford base32 (I/L/O/U yok — elle yazarken 1/l, 0/O
 * karışmasın; işaret bazen ekran görüntüsünden okunup yapıştırılacak).
 * 15 anlamlı hane ≈ 2^75 olasılık: çakışma pratikte imkânsız, tekil indeks de
 * şemada zorluyor.
 */

/** Crockford base32 — okurken karışan harfler (I, L, O, U) YOK. */
const ALFABE = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type ReportType = "azg" | "co2" | "fuel" | "performance" | "shift";

const GECERLI: ReportType[] = ["azg", "co2", "fuel", "performance", "shift"];

/** Ham baytları Crockford base32'ye çevirir. */
function base32(buf: Buffer, uzunluk: number): string {
  let out = "";
  for (let i = 0; i < uzunluk; i++) out += ALFABE[buf[i] % 32];
  return out;
}

/**
 * Yeni bir parmak izi üretir ve kaydeder.
 *
 * Katman kapalıyken `null` döner ve TEK SORGU atmaz — HAK61/Sendigo'da PDF'ler
 * bugünkü hâliyle, işaretsiz üretilir.
 *
 * Yazma başarısızsa da `null` döner: kaydedilemeyen bir işareti belgeye
 * gömmek, sorgulandığında "bu iz kimseye ait değil" diyen bir belge üretirdi —
 * izin kendisine olan güveni bitiren tam olarak budur.
 */
export async function mintFingerprint(
  workerId: string | null,
  reportType: string,
  ip: string | null
): Promise<string | null> {
  if (!SECURITY_LAYER_ENABLED) return null;
  const tur = (GECERLI as string[]).includes(reportType)
    ? (reportType as ReportType)
    : "shift";
  try {
    // Rastgelelik + zaman + kişi karışımı: yalnız rastgele olsaydı da yeterdi,
    // ama karışım aynı milisaniyede iki istek gelse bile ayrışmayı garanti eder.
    const tohum = createHash("sha256")
      .update(randomBytes(32))
      .update(String(workerId ?? ""))
      .update(String(Date.now()))
      .digest();
    const g = base32(tohum, 12);
    const fingerprint = `HAK-${g.slice(0, 4)}-${g.slice(4, 8)}-${g.slice(8, 12)}`;

    const { error } = await supabaseAdmin.from("pdf_fingerprints").insert({
      worker_id: workerId,
      report_type: tur,
      ip,
      fingerprint,
    });
    // Tablo yok (047 çalışmamış) ya da çakışma → işaret VERİLMEZ.
    if (error) return null;
    return fingerprint;
  } catch {
    return null;
  }
}

export type FingerprintHit = {
  fingerprint: string;
  worker_name: string;
  at: string;
  ip: string | null;
  report_type: string;
};

/**
 * İşareti sorgular. Patron ekranındaki "yapıştır ve sor" alanı bunu çağırır.
 *
 * Girdi TEMİZLENİR: kullanıcı belgeden kopyalarken satır sonu, boşluk ya da
 * küçük harf getirebilir. Tire'ler de isteğe bağlı — "HAKABCD..." da bulunur.
 */
export async function lookupFingerprint(
  raw: string
): Promise<FingerprintHit | null> {
  if (!SECURITY_LAYER_ENABLED) return null;
  const temiz = (raw ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (temiz.length < 8) return null;
  // Kanonik biçime geri koy: HAK + 12 hane.
  const g = temiz.startsWith("HAK") ? temiz.slice(3) : temiz;
  if (g.length !== 12) return null;
  const kanonik = `HAK-${g.slice(0, 4)}-${g.slice(4, 8)}-${g.slice(8, 12)}`;

  try {
    const { data, error } = await supabaseAdmin
      .from("pdf_fingerprints")
      .select("fingerprint, worker_id, at, ip, report_type")
      .eq("fingerprint", kanonik)
      .maybeSingle();
    if (error || !data) return null;

    let ad = "—";
    if (data.worker_id) {
      // owner-visible: sorgulayan PATRON ve ekran requireOwner arkasında.
      // test-visible: test hesabının indirdiği bir belge de sorgulanabilmeli.
      const { data: w } = await supabaseAdmin
        .from("workers")
        .select("name")
        .eq("id", data.worker_id as string)
        .maybeSingle();
      ad = (w?.name as string) ?? "—";
    }
    return {
      fingerprint: data.fingerprint as string,
      worker_name: ad,
      at: data.at as string,
      ip: (data.ip as string | null) ?? null,
      report_type: data.report_type as string,
    };
  } catch {
    return null;
  }
}
