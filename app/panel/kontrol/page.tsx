import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireWorker } from "@/lib/session";
import { getDvirBaslangic } from "@/app/actions/dvir";
import { KontrolFormClient } from "./KontrolFormClient";

export const dynamic = "force-dynamic";

/**
 * ARAÇ KONTROL FORMU — şoför sayfası (migration 081).
 *
 * `?tur=sonra` sefer sonu kontrolünü açar; varsayılan sefer öncesi. İki ayrı
 * rota değil tek rota + parametre: maddelerin çoğu ikisinde de var
 * (`tur='ikisi'`) ve iki sayfa aynı formu iki kez taşırdı.
 *
 * Şoför paneli kabuğu (DashboardShell) BİLEREK kullanılmıyor: bu ekran tek
 * işlik bir akış, yan menü ve üst çubuk odağı böler. /panel/gecmis ile aynı
 * desen.
 */
export default async function KontrolPage({
  searchParams,
}: {
  searchParams: Promise<{ tur?: string }>;
}) {
  await requireWorker();
  const t = await getTranslations("dvir");
  const sp = await searchParams;
  const tur: "once" | "sonra" = sp.tur === "sonra" ? "sonra" : "once";

  const { araclar, maddeler, tabloYok } = await getDvirBaslangic(tur);

  return (
    <main className="mx-auto max-w-lg space-y-5 px-4 py-5">
      <div className="space-y-2">
        <Link
          href="/panel"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Link>
        <div className="space-y-0.5">
          <h1 className="text-lg font-semibold">
            {tur === "once" ? t("title_pre") : t("title_post")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {tur === "once" ? t("desc_pre") : t("desc_post")}
          </p>
        </div>
        {/* Sefer öncesi ↔ sonrası geçişi: aynı rota, tek parametre. */}
        <div className="flex gap-2 pt-1">
          <TurLinki aktif={tur === "once"} href="/panel/kontrol" label={t("tab_pre")} />
          <TurLinki
            aktif={tur === "sonra"}
            href="/panel/kontrol?tur=sonra"
            label={t("tab_post")}
          />
        </div>
      </div>

      {tabloYok ? (
        <p className="rounded-lg border border-accent-gold/50 bg-accent-gold-soft px-3 py-2 text-xs font-medium text-accent-gold-text">
          {t("err_migration")}
        </p>
      ) : (
        <KontrolFormClient tur={tur} araclar={araclar} maddeler={maddeler} />
      )}
    </main>
  );
}

function TurLinki({
  aktif,
  href,
  label,
}: {
  aktif: boolean;
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-[36px] items-center rounded-full px-3.5 text-[13px] font-medium transition-colors ${
        aktif
          ? "bg-foreground text-background"
          : "border border-border/60 text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}
