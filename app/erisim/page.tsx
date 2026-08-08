import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { getSession } from "@/lib/session";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
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
 * ── TEK İSTİSNA: ÇIKIŞ DÜĞMESİ ─────────────────────────────────────────────
 * İlk sürümde çıkış düğmesi de yoktu ve bu bir kusurdu (Volkan, 08.08.2026):
 * yanlış hesapla giren biri sahada kilitli kalıyor, çerez 30 gün yaşadığı için
 * kendi başına kurtulamıyor ve patrona ulaşmak zorunda kalıyordu.
 *
 * Kuralı bozmaz, çünkü kuralın amacı İÇERİ SIZMAYI önlemek: buradaki her
 * bağlantı panele bir kapı olurdu, çıkış ise ters yöne — oturumu YOK EDER ve
 * giriş ekranına bırakır. Erişim genişletmeyen tek eylem budur.
 *
 * Menü, gezinme bağlantısı ve başka hiçbir form YOK; tek düğmelik bu form
 * dışında sayfada tıklanacak bir şey bulunmuyor.
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

          {/* Sayfadaki TEK tıklanabilir öğe. Sunucu action'ı: oturumu kapatır
              (login_sessions satırı 'logout' ile kapanır) ve giriş ekranına
              bırakır — hiçbir yere GİRİŞ sağlamaz. */}
          <form action={logoutAction} className="mt-8">
            <Button type="submit" variant="outline" size="sm">
              <LogOut className="size-4" aria-hidden /> Çıkış yap
            </Button>
          </form>
        </div>
      </main>
    </>
  );
}
