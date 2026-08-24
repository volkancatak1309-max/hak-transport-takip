import { getTranslations } from "next-intl/server";
import { requireFleetView } from "@/lib/session";
import { getFleetScope, UNRESTRICTED } from "@/lib/fleet-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { audit } from "@/lib/security-log";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getIsEmirleri } from "@/app/actions/is-emri";
import { IsEmirleriClient } from "./IsEmirleriClient";

export const dynamic = "force-dynamic";

/**
 * /admin/is-emirleri — ARAÇ İŞ EMİRLERİ (migration 081).
 *
 * ═══ KAPI: requireAdmin DEĞİL, requireFleetView ═══
 *
 * Filo şefi kendi filosunun arızasını yönetebilmeli — aracı servise o
 * gönderiyor. Kapsam eylem katmanında ARAÇ ekseninde uygulanıyor
 * (app/actions/is-emri.ts) ve emrin aracı KAYITTAN okunuyor, istemciden değil.
 */
export default async function IsEmirleriPage({
  searchParams,
}: {
  searchParams: Promise<{ hepsi?: string }>;
}) {
  const { session, fleet } = await requireFleetView();
  await audit(session.worker_id ?? null, "page_view", "/admin/is-emirleri");

  const sp = await searchParams;
  const yalnizAcik = sp.hepsi !== "1";

  const scope = fleet ? await getFleetScope(fleet) : UNRESTRICTED;
  const test = await getTestScope();
  // Seçici test aracını ELER: elle açılan bir emir gerçek bir araca yazılır.
  // Emir LİSTESİ elemiyor (bkz. app/actions/is-emri.ts) — kontrol formundan
  // doğan emir, test hesabıyla da uçtan uca doğrulanabilmeli.
  const [{ emirler, tabloYok, personel }, { data: v }, t] = await Promise.all([
    getIsEmirleri(yalnizAcik),
    withoutTestRows(
      supabaseAdmin.from("vehicles").select("id, plate").neq("status", "inactive").order("plate"),
      "id",
      test.vehicleIds
    ),
    getTranslations("workorders"),
  ]);
  const araclar = ((v ?? []) as { id: string; plate: string }[]).filter((x) =>
    scope.isFleetVehicle(x.id)
  );

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
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <IsEmirleriClient
          emirler={emirler}
          personel={personel}
          araclar={araclar}
          tabloYok={tabloYok}
          yalnizAcik={yalnizAcik}
        />
      </div>
    </DashboardShell>
  );
}
