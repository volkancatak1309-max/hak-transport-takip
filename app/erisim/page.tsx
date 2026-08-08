import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ownerDisplayName } from "@/lib/access-gates";
import { ACCESS_GATES_ENABLED } from "@/lib/tenant";
import { BrandLogo } from "@/components/BrandLogo";

export const dynamic = "force-dynamic";

/**
 * ERİŞİM BEKLEME EKRANI (migration 046) — KAPI 1 ve KAPI 2'nin çıktısı.
 *
 * ── NEDEN TIKLANACAK HİÇBİR ŞEY YOK ────────────────────────────────────────
 * Bu sayfada menü, bağlantı, düğme ve form BİLEREK yok (Volkan, 08.08.2026).
 * Kullanıcı kimliğini doğrulamıştır ama İÇERİ ALINMAMIŞTIR; ona yarım bir
 * panel göstermek, hangi yarısının çalıştığını denemeye davet eder. Tek
 * satırlık metin, gidecek yer yok.
 *
 * ── PEKİ ONAY GELİNCE NASIL İÇERİ GİRECEK ──────────────────────────────────
 * `<meta http-equiv="refresh">` ile sayfa 20 saniyede bir kendini yeniler.
 * Yenilenme TIKLAMA DEĞİLDİR, dolayısıyla kuralı bozmaz; patron onayladığı
 * anda bir sonraki yenilemede kullanıcı panele düşer (kapı artık `ok` döner ve
 * aşağıdaki yönlendirme çalışır).
 *
 * ── ÇIKIŞ DÜĞMESİ DE YOK — BİLİNEN ÖDÜN ────────────────────────────────────
 * Yanlış hesapla giren biri kendi başına çıkış yapamaz; çerez 30 gün yaşıyor.
 * Kural "tıklanabilir öğe olmasın" olduğu için düğme konmadı. Çözüm patronda:
 * güvenlik ekranından "oturumları sonlandır" o çerezi anında öldürür.
 *
 * ── KENDİ KAPISI VAR ───────────────────────────────────────────────────────
 * requireWorker/requireAdmin çağrılmaz — onlar bu sayfaya yönlendiriyor, yani
 * çağırmak sonsuz döngü olurdu. Kapı burada elle kuruluyor: oturum yoksa giriş
 * ekranına, kapı işareti yoksa kendi ana ekranına.
 */
export default async function ErisimPage() {
  const session = await getSession();
  if (!session.worker_id) redirect("/");

  // Bayrak kapalıysa bu ekranın var olma sebebi yok — kullanıcı normale döner.
  if (!ACCESS_GATES_ENABLED || !session.access_gate) {
    redirect(session.is_admin ? "/admin" : "/panel");
  }

  const patron = await ownerDisplayName();
  const kapi = session.access_gate;

  return (
    <>
      {/* Onay gelince kullanıcıyı içeri almanın TEK yolu: tıklamasız yenileme. */}
      <meta httpEquiv="refresh" content="20" />
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="w-full max-w-[420px] text-center">
          <BrandLogo height={56} className="mx-auto mb-8" />

          <h1 className="text-lg font-semibold tracking-[-0.01em]">
            Erişim onay bekliyor
          </h1>

          <p className="mt-3 text-sm text-muted-foreground">
            {patron ? `${patron} onayında.` : "Yönetici onayında."}
          </p>

          <p className="mt-6 text-sm text-muted-foreground">
            {kapi === "country"
              ? "Bulunduğunuz ülkeden ilk kez giriş yapılıyor."
              : "Bu cihazdan ilk kez giriş yapılıyor."}
          </p>

          <p className="mt-8 text-xs text-text-tertiary">
            Onaylandığında bu sayfa kendiliğinden açılır.
          </p>
        </div>
      </main>
    </>
  );
}
