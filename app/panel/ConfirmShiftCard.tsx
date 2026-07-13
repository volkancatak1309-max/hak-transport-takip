"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmShiftStartAction } from "@/app/actions/driver-panel";
import { formatTime } from "@/lib/format";

type Props = {
  plate: string | null;
  startedAt: string;
  onLater: () => void;
};

/**
 * İş 1 — Kontakla otomatik başlayan vardiya için tam ekran, tek dokunuşluk
 * "VARDİYAYI ONAYLA" kartı. Şoför onaylamasa da veri akmaya devam eder
 * ("Daha sonra" ile ana ekrana geçebilir; vardiya "onay bekliyor" kalır).
 */
export function ConfirmShiftCard({ plate, startedAt, onLater }: Props) {
  const t = useTranslations("panel");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const r = await confirmShiftStartAction();
      if (r.ok) {
        toast.success(t("v2ConfirmedToast"));
        router.refresh();
      } else {
        toast.error(t("v2ConfirmErr"));
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-[#0a0d16]/90 px-6 backdrop-blur-md page-enter">
      <div className="flex size-20 items-center justify-center rounded-full bg-accent-sky/15 text-accent-sky pulse-soft">
        <Truck className="size-10" aria-hidden />
      </div>

      <div className="space-y-3 text-center">
        <h1 className="text-3xl font-bold text-foreground">
          {t("v2ConfirmTitle")}
        </h1>
        <p className="mx-auto max-w-sm text-base text-muted-foreground">
          {t("v2ConfirmDesc")}
        </p>
        <div className="flex items-center justify-center gap-3 text-sm">
          {plate && (
            <span className="nums rounded-full bg-accent-sky/15 px-3 py-1 font-medium uppercase text-accent-sky">
              {plate}
            </span>
          )}
          <span className="text-muted-foreground">
            {t("started")}:{" "}
            <span className="nums font-medium text-foreground">
              {formatTime(startedAt, locale)}
            </span>
          </span>
        </div>
      </div>

      <div className="w-full max-w-md space-y-4">
        <Button
          onClick={confirm}
          disabled={pending}
          className="h-24 w-full rounded-2xl text-2xl font-bold tracking-wide"
        >
          {pending ? (
            <Loader2 className="size-8 animate-spin" aria-hidden />
          ) : (
            <CheckCircle2 className="size-8" aria-hidden />
          )}
          {t("v2ConfirmBtn")}
        </Button>
        <Button
          variant="ghost"
          onClick={onLater}
          disabled={pending}
          className="h-12 w-full text-base text-muted-foreground"
        >
          {t("v2ConfirmLater")}
        </Button>
      </div>
    </div>
  );
}
