"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { loginAction, type LoginState } from "./actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: LoginState = {};

export function LoginForm() {
  const t = useTranslations("login");
  const [state, formAction, pending] = useActionState(loginAction, initial);
  // Controlled so the phone survives a failed submit (wrong PIN, lock, invalid).
  // A server action resets uncontrolled fields on every non-redirect return; the
  // user should only have to retype the PIN, never the phone.
  const [phone, setPhone] = useState("");

  const errMsg =
    state.error === "locked"
      ? t("errLocked", { seconds: state.retryAfter ?? 0 })
      : state.error === "invalid" || state.error === "validation"
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
      {errMsg && (
        <p className="rounded-[12px] bg-status-critical-soft px-3.5 py-2.5 text-sm text-status-critical-text">
          {errMsg}
        </p>
      )}
      <Button
        type="submit"
        disabled={pending}
        className="btn-primary h-12 w-full rounded-full text-base font-semibold"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {pending ? t("pending") : t("submit")}
      </Button>
    </form>
  );
}
