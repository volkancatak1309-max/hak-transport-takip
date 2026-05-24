"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { startShiftAction, endShiftAction } from "../actions/shift";
import {
  formatDuration,
  formatDateTimeTR,
  formatDateTR,
  formatTimeTR,
  formatDurationShort,
} from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

type Props = {
  active: TimeEntry | null;
  past: TimeEntry[];
  defaultPlate: string;
};

export function PanelClient({ active, past, defaultPlate }: Props) {
  const router = useRouter();
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const elapsedMs = active ? now - new Date(active.started_at).getTime() : 0;

  function handleStart(formData: FormData) {
    startTransition(async () => {
      const res = await startShiftAction(formData);
      if (res.ok) {
        toast.success("Vardiya başlatıldı");
        setStartOpen(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Hata");
      }
    });
  }

  function handleEnd(formData: FormData) {
    startTransition(async () => {
      const res = await endShiftAction(formData);
      if (res.ok) {
        toast.success("Vardiya kapatıldı");
        setEndOpen(false);
        router.refresh();
      } else {
        toast.error(res.error ?? "Hata");
      }
    });
  }

  return (
    <>
      <section className="card p-6 mb-6">
        {active ? (
          <div className="text-center space-y-4">
            <p className="text-sm text-slate-600">Aktif Vardiya</p>
            <p className="font-mono text-5xl sm:text-6xl font-bold text-emerald-600 tabular-nums">
              {formatDuration(elapsedMs)}
            </p>
            <div className="text-sm text-slate-600 space-y-1">
              <p>Başlangıç: {formatDateTimeTR(active.started_at)}</p>
              <p>Başlangıç km: <span className="font-mono">{active.start_km.toLocaleString("tr-TR")}</span></p>
              <p>Plaka: <span className="font-mono">{active.plate ?? "—"}</span></p>
            </div>
            <button
              onClick={() => setEndOpen(true)}
              className="btn-danger btn-lg w-full"
              disabled={pending}
            >
              Vardiya Bitir
            </button>
          </div>
        ) : (
          <div className="text-center space-y-4">
            <p className="text-slate-600">Aktif vardiyanız yok</p>
            <button
              onClick={() => setStartOpen(true)}
              className="btn-success btn-lg w-full"
              disabled={pending}
            >
              Vardiya Başlat
            </button>
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h2 className="font-semibold text-slate-800">Son 30 Gün</h2>
        </div>
        {past.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            Henüz tamamlanmış vardiya yok
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th>Başla</th>
                  <th>Bitiş</th>
                  <th>Süre</th>
                  <th>KM</th>
                  <th>Plaka</th>
                  <th>Not</th>
                </tr>
              </thead>
              <tbody>
                {past.map((e) => {
                  const dur =
                    e.ended_at !== null
                      ? new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()
                      : 0;
                  const km =
                    e.end_km !== null && e.start_km !== null ? e.end_km - e.start_km : null;
                  return (
                    <tr key={e.id}>
                      <td>{formatDateTR(e.started_at)}</td>
                      <td className="font-mono">{formatTimeTR(e.started_at)}</td>
                      <td className="font-mono">{formatTimeTR(e.ended_at)}</td>
                      <td>{formatDurationShort(dur)}</td>
                      <td className="font-mono">{km !== null ? km.toLocaleString("tr-TR") : "—"}</td>
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

      <Modal open={startOpen} onClose={() => setStartOpen(false)} title="Vardiya Başlat">
        <form action={handleStart} className="space-y-4">
          <div>
            <label htmlFor="start_km" className="label">
              Başlangıç KM
            </label>
            <input
              id="start_km"
              name="start_km"
              type="number"
              inputMode="numeric"
              min={0}
              required
              autoFocus
              className="input input-lg"
            />
          </div>
          <div>
            <label htmlFor="plate" className="label">
              Plaka
            </label>
            <input
              id="plate"
              name="plate"
              type="text"
              defaultValue={defaultPlate}
              className="input input-lg font-mono uppercase"
            />
          </div>
          <button type="submit" disabled={pending} className="btn-success btn-lg w-full">
            {pending ? "Kaydediliyor…" : "Vardiya Başlat"}
          </button>
        </form>
      </Modal>

      <Modal open={endOpen} onClose={() => setEndOpen(false)} title="Vardiya Bitir">
        <form action={handleEnd} className="space-y-4">
          <div>
            <label htmlFor="end_km" className="label">
              Bitiş KM
            </label>
            <input
              id="end_km"
              name="end_km"
              type="number"
              inputMode="numeric"
              min={active?.start_km ?? 0}
              required
              autoFocus
              className="input input-lg"
            />
            {active && (
              <p className="text-xs text-slate-500 mt-1">
                Başlangıç: {active.start_km.toLocaleString("tr-TR")} km
              </p>
            )}
          </div>
          <div>
            <label htmlFor="plate_end" className="label">
              Plaka
            </label>
            <input
              id="plate_end"
              name="plate"
              type="text"
              defaultValue={active?.plate ?? defaultPlate}
              className="input input-lg font-mono uppercase"
            />
          </div>
          <div>
            <label htmlFor="notes" className="label">
              Not (opsiyonel)
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              maxLength={500}
              className="input"
              placeholder="Yakıt aldım, lastik patladı, vb."
            />
          </div>
          <button type="submit" disabled={pending} className="btn-danger btn-lg w-full">
            {pending ? "Kaydediliyor…" : "Vardiya Bitir"}
          </button>
        </form>
      </Modal>
    </>
  );
}
