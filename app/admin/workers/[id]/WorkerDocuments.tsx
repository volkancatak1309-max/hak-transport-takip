"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, FileBadge, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/ui-v2";
import { formatDate } from "@/lib/format";
import {
  saveWorkerDocumentAction,
  deleteWorkerDocumentAction,
} from "@/app/actions/documents";
import type { DocumentType, WorkerDocument } from "@/lib/documents-db";

/**
 * Satır + SUNUCUDA hesaplanmış kalan gün.
 *
 * ⚠️ `days` neden burada değil de sunucuda: render sırasında `Date.now()`
 * çağırmak saf olmayan bir işlem (react-hooks/purity) ve sunucu ile istemci
 * farklı anlarda ölçerse hidrasyon uyuşmazlığı doğar — gece yarısını geçen
 * bir istekte "1 gün kaldı" ile "doldu" yan yana render edilebilirdi.
 */
type Satir = WorkerDocument & { type: DocumentType | null; days: number };

/**
 * ŞOFÖRÜN BELGELERİ (migration 078) — personel kartındaki bölüm.
 *
 * ═══ NEDEN EHLİYETİN YANINDA DEĞİL, AYRI BÖLÜM ═══
 *
 * Ehliyet `workers` satırının bir ALANI ve şoför formundan düzenleniyor;
 * belgeler AYRI satırlar ve kendi türleri var. İkisini tek listede toplamak
 * "Ehliyet" satırının nereden düzenlendiğini belirsiz yapardı — kullanıcı
 * silmeye çalışır, silinemez.
 *
 * ═══ DURUM ROZETİ EŞİĞİ TÜRDEN GELİR ═══
 *
 * Her türün kendi `warnDays` değeri var; rozet sabit bir 30 günle değil o
 * değerle hesaplanıyor. Aksi hâlde ekran "sarı değil" derken pano kalem
 * üretirdi ve iki yüzey birbirini tutmazdı.
 */
export function WorkerDocuments({
  workerId,
  docs,
  types,
  tabloYok,
}: {
  workerId: string;
  docs: Satir[];
  types: DocumentType[];
  tabloYok: boolean;
}) {
  const t = useTranslations("workers");
  const ts = useTranslations("settings");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [acik, setAcik] = useState(false);

  const aktifTurler = types.filter((x) => x.active);

  function durum(d: Satir): { tone: "critical" | "warning" | "neutral"; text: string } {
    const gun = d.days;
    if (gun < 0) return { tone: "critical", text: t("docExpired", { days: Math.abs(gun) }) };
    const esik = d.type?.warnDays ?? 30;
    if (gun <= esik) return { tone: "warning", text: t("docExpiring", { days: gun }) };
    return { tone: "neutral", text: t("docValid", { days: gun }) };
  }

  async function kaydet(fd: FormData) {
    const r = await saveWorkerDocumentAction(fd);
    if (r.ok) {
      toast.success(t("docSaved"));
      setAcik(false);
      return;
    }
    toast.error(
      r.sebep === "tablo_yok" ? ts("doc_migration_needed") : ts("save_error")
    );
  }

  async function sil(fd: FormData) {
    const r = await deleteWorkerDocumentAction(fd);
    if (r.ok) toast.success(t("docDeleted"));
    else toast.error(ts("save_error"));
  }

  return (
    <section className="surface-card space-y-4 rounded-[16px] p-5">
      <div className="flex items-center gap-1.5">
        <FileBadge className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="text-[15px] font-semibold">{t("documents")}</h2>
      </div>

      {tabloYok ? (
        <p className="flex items-start gap-1.5 rounded-lg border border-accent-gold/50 bg-accent-gold-soft px-3 py-2 text-xs font-medium text-accent-gold-text">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>{ts("doc_migration_needed")}</span>
        </p>
      ) : aktifTurler.length === 0 ? (
        // Tür yoksa belge de eklenemez. Boş bir form göstermek, doldurulamayan
        // bir alan sunmak olurdu; kullanıcı önce sözlüğünü kurmalı.
        <p className="text-xs text-muted-foreground">{t("docNoTypes")}</p>
      ) : (
        <>
          {docs.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("docEmpty")}</p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
              {docs.map((d) => {
                const s = durum(d);
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-medium text-foreground">
                        {d.type?.label ?? "—"}
                      </span>
                      {d.documentNo && (
                        <span className="nums ml-2 text-[11px] text-text-tertiary">
                          {d.documentNo}
                        </span>
                      )}
                    </span>
                    <span className="nums text-xs text-muted-foreground">
                      {formatDate(d.expiresAt, locale)}
                    </span>
                    <StatusChip tone={s.tone}>{s.text}</StatusChip>
                    <form action={(fd) => startTransition(() => void sil(fd))}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="worker_id" value={workerId} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        aria-label={t("docDelete")}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}

          {acik ? (
            <form
              action={(fd) => startTransition(() => void kaydet(fd))}
              className="space-y-3 rounded-lg border border-border/60 p-3"
            >
              <input type="hidden" name="worker_id" value={workerId} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="doc_type">{t("docType")}</Label>
                  <select
                    id="doc_type"
                    name="type_id"
                    required
                    className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    {aktifTurler.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc_expiry">{t("docExpiry")}</Label>
                  {/* ZORUNLU: tarihsiz kayıt hiçbir uyarı üretmez ve
                      "belge var" yanılsaması yaratır (078 gerekçesi). */}
                  <Input id="doc_expiry" name="expires_at" type="date" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc_no">{t("docNumber")}</Label>
                  <Input id="doc_no" name="document_no" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc_note">{t("docNote")}</Label>
                  <Input id="doc_note" name="note" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? ts("saving") : ts("save")}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAcik(false)}>
                  {ts("cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <Button type="button" variant="outline" onClick={() => setAcik(true)}>
              <Plus className="size-4" />
              {t("docAdd")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
