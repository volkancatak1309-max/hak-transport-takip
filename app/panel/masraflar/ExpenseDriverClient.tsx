"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PhotoUpload } from "@/components/PhotoUpload";
import { ReceiptLightbox } from "@/components/ReceiptLightbox";
import { formatDate } from "@/lib/format";
import { APPROVAL_BADGE } from "@/lib/status-ui";
import type { ExpenseCategory, ExpenseEntryWithWorker } from "@/lib/types";
import { createExpenseEntry, getExpenseReceiptUrl } from "@/app/actions/expenses";

export const CATEGORY_ICON: Record<ExpenseCategory, string> = {
  maut: "🛣",
  verpflegung: "🍽",
  parking: "🅿",
  diesel: "⛽",
  sonstige: "📋",
};
const CATEGORIES = Object.keys(CATEGORY_ICON) as ExpenseCategory[];

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Props = { entries: ExpenseEntryWithWorker[] };

export function ExpenseDriverClient({ entries }: Props) {
  const t = useTranslations("expense");
  const tf = useTranslations("fuel");
  const ta = useTranslations("approval");
  const locale = useLocale();
  const router = useRouter();

  const [category, setCategory] = useState<ExpenseCategory>("maut");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!receipt) {
      toast.error(tf("receipt_required"));
      return;
    }
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("category", category);
    fd.set("receipt", receipt);
    setBusy(true);
    try {
      const res = await createExpenseEntry(fd);
      if (!res.ok) {
        toast.error(tf("save_error"));
        return;
      }
      toast.success(tf("saved"));
      form.reset();
      setReceipt(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Receipt className="size-4" /> {t("new_entry")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="spent_at">{t("date")}</Label>
              <Input id="spent_at" name="spent_at" type="date" defaultValue={todayLocal()} className="h-11" required />
            </div>
            <div className="space-y-1.5">
              <Label>{t("category.label")}</Label>
              <Select value={category} onValueChange={(v) => v && setCategory(v as ExpenseCategory)}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_ICON[c]} {t(`category.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">{t("amount")}</Label>
              <Input id="amount" name="amount" inputMode="decimal" placeholder="12,50" className="h-11" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vehicle_plate">{t("plate_optional")}</Label>
              <Input id="vehicle_plate" name="vehicle_plate" className="h-11 uppercase" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">{t("description")}</Label>
              <Input id="description" name="description" placeholder="ASFINAG Mautstelle Innsbruck" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>
                {tf("photo")} <span className="text-destructive">*</span>
              </Label>
              <PhotoUpload onFile={setReceipt} />
            </div>
            <Button type="submit" className="w-full h-12" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {tf("save")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{t("my_entries")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {entries.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("no_entries")}</p>
          ) : (
            entries.map((e) => (
              <ReceiptLightbox
                key={e.id}
                getUrl={() => getExpenseReceiptUrl(e.id)}
                title={`${CATEGORY_ICON[e.category]} ${t(`category.${e.category}`)}`}
                className="flex w-full items-center justify-between gap-2 rounded-md border p-3 text-left"
                info={
                  <>
                    <p className="nums">
                      {formatDate(e.spent_at, locale)} ·{" "}
                      {Number(e.amount).toFixed(2).replace(".", ",")} €
                    </p>
                    {e.description && <p className="text-muted-foreground">{e.description}</p>}
                    {e.status === "rejected" && e.rejection_reason && (
                      <p className="border-l-2 border-destructive/40 pl-3 text-destructive">
                        {e.rejection_reason}
                      </p>
                    )}
                  </>
                }
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {CATEGORY_ICON[e.category]} {t(`category.${e.category}`)}
                  </p>
                  <p className="text-xs text-muted-foreground nums">
                    {formatDate(e.spent_at, locale)} · {Number(e.amount).toFixed(2).replace(".", ",")} €
                  </p>
                </div>
                <Badge variant={APPROVAL_BADGE[e.status]}>{ta(e.status)}</Badge>
              </ReceiptLightbox>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
