import { requireOwner } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  listSessions,
  listOpenSessions,
  listAudit,
  listSecurityWorkers,
} from "@/lib/security-read";
import { audit } from "@/lib/security-log";
import { SECURITY_LAYER_ENABLED, SINGLE_SESSION } from "@/lib/tenant";
import { GuvenlikClient } from "./GuvenlikClient";

export const dynamic = "force-dynamic";

/**
 * PATRON EKRANI (045) — /admin/guvenlik.
 *
 * requireOwner() arkasında: mevcut 19 yönetici sayfası requireAdmin()'de kaldı,
 * bu ekran tek başına daha dar bir kapıya bağlı. Yetki her istekte DB'den
 * okunur (çerezden değil) ve kolon yoksa fail-closed → /admin.
 */
export default async function GuvenlikPage() {
  const session = await requireOwner();

  const [sessions, open, auditRows, workers] = await Promise.all([
    listSessions(200),
    listOpenSessions(),
    listAudit(200),
    listSecurityWorkers(),
  ]);

  // Bu sayfanın kendi görüntülenmesi de ize girer — güvenlik ekranına kimin
  // baktığı, izlenen diğer her şey kadar önemlidir.
  await audit(session.worker_id ?? null, "page_view", "/admin/guvenlik");

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
        isOwner: true,
      }}
      title="Güvenlik"
    >
      <GuvenlikClient
        sessions={sessions}
        open={open}
        audit={auditRows}
        workers={workers}
        meId={session.worker_id!}
        layerEnabled={SECURITY_LAYER_ENABLED}
        singleSession={SINGLE_SESSION}
      />
    </DashboardShell>
  );
}
