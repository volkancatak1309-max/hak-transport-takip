"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import { toggleActiveAction, resetPinAction } from "../../actions/workers";
import type { Worker } from "@/lib/types";

type Props = { workers: Worker[] };

export function WorkersClient({ workers }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shownPin, setShownPin] = useState<{ worker: string; pin: string } | null>(null);

  function handleToggle(w: Worker) {
    if (
      !confirm(
        `${w.name} adlı çalışanı ${w.is_active ? "PASİF" : "AKTİF"} duruma getirmek istediğinize emin misiniz?`
      )
    )
      return;
    startTransition(async () => {
      const res = await toggleActiveAction(w.id);
      if (res.ok) {
        toast.success("Güncellendi");
        router.refresh();
      } else {
        toast.error(res.error ?? "Hata");
      }
    });
  }

  function handleReset(w: Worker) {
    if (!confirm(`${w.name} adlı çalışanın PIN'i sıfırlansın mı?`)) return;
    startTransition(async () => {
      const res = await resetPinAction(w.id);
      if (res.ok && res.newPin) {
        setShownPin({ worker: w.name, pin: res.newPin });
        router.refresh();
      } else {
        toast.error(res.error ?? "Hata");
      }
    });
  }

  return (
    <>
      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Ad</th>
                <th>Telefon</th>
                <th>Plaka</th>
                <th>Rol</th>
                <th>Durum</th>
                <th className="text-right">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {workers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-slate-500 py-6">
                    Çalışan yok
                  </td>
                </tr>
              ) : (
                workers.map((w) => (
                  <tr key={w.id} className={!w.is_active ? "opacity-50" : ""}>
                    <td className="font-medium">{w.name}</td>
                    <td className="font-mono">{w.phone}</td>
                    <td className="font-mono">{w.plate ?? "—"}</td>
                    <td>
                      {w.is_admin ? (
                        <span className="rounded-full bg-slate-900 text-white text-xs px-2 py-1">
                          Yönetici
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">Çalışan</span>
                      )}
                    </td>
                    <td>
                      {w.is_active ? (
                        <span className="text-emerald-700 text-sm font-medium">Aktif</span>
                      ) : (
                        <span className="text-red-700 text-sm font-medium">Pasif</span>
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => handleReset(w)}
                          disabled={pending}
                          className="btn-secondary btn-sm"
                        >
                          PIN Sıfırla
                        </button>
                        <button
                          onClick={() => handleToggle(w)}
                          disabled={pending}
                          className={w.is_active ? "btn-danger btn-sm" : "btn-success btn-sm"}
                        >
                          {w.is_active ? "Pasifleştir" : "Aktifleştir"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={!!shownPin}
        onClose={() => setShownPin(null)}
        title="Yeni PIN"
      >
        {shownPin && (
          <div className="text-center space-y-4">
            <p className="text-sm text-slate-600">
              <strong>{shownPin.worker}</strong> için yeni PIN:
            </p>
            <p className="font-mono text-5xl font-bold tracking-widest text-slate-900 bg-slate-100 rounded-lg py-6">
              {shownPin.pin}
            </p>
            <p className="text-xs text-red-600">
              Bu PIN sadece şimdi görüntülenir. Çalışana iletip kapatın.
            </p>
            <button onClick={() => setShownPin(null)} className="btn-primary btn-md w-full">
              Anladım, Kapat
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}
