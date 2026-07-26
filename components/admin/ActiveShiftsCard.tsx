"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Clock, Loader2, Square } from "lucide-react";
import { OpsGroup } from "@/components/ui-v2";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminCloseShiftAction } from "@/app/actions/shift";
// readOnly: filo sefi yalniz IZLER. Sunucu tarafi zaten requireAdmin()
// ile korunuyor (adminCloseShiftAction), bu yalniz olu buton gostermemek
// icin — basildiginda hata verecek bir dugme, olmayan dugmeden kotudur.
import { formatDate, formatTime, formatDurationShort } from "@/lib/format";

/** Aktif vardiya — sunucuda hazırlanır (elapsedMs dahil: hidrasyon farkı olmasın). */
export type ActiveShiftRow = {
  id: string;
  worker_name: string;
  plate: string | null;
  started_at: string;
  elapsedMs: number;
  /** Bu vardiyaya uygulanan yasal günlük tavan (gece penceresine değiyorsa 10 sa). */
  capMs: number;
  /** Tavan aşıldı mı — kartta uyarı üreten TEK ölçüt. */
  overLimit: boolean;
};

/**
 * "Aktif Vardiyalar" — şu an sahada açık olan vardiyaların durum listesi.
 *
 * 23.07.2026'da yeniden kuruldu. Önceki hali "Kapanmamış Vardiyalar" adıyla
 * bir UYARI kartıydı ve şu an çalışan HERKESİ listeliyordu: 04:05'te vardiya
 * açmış, saat 10:00'da normal çalışan şoför de "kapanmamış" sayılıyordu.
 * Bu, kartı sürekli dolu tutarak uyarı değerini sıfırlıyordu — her şey
 * uyarıysa hiçbir şey uyarı değildir.
 *
 * Şimdi: kart nötr bir DURUM listesi. Uyarı yalnız yasal günlük tavanı aşan
 * vardiyalarda çıkar (AZG § 9 Abs. 1 — 12 sa, gece penceresine değiyorsa 10
 * sa); onlar bordo işaretlenir ve listenin başında durur. Renk sırası panelin
 * geri kalanıyla aynı: normal=sky, dikkat=bordo. Gold/uyarı tonu KULLANILMAZ.
 *
 * Eski "dünden kalma" ölçütü bilerek kaldırıldı: 22:00'de başlayan gece
 * vardiyası ertesi güne sarkar ve tamamen normaldir.
 *
 * "Kapat" butonu kalır — otomatik kapanış yok, vardiyayı yalnız personel
 * kapatır; kapanmadıysa yönetici buradan kapatabilir.
 */
export function ActiveShiftsCard({
  rows,
  readOnly = false,
}: {
  rows: ActiveShiftRow[];
  readOnly?: boolean;
}) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [closing, setClosing] = useState<ActiveShiftRow | null>(null);

  function confirmClose() {
    const row = closing;
    if (!row) return;
    startTransition(async () => {
      const r = await adminCloseShiftAction(row.id);
      if (r.ok) {
        toast.success(t("activeShiftClosed", { name: row.worker_name }));
        setClosing(null);
        router.refresh();
      } else {
        toast.error(t("activeShiftCloseErr"));
      }
    });
  }

  const overCount = rows.filter((r) => r.overLimit).length;

  return (
    <>
      {/* Stellate gruplu blok gövdesi. Sayaç rozeti OpsGroup'ta (mercan);
          tavan aşımı rozeti AYRI kalır — biri "kaç kişi sahada", diğeri gerçek
          uyarı. Tek rozette birleşseydi normal vardiya da uyarı rengi alırdı. */}
      <OpsGroup
        title={t("activeShiftsTitle")}
        count={rows.length}
        icon={<Clock className="size-4 text-accent-coral" />}
        action={
          overCount > 0 ? (
            <span className="rounded-full bg-status-critical-soft px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-status-critical-text">
              {t("activeShiftsOverBadge", { count: overCount })}
            </span>
          ) : null
        }
      >
        <div className="flex flex-1 flex-col">
          {rows.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
              <CheckCircle2 className="size-7 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t("activeShiftsEmpty")}</p>
            </div>
          ) : (
            <>
              <ul className="-mx-1 max-h-[320px] space-y-1 overflow-y-auto">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 rounded-lg px-1.5 py-2 transition-colors hover:bg-surface-2/60"
                  >
                    <span
                      className={
                        r.overLimit
                          ? "flex size-7 shrink-0 items-center justify-center rounded-lg bg-status-critical-soft text-status-critical-text"
                          : "flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-sky/15 text-accent-sky-text"
                      }
                    >
                      <Clock className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">
                        <span className="font-medium">{r.worker_name}</span>
                        {r.plate && (
                          <span className="nums uppercase text-muted-foreground">
                            {" "}
                            · {r.plate}
                          </span>
                        )}
                      </div>
                      <div className="nums flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>
                          {formatDate(r.started_at, locale)}{" "}
                          {formatTime(r.started_at, locale)}
                        </span>
                        <span
                          className={
                            r.overLimit
                              ? "font-semibold text-status-critical-text"
                              : ""
                          }
                        >
                          · {formatDurationShort(r.elapsedMs, locale)}
                        </span>
                        {/* Uyarının GEREKÇESİ satırda yazılı: yönetici hangi
                            tavanın aşıldığını görmeden karar veremez — gece
                            vardiyasında tavan 10 saate iner. */}
                        {r.overLimit && (
                          <span className="rounded bg-status-critical-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-status-critical-text">
                            {t("activeShiftsOverTag", {
                              hours: Math.round(r.capMs / 3_600_000),
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setClosing(r)}
                        disabled={pending}
                        className="shrink-0"
                      >
                        <Square className="size-4" />
                        <span className="hidden sm:inline">
                          {t("activeShiftClose")}
                        </span>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {/* Kapanış anının "şimdi" olmadığını yönetici bilmeli — yoksa
                  kapattığı vardiyanın süresini yanlış okur. */}
              <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                {t("activeShiftsNote")}
              </p>
            </>
          )}
        </div>
      </OpsGroup>

      {/* Kapatma geri alınabilir bir işlem değil (yalnız vardiya düzenlemeden
          elle düzeltilir) — onay katmanı şart. */}
      <Dialog open={!!closing} onOpenChange={(o) => !o && setClosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("activeShiftCloseTitle")}</DialogTitle>
            <DialogDescription>
              {closing
                ? t("activeShiftCloseDesc", {
                    name: closing.worker_name,
                    plate: closing.plate ?? "—",
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)}>
              {tc("cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmClose} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("activeShiftClose")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
