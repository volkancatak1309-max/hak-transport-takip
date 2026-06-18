"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, Check, Loader2, Link2Off, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/help/HelpTip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  createTelegramLinkCode,
  unlinkTelegram,
  getMyTelegramStatus,
} from "@/app/actions/telegram";

type Props = { linked: boolean; username: string | null };

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "hak_transport_bildirim_bot";

export function TelegramLink({ linked, username }: Props) {
  const t = useTranslations("telegram");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function startLink() {
    setBusy(true);
    try {
      const res = await createTelegramLinkCode();
      if (!res.ok) {
        toast.error(t("error"));
        return;
      }
      setCode(res.code);
      setDeepLink(res.deepLink);
      setQr(res.qrDataUrl);
      setOpen(true);

      // Poll until the driver opens the bot and the link completes (~5 min max).
      if (pollRef.current) clearInterval(pollRef.current);
      let ticks = 0;
      pollRef.current = setInterval(async () => {
        ticks += 1;
        const st = await getMyTelegramStatus();
        if (st.linked) {
          if (pollRef.current) clearInterval(pollRef.current);
          toast.success(t("linked_success"));
          setOpen(false);
          router.refresh();
        } else if (ticks > 100) {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }, 3000);
    } finally {
      setBusy(false);
    }
  }

  async function doUnlink() {
    setBusy(true);
    try {
      await unlinkTelegram();
      toast.success(t("unlinked"));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function onOpenChange(o: boolean) {
    setOpen(o);
    if (!o && pollRef.current) clearInterval(pollRef.current);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Send className="size-4" /> Telegram
          <HelpTip tkey="drv_telegram" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {linked ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm">
              <Check className="size-4 text-accent-sky" />
              {t("linked")}
              {username ? ` (@${username})` : ""}
            </span>
            <Button variant="outline" size="sm" onClick={doUnlink} disabled={busy}>
              <Link2Off className="size-4" />
              {t("unlink")}
            </Button>
          </div>
        ) : (
          <Button onClick={startLink} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {t("link_button")}
          </Button>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("link_button")}</DialogTitle>
            <DialogDescription>{t("scan_qr")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr}
                alt="Telegram QR"
                width={300}
                height={300}
                className="h-[300px] w-[300px] rounded-md border"
              />
            )}
            {code && (
              <div className="text-center">
                <p className="text-xs text-muted-foreground">{t("link_instructions")}</p>
                <p className="mt-1 text-5xl font-bold tracking-[0.2em] nums">{code}</p>
              </div>
            )}
            {deepLink && (
              <a
                href={deepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-4" /> t.me/{BOT}
              </a>
            )}
            <p className="text-xs text-muted-foreground">{t("code_expires")}</p>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
