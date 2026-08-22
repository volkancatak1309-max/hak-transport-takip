import { getTranslations } from "next-intl/server";
import { requireFleetView, effectiveViewerId } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { listeAction } from "@/app/actions/messages";
import { audit } from "@/lib/security-log";
import { MessagesClient } from "./MessagesClient";

export const dynamic = "force-dynamic";

/**
 * /admin/mesajlar — yönetici ↔ şoför mesajlaşması (WhatsApp deseni).
 *
 * KAPI: `requireFleetView()` — patron VEYA filo şefi. Şoför buraya giremez
 * (kapı onu /panel'e atar) ve girse de kapsam onu tek satıra indirirdi.
 *
 * Liste SUNUCUDA yükleniyor: ekran ilk boyada dolu geliyor, istemci ikinci bir
 * tur atmıyor. Şef kapsamı da burada uygulanıyor — `listeAction` içindeki
 * `konusmaListesi` mobil ucun kullandığı AYNI fonksiyon.
 */
export default async function MesajlarPage() {
  const { session } = await requireFleetView();
  const viewerId = effectiveViewerId(session) ?? session.worker_id!;

  await audit(viewerId, "page_view", "/admin/mesajlar");

  const liste = await listeAction();
  const t = await getTranslations("messages");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: session.is_admin === true,
        managedFleet: session.is_admin ? null : "var",
        shadowOf: session.shadow_name ?? null,
      }}
      title={t("title")}
    >
      <MessagesClient
        rol={liste.ok ? liste.data.rol : "fleet_chief"}
        okunduBilgisi={liste.ok ? liste.data.okunduBilgisi : false}
        satirlar={liste.ok ? liste.data.satirlar : []}
      />
    </DashboardShell>
  );
}
