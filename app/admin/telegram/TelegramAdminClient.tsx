"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Send, Loader2, CheckCircle2, AlertTriangle, Webhook } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TelegramLink } from "@/components/TelegramLink";
import { sendTestMessage } from "@/app/actions/telegram";
import { formatDateTime } from "@/lib/format";
import type { WebhookInfo } from "@/lib/telegram";

type ConnectedUser = {
  id: string;
  name: string;
  username: string | null;
  linkedAt: string | null;
};

type Props = {
  connected: ConnectedUser[];
  myStatus: { linked: boolean; username: string | null };
  webhook: WebhookInfo;
};

export function TelegramAdminClient({ connected, myStatus, webhook }: Props) {
  const t = useTranslations("telegram");
  const locale = useLocale();

  const [target, setTarget] = useState<string>(connected[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  async function send(workerId: string, text: string, rowId?: string) {
    if (!workerId) return;
    if (rowId) setRowBusy(rowId);
    else setBusy(true);
    try {
      const res = await sendTestMessage(workerId, text);
      if (res.ok) toast.success(t("test_sent"));
      else toast.error(t("error"));
    } finally {
      setBusy(false);
      setRowBusy(null);
    }
  }

  return (
    <>
      {/* Başlık bloğu — klon A2 ölçüsü. Bu sayfa bir ayar/durum ekranı:
          filtrelenecek liste yok, bu yüzden A3 filtre bandı da YOK — boş bir
          bant koymak Reveal'da da olmayan süs olurdu. */}
      <div>
        <h1 className="text-[28px] font-semibold leading-tight">{t("title")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Admin's own link */}
      <TelegramLink linked={myStatus.linked} username={myStatus.username} />

      {/* Webhook status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Webhook className="size-4" /> {t("webhook_status")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          {!webhook.ok ? (
            <p className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="size-4" /> {t("not_configured")}
            </p>
          ) : (
            <>
              <p className="break-all">
                <span className="text-muted-foreground">URL: </span>
                {webhook.url || t("webhook_none")}
              </p>
              <p>
                <span className="text-muted-foreground">{t("webhook_pending")}: </span>
                {webhook.pendingUpdateCount ?? 0}
              </p>
              {webhook.lastErrorMessage ? (
                <p className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="size-4" />
                  {webhook.lastErrorMessage}
                </p>
              ) : (
                <p className="flex items-center gap-2 text-accent-sky-text">
                  <CheckCircle2 className="size-4" /> {t("webhook_ok")}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Test message */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("test_send")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {connected.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("no_users")}</p>
          ) : (
            <>
              <Select value={target} onValueChange={(v) => v && setTarget(v)}>
                <SelectTrigger className="h-10" aria-label={t("select_worker")}>
                  <SelectValue>
                    {((v: unknown) => {
                      const u = connected.find((x) => x.id === String(v));
                      return u ? `${u.name}${u.username ? ` (@${u.username})` : ""}` : t("select_worker");
                    }) as never}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {connected.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                      {u.username ? ` (@${u.username})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("message_label")}
                rows={3}
              />
              <Button
                onClick={() => send(target, message)}
                disabled={busy || !target || !message.trim()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {t("test_send")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Connected users */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("connected_users")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {connected.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {t("no_users")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("col_name")}</TableHead>
                    <TableHead>{t("col_username")}</TableHead>
                    <TableHead>{t("col_linked_at")}</TableHead>
                    <TableHead className="text-right">{t("test_send")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connected.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>{u.name}</TableCell>
                      <TableCell>{u.username ? `@${u.username}` : "—"}</TableCell>
                      <TableCell>
                        {u.linkedAt ? formatDateTime(u.linkedAt, locale) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Yalnız ikon içeriyor -> erişilebilir adı yoktu
                            (Lighthouse button-name). */}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={rowBusy === u.id}
                          onClick={() => send(u.id, t("test_default"), u.id)}
                          aria-label={`${t("test_send")} — ${u.name}`}
                        >
                          {rowBusy === u.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Send className="size-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
