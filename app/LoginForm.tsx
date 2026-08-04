"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { loginAction, type LoginState } from "./actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: LoginState = {};

/**
 * GERİ SAYAN KİLİT UYARISI.
 *
 * Metin eskiden donuktu: "51 saniye sonra tekrar deneyin" yazıp orada kalıyordu
 * — kullanıcı ne kadar beklediğini bilmiyor, butona basıp basıp aynı duvara
 * toslayarak merdiveni bir basamak daha tırmandırıyordu.
 *
 * AYRI BİLEŞEN, ÇÜNKÜ `key` İLE SIFIRLANIYOR. Sayacı ana formda tutmak, her
 * yeni kilit olayında state'i elle sıfırlamayı gerektirirdi; bunun render
 * sırasında yapılan hâli `Date.now()` çağırdığı için saf değil (React derleyici
 * kuralı), effect'te yapılan hâli ise projede zaten 28 örneği olan
 * `set-state-in-effect` uyarısını artırırdı. Bileşene `key={lockedUntil}`
 * verilince yeni kilit = yeni örnek: sıfırlama React'in kendi işi olur.
 *
 * Süre `seconds`ten (kalan SANİYE) sayılır, mutlak bitiş anından değil:
 * telefonun saati sunucudan sapmış olabilir, kalan süre sapmadan etkilenmez.
 */
function LockNotice({
  seconds,
  onExpire,
}: {
  seconds: number;
  onExpire: () => void;
}) {
  const t = useTranslations("login");
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    let remaining = seconds;
    const id = setInterval(() => {
      remaining -= 1;
      setLeft(remaining > 0 ? remaining : 0);
      if (remaining <= 0) {
        clearInterval(id);
        onExpire();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [seconds, onExpire]);

  const done = left <= 0;
  return (
    <p
      /* Süre dolunca kırmızı KALMAZ: mesaj artık bir hata değil, "tekrar
         deneyebilirsin" bilgisi. */
      className={
        done
          ? "rounded-[12px] bg-surface-panel px-3.5 py-2.5 text-sm text-muted-foreground"
          : "rounded-[12px] bg-status-critical-soft px-3.5 py-2.5 text-sm text-status-critical-text"
      }
      aria-live="polite"
    >
      {done ? t("lockCleared") : t("errLocked", { seconds: left })}
    </p>
  );
}

export function LoginForm() {
  const t = useTranslations("login");
  const [state, formAction, pending] = useActionState(loginAction, initial);
  // Controlled so the phone survives a failed submit (wrong PIN, lock, invalid).
  // A server action resets uncontrolled fields on every non-redirect return; the
  // user should only have to retype the PIN, never the phone.
  const [phone, setPhone] = useState("");

  /**
   * Kilit KİMLİĞİ = bitiş anı (ISO). İki ayrı kilit olayının kalan süresi
   * tesadüfen aynı olabilir, bitiş anı olamaz; sayacın yeniden kurulup
   * kurulmayacağını bu ayırt eder. `expiredKey` yalnız "bu kilidin süresi
   * doldu" bilgisini taşır → buton, sayfa yenilenmeden kendiliğinden açılır.
   */
  const lockKey = state.error === "locked" ? state.lockedUntil ?? null : null;
  const [expiredKey, setExpiredKey] = useState<string | null>(null);
  const locked = !!lockKey && expiredKey !== lockKey;
  // Kimlik lockKey'e bağlı: sayaç her render'da yeniden kurulmasın.
  const handleExpire = useCallback(() => setExpiredKey(lockKey), [lockKey]);

  const errMsg =
    state.error === "invalid" || state.error === "validation"
      ? t("errInvalid")
      : state.error === "inactive"
      ? t("errInactive")
      : state.error === "db"
      ? t("errDb")
      : null;

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label
          htmlFor="phone"
          className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground"
        >
          {t("phone")}
        </Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t("phonePlaceholder")}
          /* h-12 = 48px — dokunma hedefi 44px kuralının üstünde, KORUNDU. */
          className="btn-outline-ring h-12 rounded-[12px] border-0 bg-transparent text-base"
        />
      </div>
      <div className="space-y-2">
        <Label
          htmlFor="pin"
          className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground"
        >
          {t("pin")}
        </Label>
        <Input
          id="pin"
          name="pin"
          type="password"
          autoComplete="current-password"
          inputMode="numeric"
          pattern="\d{4,6}"
          maxLength={6}
          required
          placeholder="••••••"
          className="btn-outline-ring h-12 rounded-[12px] border-0 bg-transparent text-base tracking-widest"
        />
      </div>
      {lockKey ? (
        <LockNotice
          key={lockKey}
          seconds={state.retryAfter ?? 0}
          onExpire={handleExpire}
        />
      ) : (
        errMsg && (
          <p
            className="rounded-[12px] bg-status-critical-soft px-3.5 py-2.5 text-sm text-status-critical-text"
            aria-live="polite"
          >
            {errMsg}
          </p>
        )
      )}
      <Button
        type="submit"
        /* Kilitliyken buton PASİF: basmak yeni bir başarısız deneme sayılmıyor
           (sunucu kilidi bcrypt'ten önce reddediyor) ama kullanıcıyı boşuna
           duvara toslatmanın da anlamı yok. Sayaç sıfırlanınca kendiliğinden
           aktifleşir — sayfa yenilemek gerekmez. */
        disabled={pending || locked}
        className="btn-primary h-12 w-full rounded-full text-base font-semibold"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {pending ? t("pending") : t("submit")}
      </Button>
    </form>
  );
}
