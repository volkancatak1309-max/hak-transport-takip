"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setWorkerPinAction } from "@/app/actions/workers";

/**
 * Yönetici bir şoföre YENİ PIN atar. Şoförün MEVCUT PIN'i burada da hiçbir yerde
 * de GÖSTERİLMEZ — `pin_hash` bcrypt'tir, geri döndürülemez ve okunmaya
 * çalışılmaz. Bu ekran yalnızca "üzerine yaz" eylemidir.
 *
 * İki adım: (1) PIN yaz, (2) atanan PIN'i büyük punto göster ki yönetici
 * şoföre telefonda okuyabilsin. İkinci adım aynı zamanda yazım hatası
 * denetimidir — yönetici ne atadığını harfi harfine görür.
 */
export function SetPinDialog({
  worker,
  onClose,
}: {
  worker: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const t = useTranslations("workers");
  const tc = useTranslations("common");
  // errPin/errPinWeak metinleri "admin" sözlüğünde yaşıyor (AddWorkerDialog ile
  // aynı kaynak) — PIN kuralı iki ekranda farklı cümleyle anlatılmasın.
  const ta = useTranslations("admin");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pin, setPin] = useState("");
  const [mustChange, setMustChange] = useState(true);
  // Kaydedildikten sonra gösterilen PIN — "atandı" onayı.
  const [assigned, setAssigned] = useState<string | null>(null);

  /**
   * Kapanışta temizle — açılışta EFEKTLE temizleme yerine. Bileşen sürekli
   * mount'lu kaldığı için bir sonraki şoför önceki denemenin PIN'ini görmemeli;
   * bunu kapanışta yapmak hem tek çıkış noktası (Esc/İptal/Kapat hepsi buradan
   * geçer) hem de render-sonrası setState zinciri doğurmaz.
   */
  function close() {
    setPin("");
    setMustChange(true);
    setAssigned(null);
    onClose();
  }

  function save() {
    if (!worker) return;
    startTransition(async () => {
      const r = await setWorkerPinAction(worker.id, pin, mustChange);
      if (r.ok) {
        setAssigned(pin);
        router.refresh();
        return;
      }
      // Sunucu i18n anahtarı döner (errPin / errPinWeak) — sunucu son sözü
      // söyler, istemci doğrulaması yalnız hızlı geri bildirim içindir.
      if (r.error === "errPin" || r.error === "errPinWeak") {
        toast.error(ta(r.error));
      } else {
        toast.error(t("pinUpdateFailed"));
      }
    });
  }

  const open = !!worker;
  const valid = /^\d{6}$/.test(pin);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {assigned ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-accent-green" aria-hidden />
                {t("pinAssignedTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("pinAssignedFor", { name: worker?.name ?? "" })}
              </DialogDescription>
            </DialogHeader>
            <p className="nums rounded-lg bg-secondary py-6 text-center text-5xl font-bold tracking-widest text-foreground">
              {assigned}
            </p>
            <p className="text-sm text-muted-foreground">
              {mustChange ? t("pinAssignedHintMustChange") : t("pinAssignedHint")}
            </p>
            <DialogFooter>
              <Button className="w-full" onClick={close}>
                {t("newPinClose")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-5" aria-hidden />
                {t("setPinTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("setPinDesc", { name: worker?.name ?? "" })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="new_pin">{t("newPin")}</Label>
              <Input
                id="new_pin"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                placeholder="••••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="nums h-14 text-center text-2xl tracking-widest"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">{t("setPinRule")}</p>
            </div>

            {/* Varsayılan AÇIK: yöneticinin verdiği PIN geçicidir, şoför kendi
                kalıcı PIN'ini belirler. Ekranı çeviremeyen şoför için kapatılabilir. */}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-surface-2/60 p-3">
              <input
                type="checkbox"
                checked={mustChange}
                onChange={(e) => setMustChange(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="text-sm">
                {t("setPinMustChange")}
                <span className="block text-xs text-muted-foreground">
                  {t("setPinMustChangeHint")}
                </span>
              </span>
            </label>

            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={pending}>
                {tc("cancel")}
              </Button>
              <Button onClick={save} disabled={pending || !valid}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {pending ? tc("saving") : t("setPinSubmit")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
