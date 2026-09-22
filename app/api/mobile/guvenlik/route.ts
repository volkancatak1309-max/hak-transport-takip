import type { NextRequest } from "next/server";
import { requireMobileOwner } from "@/lib/mobile-scope";
import { katmanDurumu, katmanKapaliYanit } from "@/lib/mobile-guvenlik";
import {
  listPendingCountries,
  listPendingDevices,
  ACCESS_DEFAULTS,
} from "@/lib/access-read";
import { sayacSonSaat, sessionSayfasi, listSecurityWorkers } from "@/lib/security-read";
import { getKillSwitchState } from "@/lib/kill-switch";
import { anahtarKurulumu } from "@/lib/guvenlik-eylem";
import { ACCESS_GATES_ENABLED, SINGLE_SESSION } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/guvenlik — güvenlik durumu panosu.
 *
 * `/admin/guvenlik` ekranının (045/046/047/048) mobil karşılığı, üst bakış.
 *
 * ═══ KAPI: `requireMobileOwner` ═══
 * Panelin `requireOwner()`ı ile aynı kademe. Sıra ve "katman kapalıyken 403
 * değil dürüst cevap" gerekçesi kapının kendi başlığında (lib/mobile-scope.ts).
 *
 * ═══ 🔴 SESSİZ BOŞ LİSTE YASAK ═══
 * `lib/security-read.ts` ve `lib/access-read.ts` bayrak kapalıyken BOŞ DİZİ
 * döner — panel için doğru, API için yalan. Bu yüzden bayrak çekirdekten ÖNCE
 * denetlenir ve kapalıysa `{katman:"kapali", veri:null}` döner. Emsal
 * `servisYapilandirildi` (091): "arıza" ile "hiç kurulmamış" ayrı şeylerdir.
 *
 * ═══ İKİ BAYRAK BAĞIMSIZ ═══
 * `SECURITY_LAYER_ENABLED` oturum/iz katmanını, `ACCESS_GATES_ENABLED` dört
 * kapıyı açar. Katman açık ama kapılar kapalı bir kurulumda onay sayıları ve
 * anahtar durumu `null` döner ve gövde `kapilar:"kapali"` der — 0 yazmak
 * "bekleyen onay yok" demek olurdu, oysa mekanizma hiç çalışmıyor.
 *
 * HATA KODLARI:
 *   401 missing_token / invalid_token / revoked / inactive
 *   403 admin_required (şoför) · owner_required (yönetici ama patron değil)
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileOwner(req);
  if (!guard.ok) return guard.response;
  if (guard.katman === "kapali") return katmanKapaliYanit();

  const kapilarAcik = ACCESS_GATES_ENABLED;

  const [acik, cihaz, ulke, anahtar, kurulum, giris24, iz24, kisiler] = await Promise.all([
    sessionSayfasi({ limit: 1, offset: 0, acikMi: true }),
    kapilarAcik ? listPendingDevices() : Promise.resolve(null),
    kapilarAcik ? listPendingCountries() : Promise.resolve(null),
    kapilarAcik ? getKillSwitchState() : Promise.resolve(null),
    kapilarAcik ? anahtarKurulumu() : Promise.resolve(null),
    sayacSonSaat("login_sessions", 24),
    sayacSonSaat("audit_log", 24),
    listSecurityWorkers(),
  ]);

  return Response.json({
    ok: true,
    ...katmanDurumu(),

    /**
     * ERİŞİM KAPILARI — hangisi açık, neye göre.
     *
     * Dördü TEK şalterle (`ACCESS_GATES_ENABLED`) açılıyor; ayrı ayrı
     * kapatılamıyorlar ve gövde bunu uydurmuyor. Varsayılanlar kiracı env'inden
     * (`ACCESS_HOURS_*`, `ACCESS_COUNTRIES`) gelir; kişi bazında `workers`
     * kolonları EZER (bkz. `/guvenlik/erisim/[workerId]`).
     *
     * ⚠️ SAAT KİLİDİ Europe/İstanbul'a göre işler, panelin geri kalanı
     * Viyana'ya göre — 1 saatlik kayma BİLİNÇLİ ve kaldırılmadı
     * (lib/access-gates.ts). Gövde dilimi AÇIKÇA taşıyor ki istemci kullanıcıya
     * doğru saati göstersin.
     */
    kapilar_detay: kapilarAcik
      ? {
          tekSalter: "ACCESS_GATES_ENABLED",
          cihazOnayi: true,
          ulkeOnayi: true,
          saatKilidi: true,
          oluAdamAnahtari: true,
          varsayilanSaat: ACCESS_DEFAULTS.hours,
          varsayilanSaatDilimi: "Europe/Istanbul",
          varsayilanUlkeler: ACCESS_DEFAULTS.countries,
          /** Patron dört kapıdan da muaf; muafiyet (048) anahtarı GEÇMEZ. */
          patronMuaf: true,
          muafiyetAnahtariGecer: false,
        }
      : null,

    /** Tek oturum kilidi — `SINGLE_SESSION`, ayrı bayrak. */
    tekOturum: SINGLE_SESSION,

    /**
     * ÖLÜ ADAM ANAHTARI. `aktif: true` → SİSTEM KAPALI (patron hariç kimse
     * giremez). Kilit `kill_switch_attempts`ten TÜRETİLİR, ayrı sayaç yok.
     */
    anahtar: anahtar
      ? {
          aktif: anahtar.active,
          aktifOlduAn: anahtar.activatedAt,
          aktifEden: anahtar.activatedBy,
          sebep: anahtar.reason,
          kilitliBitis: anahtar.lockedUntil,
          kalanHak: anahtar.kalanHak,
          soru: kurulum?.soru ?? null,
          /** 046 tohum satırı var mı — `servisYapilandirildi` ile aynı fikir. */
          sirVar: kurulum?.sirVar ?? false,
          /**
           * 🔴 HÂLÂ FABRİKA CEVABI MI. Hash `db/migrations/046`in tohum
           * değeriyle karşılaştırılıyor; cevap hiçbir yere yazılmaz/dönmez.
           * Bir güvenlik ekranının en az söylemesi gereken şey budur.
           */
          sirVarsayilan: kurulum?.sirVarsayilan ?? false,
        }
      : null,

    bekleyen: kapilarAcik
      ? { cihaz: cihaz?.length ?? 0, ulke: ulke?.length ?? 0 }
      : null,

    /**
     * SON 24 SAAT. `null` = ÖLÇÜLEMEDİ, 0 DEĞİL — sorgu hatası bir ölçüm gibi
     * okunmasın (lib/km-quality.ts dersi).
     */
    son24Saat: { giris: giris24, izSatiri: iz24 },

    oturum: { acik: acik.toplam },

    /**
     * KADRO ÖZETİ. `listSecurityWorkers` test hesabını ELER (panel kararı,
     * 08.08) — bu sayılar o listeden türüyor ve panelle birebir aynı.
     */
    kadro: {
      toplam: kisiler.length,
      patron: kisiler.filter((w) => w.is_owner).length,
      yonetici: kisiler.filter((w) => w.is_admin && !w.is_owner).length,
      donmus: kisiler.filter((w) => !w.is_active).length,
      acikOturumluKisi: kisiler.filter((w) => w.acikOturum > 0).length,
      canliOturumluKisi: kisiler.filter((w) => w.canliOturum > 0).length,
    },

    /** Uç haritası — istemci yolları gömmesin. */
    uclar: {
      oturumlar: "/api/mobile/guvenlik/oturumlar",
      oturumKes: "/api/mobile/guvenlik/oturumlar/[id]/kes",
      onaylar: "/api/mobile/guvenlik/onaylar",
      onayKarari: "/api/mobile/guvenlik/onaylar/[id]",
      erisim: "/api/mobile/guvenlik/erisim/[workerId]",
      anahtar: "/api/mobile/guvenlik/kill-switch",
      denetim: "/api/mobile/guvenlik/denetim",
    },
  });
}
