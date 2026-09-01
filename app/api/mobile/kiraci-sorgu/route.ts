import type { NextRequest } from "next/server";
import { findWorkerByPhone, workerCanSignIn } from "@/lib/auth-core";
import { phoneSchema } from "@/lib/validation";
import { canonicalPhone } from "@/lib/phone";
import { safeEqual } from "@/lib/secure-compare";
import { sinirDenetle } from "@/lib/rate-limit";
import { TENANT } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/kiraci-sorgu — "bu numara BU kiracıda var mı?" · evet/hayır.
 *
 * ═══ NE İŞE YARAR ══════════════════════════════════════════════════════════
 *
 * Mobil uygulamadaki firma seçici Galzura'nın MÜŞTERİ LİSTESİNİ JS paketine
 * gömüyordu; APK'yı açan herkes okuyabiliyordu. Liste kalkıyor. Yerine gelen
 * akış: kullanıcı telefon + PIN yazar → uygulama galzura.com'daki YÖNLENDİRME
 * SERVİSİNE "bu numara hangi kiracıda?" diye sorar → servis her kiracıya TEK
 * TEK bu ucu sorar (YAYILMA) → kim tanıyorsa oranın adresi döner → uygulama
 * PIN'i ORAYA gönderir.
 *
 * Merkezî bir numara→kiracı tablosu YOK ve bu bilinçli: tablo, kiracı
 * eklendiğinde ya da personel taşındığında sessizce bayatlar ve kullanıcıyı
 * yanlış kapıya gönderir. Kaynağın kendisine sormak bayatlamaz.
 *
 * ═══ 🔴 BU UCA PIN GELMEZ ═══════════════════════════════════════════════════
 *
 * Yalnız ADRES BULMA. PIN, yönlendirme bittikten SONRA doğrudan hedef kiracının
 * `/api/mobile/auth/login` ucuna gider. Gerekçe: yayılma modelinde PIN, kişinin
 * ÜYE OLMADIĞI kiracılara da ulaşırdı — N kiracının tamamı, kendilerine ait
 * olmayan bir sırrı görürdü. Gövdede `pin` alanı gelirse istek 400 ile
 * REDDEDİLİR (aşağıda); sessizce yok saymak, ileride "yardımcı olmak isteyen"
 * bir istemcinin PIN'i buraya göndermesini fark edilmez kılardı.
 *
 * ═══ 🔴 KİŞİSEL VERİ DÖNMEZ ════════════════════════════════════════════════
 *
 * Cevap `{ok, var, kod}`. Ad, rol, plaka, araç, filo, vardiya — hiçbiri. Sorgu
 * `pin_hash`i OKUMAZ bile. `kod` kiracı kodudur (NEXT_PUBLIC_TENANT) ve zaten
 * her kiracının açılış sayfasında görünür; yanlış kiracıya bağlanmış bir
 * yönlendirme kaydını teşhis etmek için duruyor, kişiye ait bir veri değil.
 *
 * ═══ CEVABIN ANLAMI: KİMLİK, OTURUM DEĞİL ══════════════════════════════════
 *
 * `var: true` = "bu numaraya karşılık gelen, bu kurulumda giriş yapabilecek bir
 * HESAP var". Kararı `workerCanSignIn` verir — girişin kullandığı YORDAMIN
 * BİREBİR AYNISI. Dolayısıyla:
 *
 *   pasif hesap                     → false  (giriş de reddediyor)
 *   silinmiş personel (kayıt yok)   → false
 *   şoför paneli kapalı + şoför     → false  (Sendigo: o kişi zaten giremez)
 *   şoför paneli kapalı + yönetici  → true
 *   test hesabı (is_test)           → true   (giriş yapabiliyor; bkz. § 5)
 *   PIN değiştirmesi gereken kişi   → true   (giriş yapabiliyor)
 *
 * Erişim kapıları 046 (cihaz onayı · ülke · saat aralığı · ölü adam anahtarı)
 * BİLEREK UYGULANMAZ: onlar OTURUM eksenindedir ve o AN'a bağlıdır. Cihazı onay
 * bekleyen birine "hiçbir kiracıda yoksun" demek, onu onay akışına hiç sokamamak
 * demekti. Uç "buraya ait misin" sorusunu cevaplar, "şu an girebilir misin"
 * sorusunu değil — onu `/auth/login` cevaplar.
 *
 * ═══ ZAMANLAMA — ÖLÇÜLDÜ, TABAN SÜRE GEREKMİYOR ════════════════════════════
 *
 * Endişe şuydu: "yok" cevabı anında dönerse süre farkından bilgi sızar. HAK61
 * canlı verisiyle ölçüldü (n=250/kol, scripts/measure-kiraci-sorgu-zamanlama.mjs):
 *
 *   BULUNDU − BULUNAMADI farkı ................. 2,78 ms
 *   Fizik olarak AYNI iki kol arasındaki fark ... 6,81 ms   ← gürültü tabanı
 *
 * Aranan sinyal kendi gürültü tabanının ALTINDA. Üstelik gövde cevabı ZATEN
 * açıkça söylüyor — bulundu/bulunamadı için zamanlama kanalı bir şey EKLEMEZ.
 * Gövdenin gizlediği tek ayrım "kayıt var ama giremez" (pasif / panel kapalı) ve
 * o karar sorgu DÖNDÜKTEN SONRA saf bellekte veriliyor: DB yolu birebir aynı,
 * yani yapısal olarak sabit süreli. Taban süre eklemek her girişe gecikme
 * bindirirdi (yayılmada toplamı en yavaş kiracı belirler) ve karşılığında hiçbir
 * şey kapatmazdı. Ayrıntı: docs/KIRACI-SORGU-UCU.md § 4.
 *
 * ⚠️ BU YÜZDEN: bu handler'a, CEVABA BAĞLI bir erken çıkış eklenemez. "Kayıt
 * yoksa hemen dön" gibi bir kısayol, bugün olmayan farkı yaratır.
 *
 * ═══ KİMLİK DOĞRULAMA ══════════════════════════════════════════════════════
 *
 * `KIRACI_SORGU_SECRET` env'i üç durumu ifade eder:
 *
 *   tanımsız        → 503 `yapilandirilmadi`. FAIL-CLOSED ve GÜRÜLTÜLÜ: yeni
 *                     kiracıda env unutulursa uç "hayır" demez, "beni
 *                     kurmadınız" der. "Hayır" deseydi o kiracının personeli
 *                     hiçbir yere yönlenemez ve arıza AYLAR sonra fark edilirdi.
 *   "acik"          → kimliksiz çalışır. Volkan'ın kabul ettiği açık uç, ama
 *                     KARARIN KENDİSİ env'e yazılı; sessiz varsayılan değil.
 *   başka bir değer → sır. `Authorization: Bearer <sır>` beklenir, sabit
 *                     zamanlı karşılaştırılır (safeEqual).
 *
 * Sır YAYILMA MODELİNİ BOZMAZ ve İSTEMCİYE HİÇ GİRMEZ: bu ucu telefon değil,
 * galzura.com'daki yönlendirme servisi (sunucu) çağırır. Sırrın APK'ya gömülmesi
 * gibi bir durum söz konusu değildir.
 *
 * ⚠️ `CRON_SECRET` YENİDEN KULLANILMADI. O sır `/api/cron/saklama` gibi VERİ
 * SİLEN uçları da açıyor; yönlendirme servisine vermek, bir okuma yetkisi
 * karşılığında silme yetkisi devretmek olurdu.
 *
 * ═══ HIZ SINIRI — NE KORUR, NE KORUMAZ ═════════════════════════════════════
 *
 * Sayaç SÜREÇ İÇİDİR (lib/rate-limit.ts): her lambda örneği kendi sayacını tutar
 * ve soğuk başlangıçta sıfırlanır. Dağıtık bir taramayı DURDURMAZ; bunu iddia
 * etmiyoruz, asıl kapı sırdır. Sınırın işi, kaçak tek bir istemcinin (ya da
 * döngüye girmiş bir yönlendirme servisinin) veritabanını meşgul etmesini
 * kesmek.
 *
 * IP tavanı BOL: meşru çağıran TEK BİR SERVİS, yani tüm sistemin girişleri aynı
 * IP'den gelir. Dar bir tavan saldırganı değil müşteriyi keserdi.
 */

/** Kimliksiz çalışmayı AÇIKÇA seçen sentinel değer. */
const ACIK = "acik";

/** Numara başına pencere: 20 istek / 60 sn (kilit merdiveni 10 denemede kuruluyor). */
const TELEFON_TAVAN = 20;
/** IP başına pencere: 600 istek / 60 sn — meşru yönlendirme servisi için bol. */
const IP_TAVAN = 600;
const PENCERE_SN = 60;

/** Girişsiz/kişiye özel cevap: ara katman saklamasın, arama motoru indekslemesin. */
const BASLIKLAR = {
  "cache-control": "no-store, private",
  "x-robots-tag": "noindex, nofollow",
} as const;

function cevap(
  govde: Record<string, unknown>,
  status = 200,
  ek?: Record<string, string>
) {
  return Response.json(govde, { status, headers: { ...BASLIKLAR, ...ek } });
}

function hata(status: number, kod: string, ek?: Record<string, string>) {
  return cevap({ ok: false, hata: kod }, status, ek);
}

function istemciIp(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return h.get("x-real-ip")?.trim() || "bilinmiyor";
}

/** null = yapılandırılmadı · true = geçti · false = sır yanlış/eksik. */
function yetkili(req: NextRequest): boolean | null {
  const beklenen = process.env.KIRACI_SORGU_SECRET?.trim();
  if (!beklenen) return null;
  if (beklenen === ACIK) return true;
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return safeEqual(auth.slice(7).trim(), beklenen);
}

export async function POST(req: NextRequest) {
  const izin = yetkili(req);
  if (izin === null) return hata(503, "yapilandirilmadi");
  if (izin === false) return hata(401, "yetkisiz");

  // Sınırlar sırdan SONRA: yetkisiz bir istemci meşru servisin kovasını
  // tüketemesin. IP ekseni önce (daha ucuz); telefon ekseni gövde okunduktan
  // sonra — numarayı bilmeden numaraya sınır uygulanamaz.
  const ipSinir = sinirDenetle(
    `ksorgu:ip:${istemciIp(req.headers)}`,
    IP_TAVAN,
    PENCERE_SN
  );
  if (!ipSinir.ok) {
    return hata(429, "cok_fazla_istek", {
      "retry-after": String(ipSinir.tekrarSn),
    });
  }

  let govde: unknown;
  try {
    govde = await req.json();
  } catch {
    return hata(400, "gecersiz_govde");
  }
  const g = (govde ?? {}) as Record<string, unknown>;

  // 🔴 PIN BU UCA GELMEZ. Sessizce yok saymak yerine GÜRÜLTÜLÜ ret: bir istemci
  // PIN'i buraya göndermeye başlarsa ilk istekte anlaşılsın, aylar sonra değil.
  if ("pin" in g || "sifre" in g || "password" in g) {
    return hata(400, "pin_gonderilmemeli");
  }

  const ayristir = phoneSchema.safeParse(g.telefon);
  if (!ayristir.success) return hata(400, "telefon_bicimsiz");
  const telefon = ayristir.data;

  // Sınır KANONİK numaraya bağlanır: "+43660…" ve "+430660…" yazımları tek
  // kovada toplansın (lib/login-lock.ts'teki kilit kimliğiyle aynı mantık).
  const telSinir = sinirDenetle(
    `ksorgu:tel:${canonicalPhone(telefon)}`,
    TELEFON_TAVAN,
    PENCERE_SN
  );
  if (!telSinir.ok) {
    return hata(429, "cok_fazla_istek", {
      "retry-after": String(telSinir.tekrarSn),
    });
  }

  // Girişin kullandığı EŞLEŞTİRMENİN AYNISI (phoneVariants → .in("phone", …)).
  // Kolon listesi dar: kimlik kapısının okuduğu iki bayrak, başka hiçbir şey.
  const bulundu = await findWorkerByPhone(telefon, "is_active, is_admin");
  if (!bulundu.ok) return hata(503, "db_hatasi");

  const w = bulundu.row;
  const varMi =
    w !== null &&
    workerCanSignIn({
      is_active: w.is_active === true,
      is_admin: w.is_admin === true,
    });

  return cevap({ ok: true, var: varMi, kod: TENANT });
}

/**
 * GET bilerek KAPALI. Numara sorgu dizesine yazılsaydı Vercel erişim
 * kayıtlarına, tarayıcı geçmişine ve ara katman önbelleklerine düşerdi —
 * telefon numarası kişisel veridir ve URL'de yeri yoktur.
 */
export async function GET() {
  return hata(405, "sadece_post", { allow: "POST" });
}
