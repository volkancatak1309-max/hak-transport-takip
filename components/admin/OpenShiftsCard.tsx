"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Clock, Loader2, Square } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

/** Kapanmamış vardiya — sunucuda hazırlanır (elapsedMs dahil: hidrasyon farkı olmasın). */
export type OpenShiftRow = {
  id: string;
  worker_name: string;
  plate: string | null;
  started_at: string;
  elapsedMs: number;
  /** Vardiya bugünden ÖNCE açıldı mı — gecikmiş kaydın asıl işareti. */
  stale: boolean;
};

/**
 * "Kapanmamış Vardiyalar" — yöneticinin telafi aracı (22.07.2026).
 *
 * Otomatik kapanış kaldırıldı: vardiyayı artık yalnız personel kapatır. Şoför
 * unutursa devreye girecek tek mekanizma watchdog'un Telegram sorusuydu ve o
 * fiilen ölü (hiçbir şoför Telegram'a bağlı değil) — yönetici, unutulan
 * vardiyayı buradan kapatır.
 *
 * Liste TÜM açık vardiyaları gösterir, en eskisi üstte. Bu bilinçli: kart aynı
 * zamanda "şu an sahada kim var" cevabıdır; yalnız gecikmişleri göstermek
 * yöneticiyi "liste boş, demek ki kimse çalışmıyor" yanılgısına düşürürdü.
 * Gecikmişler (dünden kalanlar) bordo ile ayrılır — renk sırası panelin geri
 * kalanıyla aynı: normal=sky, dikkat=bordo.
 */
export function OpenShiftsCard({
  rows,
  readOnly = false,
}: {
  rows: OpenShiftRow[];
  readOnly?: boolean;
}) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [closing, setClosing] = useState<OpenShiftRow | null>(null);

  function confirmClose() {
    const row = closing;
    if (!row) return;
    startTransition(async () => {
      const r = await adminCloseShiftAction(row.id);
      if (r.ok) {
        toast.success(t("openShiftClosed", { name: row.worker_name }));
        setClosing(null);
        router.refresh();
      } else {
        toast.error(t("openShiftCloseErr"));
      }
    });
  }

  const staleCount = rows.filter((r) => r.stale).length;

  return (
    <>
      <Card className="flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold">
            <span className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" />
              {t("openShiftsTitle")}
            </span>
            {staleCount > 0 && (
              <span className="nums rounded-full bg-accent-claret/12 px-2 py-0.5 text-[11px] font-semibold text-accent-claret-text">
                {staleCount}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">
          {rows.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
              <CheckCircle2 className="size-7 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t("openShiftsEmpty")}</p>
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
                        r.stale
                          ? "flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-claret/12 text-accent-claret-text"
                          : "flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-sky/15 text-accent-sky"
                      }
                    >
                      <Clock className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">
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
                            r.stale ? "font-semibold text-accent-claret-text" : ""
                          }
                        >
                          · {formatDurationShort(r.elapsedMs, locale)}
                        </span>
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
                          {t("openShiftClose")}
                        </span>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {/* Kapanış anının "şimdi" olmadığını yönetici bilmeli — yoksa
                  kapattığı vardiyanın süresini yanlış okur. */}
              <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                {t("openShiftsNote")}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Kapatma geri alınabilir bir işlem değil (yalnız vardiya düzenlemeden
          elle düzeltilir) — onay katmanı şart. */}
      <Dialog open={!!closing} onOpenChange={(o) => !o && setClosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("openShiftCloseTitle")}</DialogTitle>
            <DialogDescription>
              {closing
                ? t("openShiftCloseDesc", {
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
              {t("openShiftClose")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
