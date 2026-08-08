import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getWebhookInfo } from "@/lib/telegram";
import { TelegramAdminClient } from "./TelegramAdminClient";
import { audit } from "@/lib/security-log";
import { getOwnerScope, withoutOwner } from "@/lib/owner-scope";

export const dynamic = "force-dynamic";

export default async function TelegramAdminPage() {
  const session = await requireAdmin();

  // Sayfa görüntüleme izi (045). Katman kapalıysa ilk satırda çıkar.
  await audit(session.worker_id ?? null, "page_view", "/admin/telegram");

  const scope = await getTestScope();
  // owner-filtered: withoutOwner — patronun Telegram bağlantısı, dolayısıyla
  // varlığı, is_owner olmayan yöneticiye bu listede görünmez.
  const ownerScope = await getOwnerScope(session.worker_id);
  const { data: connectedRaw } = await withoutOwner(
    withoutTestRows(
      supabaseAdmin
        .from("workers")
        .select("id, name, telegram_username, telegram_linked_at, telegram_chat_id")
        .not("telegram_chat_id", "is", null)
        .order("telegram_linked_at", { ascending: false }),
      "id",
      scope.workerIds
    ),
    "id",
    ownerScope
  );

  const connected = (connectedRaw ?? []).map((w) => ({
    id: w.id as string,
    name: w.name as string,
    username: (w.telegram_username as string) ?? null,
    linkedAt: (w.telegram_linked_at as string) ?? null,
  }));

  const { data: me } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_username")
    .eq("id", session.worker_id!)
    .maybeSingle();

  const webhook = await getWebhookInfo();

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-4">
        <TelegramAdminClient
          connected={connected}
          myStatus={{
            linked: !!me?.telegram_chat_id,
            username: (me?.telegram_username as string) ?? null,
          }}
          webhook={webhook}
        />
      </div>
    </DashboardShell>
  );
}
