"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { createWorkerAction } from "../actions/workers";
import {
  formatDateTimeTR,
  formatDateTR,
  formatTimeTR,
  formatDurationShort,
  formatDuration,
} from "@/lib/format";
import type { TimeEntryWithWorker, Worker } from "@/lib/types";

const NINE_HOURS = 9 * 60 * 60 * 1000;

type Props = {
  entries: TimeEntryWithWorker[];
  workers: Worker[];
  range: string;
  from: string;
  to: string;
  workerFilter: string;
  summary: {
    totalMs: number;
    totalKm: number;
    activeCount: number;
    overLimit: number;
  };
};

export function AdminClient({
  entries,
  workers,
  range,
  from,
  to,
  workerFilter,
  summary,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [addOpen, setAddOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (summary.activeCount === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [summary.activeCount]);

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    if (key === "range" && value !== "custom") {
      params.delete("from");
      params.delete("to");
    }
    router.push(`/admin?${params.toString()}`);
  }

  function handleCreate(formData: FormData) {
    startTransition(async () => {
      const res = await createWorkerAction(formData);
      if (res.ok) {
        toast.success("Çalışan eklendi");
        setAddOpen(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Hata");
      }
    });
  }

  function exportCsv() {
    const header = [
      "Çalışan",
      "Tarih",
      "Başla",
      "Bitiş",
      "Süre (saat:dk)",
      "Başla KM",
      "Bitiş KM",
      "KM Farkı",
      "Plaka",
      "Not",
    ];
    const rows = entries.map((e) => {
      const startTs = new Date(e.started_at).getTime();
      const endTs = e.ended_at ? new Date(e.ended_at).getTime() : Date.now();
      const dur = endTs - startTs;
      const km = e.end_km !== null && e.start_km !== null ? e.end_km - e.start_km : "";
      return [
        e.workers?.name ?? "",
        formatDateTR(e.started_at),
        formatTimeTR(e.started_at),
        e.ended_at ? formatTimeTR(e.ended_at) : "AKTİF",
        formatDurationShort(dur),
        String(e.start_km ?? ""),
        e.end_km !== null ? String(e.end_km) : "",
        km !== "" ? String(km) : "",
        e.plate ?? "",
        (e.notes ?? "").replace(/[\r\n]+/g, " "),
      ];
    });
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hak-vardiyalar-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Toplam Saat" value={formatDuration(summary.totalMs)} mono />
        <SummaryCard label="Toplam KM" value={summary.totalKm.toLocaleString("tr-TR")} mono />
        <SummaryCard
          label="Aktif Vardiya"
          value={String(summary.activeCount)}
          color={summary.activeCount > 0 ? "emerald" : undefined}
        />
        <SummaryCard
          label="9 Saati Aşan"
          value={String(summary.overLimit)}
          color={summary.overLimit > 0 ? "red" : undefined}
        />
      </section>

      <section className="card p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Zaman Aralığı</label>
            <select
              value={range}
              onChange={(e) => setParam("range", e.target.value)}
              className="input min-h-11"
            >
              <option value="today">Bugün</option>
              <option value="week">Bu Hafta</option>
              <option value="month">Bu Ay</option>
              <option value="custom">Özel</option>
            </select>
          </div>
          {range === "custom" && (
            <>
              <div>
                <label className="label">Başlangıç</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setParam("from", e.target.value)}
                  className="input min-h-11"
                />
              </div>
              <div>
                <label className="label">Bitiş</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setParam("to", e.target.value)}
                  className="input min-h-11"
                />
              </div>
            </>
          )}
          <div>
            <label className="label">Çalışan</label>
            <select
              value={workerFilter}
              onChange={(e) => setParam("worker", e.target.value)}
              className="input min-h-11"
            >
              <option value="all">Tümü</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 ml-auto">
            <button onClick={exportCsv} className="btn-secondary btn-md">
              Excel'e Aktar
            </button>
            <button onClick={() => setAddOpen(true)} className="btn-primary btn-md">
              + Çalışan Ekle
            </button>
          </div>
        </div>
      </section>

      <section className="card overflow-hidden">
        {entries.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            Bu filtrede vardiya bulunmuyor
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Çalışan</th>
                  <th>Tarih</th>
                  <th>Başla</th>
                  <th>Bitiş</th>
                  <th>Süre</th>
                  <th>Başla KM</th>
                  <th>Bitiş KM</th>
                  <th>KM Farkı</th>
                  <th>Plaka</th>
                  <th>Not</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const startTs = new Date(e.started_at).getTime();
                  const isActive = e.ended_at === null;
                  const endTs = isActive ? now : new Date(e.ended_at!).getTime();
                  const dur = endTs - startTs;
                  const over = dur > NINE_HOURS;
                  const km =
                    e.end_km !== null && e.start_km !== null ? e.end_km - e.start_km : null;
                  const rowClass = isActive
                    ? "bg-emerald-50"
                    : over
                    ? "bg-red-50"
                    : "";
                  return (
                    <tr key={e.id} className={rowClass}>
                      <td className="font-medium">{e.workers?.name ?? "—"}</td>
                      <td>{formatDateTR(e.started_at)}</td>
                      <td className="font-mono">{formatTimeTR(e.started_at)}</td>
                      <td className="font-mono">
                        {isActive ? (
                          <span className="text-emerald-700 font-semibold">AKTİF</span>
                        ) : (
                          formatTimeTR(e.ended_at)
                        )}
                      </td>
                      <td className={`font-mono ${over ? "text-red-700 font-semibold" : ""}`}>
                        {isActive ? formatDuration(dur) : formatDurationShort(dur)}
                      </td>
                      <td className="font-mono">{e.start_km.toLocaleString("tr-TR")}</td>
                      <td className="font-mono">
                        {e.end_km !== null ? e.end_km.toLocaleString("tr-TR") : "—"}
                      </td>
                      <td className="font-mono">
                        {km !== null ? km.toLocaleString("tr-TR") : "—"}
                      </td>
                      <td className="font-mono">{e.plate ?? "—"}</td>
                      <td className="max-w-[200px] truncate" title={e.notes ?? ""}>
                        {e.notes ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Yeni Çalışan Ekle">
        <form action={handleCreate} className="space-y-4">
          <div>
            <label htmlFor="name" className="label">Ad Soyad</label>
            <input id="name" name="name" required className="input input-lg" />
          </div>
          <div>
            <label htmlFor="phone" className="label">Telefon</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              required
              placeholder="+43 699 1234567"
              className="input input-lg"
            />
          </div>
          <div>
            <label htmlFor="pin" className="label">PIN (4 hane)</label>
            <input
              id="pin"
              name="pin"
              type="text"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              required
              className="input input-lg tracking-widest"
            />
          </div>
          <div>
            <label htmlFor="plate" className="label">Plaka (opsiyonel)</label>
            <input id="plate" name="plate" className="input input-lg font-mono uppercase" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_admin" className="size-4" />
            Yönetici yetkisi ver
          </label>
          <button type="submit" disabled={pending} className="btn-primary btn-lg w-full">
            {pending ? "Kaydediliyor…" : "Çalışan Ekle"}
          </button>
        </form>
      </Modal>
    </>
  );
}

function SummaryCard({
  label,
  value,
  mono,
  color,
}: {
  label: string;
  value: string;
  mono?: boolean;
  color?: "emerald" | "red";
}) {
  const colorClass =
    color === "emerald"
      ? "text-emerald-600"
      : color === "red"
      ? "text-red-600"
      : "text-slate-900";
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
      <p
        className={`text-2xl font-bold mt-1 ${colorClass} ${
          mono ? "font-mono tabular-nums" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
