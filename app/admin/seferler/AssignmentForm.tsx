"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { AssignmentCategory, AssignmentStop } from "@/lib/types";
import type { AssignmentInput } from "@/app/actions/assignments";

const CATEGORIES: AssignmentCategory[] = [
  "lieferung",
  "abholung",
  "kurier",
  "verteilung",
];

type WorkerOpt = { id: string; name: string };

type Props = {
  workers: WorkerOpt[];
  initial?: AssignmentInput | null;
  busy: boolean;
  onSubmit: (payload: AssignmentInput) => void;
  onCancel: () => void;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function AssignmentForm({ workers, initial, busy, onSubmit, onCancel }: Props) {
  const t = useTranslations("assignments");
  const locale = useLocale();

  const defaultStops: AssignmentStop[] =
    locale === "de"
      ? [
          { label: "Start", address: "" },
          { label: "Ziel", address: "" },
        ]
      : [
          { label: "Çıkış", address: "" },
          { label: "Varış", address: "" },
        ];

  const [workerId, setWorkerId] = useState(initial?.worker_id ?? "");
  const [datetime, setDatetime] = useState(
    initial?.scheduled_at ? toLocalInput(initial.scheduled_at) : ""
  );
  const [category, setCategory] = useState<AssignmentCategory>(
    initial?.category ?? "lieferung"
  );
  const [stops, setStops] = useState<AssignmentStop[]>(
    initial?.stops?.length ? initial.stops : defaultStops
  );
  const [packages, setPackages] = useState(
    initial?.package_count != null ? String(initial.package_count) : ""
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const nowLocal = toLocalInput(new Date().toISOString());

  function setStop(i: number, key: keyof AssignmentStop, value: string) {
    setStops((prev) => prev.map((s, idx) => (idx === i ? { ...s, [key]: value } : s)));
  }
  function addStop() {
    if (stops.length >= 10) return;
    setStops((prev) => [...prev, { label: "", address: "" }]);
  }
  function removeStop(i: number) {
    if (stops.length <= 2) return;
    setStops((prev) => prev.filter((_, idx) => idx !== i));
  }

  function submit() {
    if (!workerId) return toast.error(t("driver"));
    if (!datetime) return toast.error(t("datetime"));
    if (new Date(datetime).getTime() < Date.now() - 60_000)
      return toast.error(t("datetime"));
    const cleaned = stops.map((s) => ({
      label: s.label.trim(),
      address: s.address.trim(),
    }));
    if (cleaned.length < 2 || cleaned.some((s) => !s.label || !s.address))
      return toast.error(t("stops"));

    onSubmit({
      worker_id: workerId,
      scheduled_at: new Date(datetime).toISOString(),
      category,
      stops: cleaned,
      package_count: packages ? Math.max(0, parseInt(packages, 10) || 0) : 0,
      notes: notes.trim() || null,
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{t("driver")}</Label>
        <Select value={workerId} onValueChange={(v) => v && setWorkerId(v)}>
          <SelectTrigger className="h-11">
            <SelectValue placeholder={t("driver")} />
          </SelectTrigger>
          <SelectContent>
            {workers.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="scheduled_at">{t("datetime")}</Label>
        <Input
          id="scheduled_at"
          type="datetime-local"
          value={datetime}
          min={nowLocal}
          onChange={(e) => setDatetime(e.target.value)}
          className="h-11"
        />
      </div>

      <div className="space-y-1.5">
        <Label>{t("category.label")}</Label>
        <Select value={category} onValueChange={(v) => v && setCategory(v as AssignmentCategory)}>
          <SelectTrigger className="h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {t(`category.${c}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>{t("stops")}</Label>
        {stops.map((s, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={s.label}
              onChange={(e) => setStop(i, "label", e.target.value)}
              placeholder={t("stop_label")}
              className="h-10 w-2/5"
            />
            <Input
              value={s.address}
              onChange={(e) => setStop(i, "address", e.target.value)}
              placeholder={t("stop_address")}
              className="h-10 flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0"
              disabled={stops.length <= 2}
              onClick={() => removeStop(i)}
              aria-label="remove"
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addStop}
          disabled={stops.length >= 10}
        >
          <Plus className="size-4" /> {t("add_stop")}
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="packages">{t("packages")}</Label>
        <Input
          id="packages"
          type="number"
          inputMode="numeric"
          min={0}
          value={packages}
          onChange={(e) => setPackages(e.target.value)}
          className="h-11"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">{t("notes")}</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="button" className="flex-1" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t("save_and_notify")}
        </Button>
      </div>
    </div>
  );
}
