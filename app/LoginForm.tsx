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
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="phone">{t("phone")}</Label>
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
          className="h-12 text-base"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pin">{t("pin")}</Label>
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
          className="h-12 text-base tracking-widest"
        />
      </div>
      {errMsg && (
        <p className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
          {errMsg}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full h-12 text-base font-semibold">
        {pending && <Loader2 className="size-4 animate-spin" />}
        {pending ? t("pending") : t("submit")}
      </Button>
    </form>
  );
}
