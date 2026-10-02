"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Flag, Trash2, UserX, Users, User } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  bildirimlerAction,
  bildirimCozAction,
  mesajSilAction,
  pasifeAlAction,
} from "@/app/actions/messages";
import type { BildirilenMesaj, BildirimDurumu, Sebep } from "@/lib/mesaj-moderasyon";
import { TENANT_TZ } from "@/lib/tz";

/**
 * BİLDİRİLEN MESAJLAR — yönetici moderasyon listesi (migration 111).
 *
 * Kayıt MESAJ başına: aynı mesajı üç kişi bildirdiyse tek kart, içinde üç
 * bildirim. Üç eylem BAĞIMSIZ: mesajı sil · göndereni pasife al · çözüldü
 * işaretle. Silmek ya da pasife almak bildirimi kendiliğinden çözmez —
 * yönetici ikisini birden yapıp sonra kapatabilsin diye (mobil ekranla aynı).
 *
 * Silinmiş mesajın METNİ gösterilmez (sunucu da göndermiyor); kim, ne zaman
 * kaldırdı gösterilir.
 */

type Liste = { kayitlar: BildirilenMesaj[]; acikSayisi: number | null; kirpildi: boolean };

const SEBEP_ANAHTARI: Record<Sebep, "reasonHarassment" | "reasonInappropriate" | "reasonSpam" | "reasonOther"> = {
  harassment: "reasonHarassment",
  inappropriate: "reasonInappropriate",
  spam: "reasonSpam",
  other: "reasonOther",
};

export function BildirilenClient({ ilk, ilkHata }: { ilk: Liste; ilkHata: string | null }) {
  const t = useTranslations("messages");
  const locale = useLocale();

  const [durum, setDurum] = useState<BildirimDurumu>("open");
  const [liste, setListe] = useState<Liste>(ilk);
  const [hata, setHata] = useState<string | null>(ilkHata);
  const [silinecek, setSilinecek] = useState<BildirilenMesaj | null>(null);
  const [pasifeAlinacak, setPasifeAlinacak] = useState<{ id: string; ad: string } | null>(null);
  const [bekliyor, baslat] = useTransition();

  /** Saat KİRACININ diliminde (MessagesClient'teki gerekçe). */
  const damga = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone: TENANT_TZ,
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale]
  );
  const an = (iso: string) => damga.format(new Date(iso));

  function hataMetni(kod: string): string {
    if (kod === "tablo_yok") return t("errNotSetUp");
    if (kod === "admin_required" || kod === "forbidden") return t("errForbidden");
    return t("errGeneric");
  }

  async function yukle(d: BildirimDurumu) {
    const r = await bildirimlerAction(d);
    if (!r.ok) {
      setHata(r.error);
      setListe({ kayitlar: [], acikSayisi: null, kirpildi: false });
      return;
    }
    setHata(null);
    setListe(r.data);
  }

  function sekme(d: BildirimDurumu) {
    if (d === durum) return;
    setDurum(d);
    baslat(() => yukle(d));
  }

  function coz(k: BildirilenMesaj) {
    baslat(async () => {
      const r = await bildirimCozAction(k.mesajId);
      if (!r.ok) { toast.error(hataMetni(r.error)); return; }
      toast.success(t("resolvedToast"));
      await yukle(durum);
    });
  }

  function silGonder() {
    const k = silinecek;
    if (!k) return;
    baslat(async () => {
      const r = await mesajSilAction(k.mesajId);
      if (!r.ok) { toast.error(hataMetni(r.error)); return; }
      toast.success(t("deletedToast"));
      setSilinecek(null);
      await yukle(durum);
    });
  }

  function pasifeAlGonder() {
    const h = pasifeAlinacak;
    if (!h) return;
    baslat(async () => {
      const r = await pasifeAlAction(h.id);
      if (!r.ok) { toast.error(hataMetni(r.error)); return; }
      toast.success(t("deactivated", { ad: h.ad }));
      setPasifeAlinacak(null);
      await yukle(durum);
    });
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/admin/mesajlar"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "gap-1.5" })}
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("title")}
        </Link>
        {/* Sekmeler — iki düğme; seçili olan aria-pressed taşır. */}
        <div className="ml-auto flex gap-1 rounded-full bg-surface-panel p-1" role="group" aria-label={t("reportedTitle")}>
          <Button
            variant={durum === "open" ? "default" : "ghost"}
            size="sm"
            aria-pressed={durum === "open"}
            onClick={() => sekme("open")}
          >
            {t("reportedOpen")}
            {liste.acikSayisi !== null && liste.acikSayisi > 0 && (
              <span className="tabular-nums">· {liste.acikSayisi}</span>
            )}
          </Button>
          <Button
            variant={durum === "resolved" ? "default" : "ghost"}
            size="sm"
            aria-pressed={durum === "resolved"}
            onClick={() => sekme("resolved")}
          >
            {t("reportedResolved")}
          </Button>
        </div>
      </div>

      {hata ? (
        <p className="rounded-lg border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
          {hataMetni(hata)}
        </p>
      ) : bekliyor && liste.kayitlar.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">…</p>
      ) : liste.kayitlar.length === 0 ? (
        <p className="rounded-lg border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
          {durum === "open" ? t("reportedEmpty") : t("reportedEmptyResolved")}
        </p>
      ) : (
        <ul className="space-y-3">
          {liste.kayitlar.map((k) => {
            const acik = k.bildirimler.some((b) => b.durum === "open");
            return (
              <li key={k.mesajId} className="rounded-lg border border-border/60 bg-card p-3 sm:p-4">
                {/* KÜNYE: hangi konuşma, kim yazdı, ne zaman */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {k.konusmaTuru === "grup" ? (
                    <Users className="size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <User className="size-3.5 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 truncate">
                    {k.konusmaTuru === "grup"
                      ? t("groupLabel", { ad: k.konusmaBaslik })
                      : t("directWith", { ad: k.konusmaBaslik })}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{an(k.mesajAn)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {t("sender")}: {k.gonderen?.adSoyad ?? "—"}
                  </span>
                  {k.gonderen && !k.gonderen.aktif && (
                    <Badge variant="outline">{t("senderInactive")}</Badge>
                  )}
                </div>

                {/* MESAJ — silinmişse metin YOK */}
                {k.silindiMi ? (
                  <div className="mt-2 rounded-md border border-dashed border-border px-3 py-2 text-sm italic text-muted-foreground">
                    {t("removedByAdmin")}
                    {k.silinmeAn && (
                      <span className="mt-0.5 block text-xs not-italic tabular-nums">
                        {t("removedBy", { ad: k.silenAd ?? "—", an: an(k.silinmeAn) })}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 text-sm">
                    {k.govde}
                  </p>
                )}

                {/* BİLDİRİMLER */}
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("reportedBy")} · {t("reportCount", { n: k.bildirimler.length })}
                  </p>
                  <ul className="mt-1 space-y-1.5">
                    {k.bildirimler.map((b) => (
                      <li key={b.id} className="rounded-md border border-border/40 px-2.5 py-1.5 text-sm">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Badge variant="destructive">
                            <Flag aria-hidden />
                            {t(SEBEP_ANAHTARI[b.sebep])}
                          </Badge>
                          <span className="min-w-0 truncate">{b.bildirenAd ?? "—"}</span>
                          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{an(b.an)}</span>
                        </div>
                        {b.notlar && (
                          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                            “{b.notlar}”
                          </p>
                        )}
                        {b.durum === "resolved" && b.cozulduAn && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <CheckCircle2 className="size-3.5" aria-hidden />
                            {t("resolvedBy", { ad: b.cozenAd ?? "—", an: an(b.cozulduAn) })}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* EYLEMLER — üçü bağımsız */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!k.silindiMi && (
                    <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setSilinecek(k)} disabled={bekliyor}>
                      <Trash2 className="size-3.5" aria-hidden /> {t("deleteMessage")}
                    </Button>
                  )}
                  {k.gonderen && k.gonderen.aktif && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setPasifeAlinacak({ id: k.gonderen!.id, ad: k.gonderen!.adSoyad })}
                      disabled={bekliyor}
                    >
                      <UserX className="size-3.5" aria-hidden /> {t("deactivateUser")}
                    </Button>
                  )}
                  {acik && (
                    <Button size="sm" className="gap-1.5" onClick={() => coz(k)} disabled={bekliyor}>
                      <CheckCircle2 className="size-3.5" aria-hidden /> {t("markResolved")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {liste.kirpildi && (
        <p className="text-center text-xs text-muted-foreground">{t("reportedTruncated")}</p>
      )}

      {/* ── MESAJI SİL ── */}
      <Dialog open={silinecek !== null} onOpenChange={(a) => !a && setSilinecek(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSilinecek(null)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={silGonder} disabled={bekliyor}>
              <Trash2 className="size-4" aria-hidden /> {t("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── HESABI PASİFE AL ── */}
      <Dialog open={pasifeAlinacak !== null} onOpenChange={(a) => !a && setPasifeAlinacak(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deactivateTitle", { ad: pasifeAlinacak?.ad ?? "" })}</DialogTitle>
            <DialogDescription>{t("deactivateDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPasifeAlinacak(null)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={pasifeAlGonder} disabled={bekliyor}>
              <UserX className="size-4" aria-hidden /> {t("deactivateConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
