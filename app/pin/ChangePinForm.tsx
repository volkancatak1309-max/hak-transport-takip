"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { changePinAction, type ChangePinState } from "../actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: ChangePinState = {};

export function ChangePinForm() {
  const t = useTranslations("changePin");
  const [state, formAction, pending] = useActionState(changePinAction, initial);

  const errMsg =
    state.error === "weak"
      ? t("errWeak")
      : state.error === "mismatch"
      ? t("errMismatch")
      : state.error === "same"
      ? t("errSame")
      : state.error === "db"
      ? t("errDb")
      : state.error === "validation"
      ? t("errValidation")
      : null;

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pin">{t("newPin")}</Label>
        <Input
          id="pin"
          name="pin"
          type="password"
          autoComplete="new-password"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          placeholder="••••••"
          className="h-12 text-base tracking-widest"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pin_confirm">{t("confirmPin")}</Label>
        <Input
          id="pin_confirm"
          name="pin_confirm"
          type="password"
          autoComplete="new-password"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          placeholder="••••••"
          className="h-12 text-base tracking-widest"
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
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
