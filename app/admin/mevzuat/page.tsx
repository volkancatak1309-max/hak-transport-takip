import { getTranslations } from "next-intl/server";
import { requireFleetView } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getMevzuatPanosu } from "@/app/actions/mevzuat";
import { MevzuatClient } from "./MevzuatClient";

export const dynamic = "force-dynamic";

/**
 * /admin/mevzuat — CANLI MEVZUAT DURUMU (migration 086).
 *
 * ═══ AZG RAPORUNUN YERİNE DEĞİL, ÜSTÜNE ═══
 *
 * `/admin/raporlar` altındaki AZG raporu GEÇMİŞE bakar ve bir belge üretir:
 * "geçen ay şu günlerde tavan aşıldı". Bu ekran ŞU ANA bakar: "Ali'nin
 * 40 dakikası kaldı". İkisi aynı kural setinden beslenir (lib/azg-rules.ts
 * eşikleri buraya İTHAL edilir, kopyalanmaz) ama farklı soruları cevaplar.
 *
 * ═══ BU EKRAN UYUM GARANTİSİ VERMEZ ═══
 *
 * Filoda takograf yok. Çalışma süresi ölçülür; sürüş süresi yalnız TAHMİN
 * edilir ve hata payı ekranda sayı olarak durur. Bu ayrım sayfanın en üstünde
 * yazar ve kaldırılamaz — kaldırılırsa ürün tutamayacağı bir söz vermiş olur.
 */
export default async function MevzuatSayfasi() {
  const { session } = await requireFleetView();

  const [pano, t] = await Promise.all([getMevzuatPanosu(), getTranslations("mevzuat")]);

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: Boolean(session.is_admin),
        shadowOf: session.shadow_name ?? null,
      }}
      title={t("title")}
    >
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
        <MevzuatClient pano={pano} yonetici={Boolean(session.is_admin)} />
      </div>
    </DashboardShell>
  );
}
