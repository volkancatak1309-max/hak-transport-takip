"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, KeyRound, LockOpen, Pencil, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { SpecGroup, SpecRow } from "@/components/ui-v2";
import {
  formatDate,
  formatTime,
  formatDurationShort,
  workedMs,
  kmDiff,
  formatDuration,
} from "@/lib/format";
import { clearLoginLockAction, toggleActiveAction } from "../../../actions/workers";
import type { LoginLockState } from "@/lib/login-lock";
import { SetPinDialog } from "@/components/admin/SetPinDialog";
import {
  SHIFT_REPORT_DE,
  REPORT_LOCALE,
  buildShiftReportRow,
  FILE_PREFIX_LOWER,
} from "@/lib/report-de";
import { KmEditButton } from "@/components/KmEditButton";
import { EditWorkerDialog } from "@/components/admin/EditWorkerDialog";
import { licenseState, LICENSE_BADGE } from "@/lib/worker-ui";
import { cn } from "@/lib/utils";
import { PACKAGES_ENABLED } from "@/lib/tenant";
import type { WorkerPublic, TimeEntry } from "@/lib/types";
import { TENANT_TZ } from "@/lib/tz";

type Props = {
  worker: WorkerPublic;
  /** Giriş kilidi durumu (lib/login-lock.ts) — kilitliyse kaldırma düğmesi çıkar. */
  loginLock: LoginLockState;
  entries: TimeEntry[];
  monthSummary: { shifts: number; ms: number; km: number; cargo: number };
};

/**
 * ÇALIŞAN DETAYI — Fernand konuşma ekranı klonu (`42c5e961`), Authkit cilt.
 *
 * Referansın taşıdığımız üç özelliği:
 *  1. **Başlıkta satır içi eylem çipleri** — Fernand'da "Assigned to you ·
 *     Snooze · Mark as done". Eylemler ayrı bir buton bloğunda değil, kimliğin
 *     hemen altında sessizce durur.
 *  2. **Sağ ray = künye** — etiket/değer satırları, renkli noktalı etiketler.
 *  3. **Sakin gövde** — ağır tablo başlığı yok; vardiya geçmişi mikro etiketli
 *     satır listesi. Kutu içinde kutu yok.
 *
 * Eski 4'lü KPI kutu ızgarası kaldırıldı: dört ayrı kart, dört ayrı kenarlık
 * ve dört ayrı gölge, tek satırda okunabilecek bir özet için fazlaydı. Sayılar
 * artık künyenin üstünde tek şeritte yaşıyor (Authkit'in OpsStatGrid dili).
 */
export function WorkerDetailClient({
  worker,
  loginLock,
  entries,
  monthSummary,
}: Props) {
  const t = useTranslations("workers");
  const ta = useTranslations("admin");
  const tc = useTranslations("common");
  const tExport = useTranslations("export");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  const nf = locale === "de" ? "de-AT" : "tr-TR";
  const ls = licenseState(worker.license_expiry);

  function handleToggle() {
    if (
      !confirm(
        t("confirmStatus", {
          name: worker.name,
          action: worker.is_active ? tc("passive") : tc("active"),
        })
      )
    )
      return;
    startTransition(async () => {
      const res = await toggleActiveAction(worker.id);
      if (res.ok) {
        toast.success(tc("save"));
        router.refresh();
      } else toast.error(res.error ?? "Error");
    });
  }

  function handleUnlock() {
    startTransition(async () => {
      const res = await clearLoginLockAction(worker.id);
      if (res.ok) {
        toast.success(t("loginUnlocked"));
        router.refresh();
      } else toast.error(res.error ?? "Error");
    });
  }

  async function exportPdf() {
    try {
      const { downloadPdf } = await import("@/components/pdf/ShiftReport");
      // Arayüz dili ne olursa olsun SABİT ALMANCA — bkz. lib/report-de.ts.
      await downloadPdf({
        title: `${SHIFT_REPORT_DE.title} — ${worker.name}`,
        company: SHIFT_REPORT_DE.company,
        address: SHIFT_REPORT_DE.address,
        uid: SHIFT_REPORT_DE.uid,
        period: `${SHIFT_REPORT_DE.period}: ${formatDate(entries[entries.length - 1]?.started_at, REPORT_LOCALE)} – ${formatDate(entries[0]?.started_at, REPORT_LOCALE)}`,
        generatedAt: `${SHIFT_REPORT_DE.generatedAt}: ${new Date().toLocaleString("de-AT", { timeZone: TENANT_TZ })}`,
        footer: SHIFT_REPORT_DE.footer,
        headers: SHIFT_REPORT_DE.headers,
        rows: entries.map((e) => buildShiftReportRow(e, worker.name)),
        filename: `${FILE_PREFIX_LOWER}-${worker.name.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
    } catch {
      toast.error(tExport("error"));
    }
  }

  const stats = [
    { k: "shifts", label: t("totalShifts"), value: monthSummary.shifts.toLocaleString(nf) },
    { k: "hours", label: t("totalHours"), value: formatDuration(monthSummary.ms) },
    { k: "km", label: t("totalKm"), value: monthSummary.km.toLocaleString(nf) },
    // Paket sayacı kapalı kurulumda (lib/tenant.ts) bu kutu her zaman 0 gösterir
    // ve dört sütunluk şeritte anlamsız bir sütun kalır.
    ...(PACKAGES_ENABLED
      ? [{ k: "cargo", label: t("totalCargo"), value: monthSummary.cargo.toLocaleString(nf) }]
      : []),
  ];

  return (
    <>
      {/* ① KİMLİK + SATIR İÇİ EYLEM ÇİPLERİ (Fernand) */}
      <div className="flex flex-wrap items-start gap-4">
        <UserAvatar name={worker.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[24px] font-semibold leading-tight">{worker.name}</h1>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                worker.is_active
                  ? "bg-accent-sky/15 text-accent-sky-text"
                  : "bg-surface-panel text-muted-foreground"
              )}
            >
              <span className={cn("size-1.5 rounded-full", worker.is_active ? "bg-accent-sky" : "bg-muted-foreground")} />
              {worker.is_active ? tc("active") : tc("passive")}
            </span>
            {worker.is_admin && (
              <span className="rounded-[6px] bg-surface-panel px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                {tc("admin")}
              </span>
            )}
            {ls && (
              <span className={cn("rounded-[6px] px-1.5 py-0.5 text-[10px] font-semibold", LICENSE_BADGE[ls.state])}>
                {ls.state === "expired" ? t("licenseExpired") : t("licenseExpiring", { days: ls.days })}
              </span>
            )}
            {/* Kilit rozeti: düğme "ne yapabilirim"i söylüyor, rozet "neden"i. */}
            {loginLock.locked && (
              <span className="rounded-[6px] bg-status-critical-soft px-1.5 py-0.5 text-[10px] font-semibold text-status-critical-text">
                {t("loginLocked", { attempts: loginLock.attempts })}
              </span>
            )}
          </div>

          {/* Eylemler: ayrı blok değil, kimliğin altında sessiz şerit. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="size-3.5" />
              {tc("edit")}
            </Button>
            {/* PIN'i yönetici belirler; mevcut PIN GÖSTERİLMEZ (bcrypt). */}
            <Button variant="outline" size="sm" onClick={() => setPinOpen(true)}>
              <KeyRound className="size-3.5" />
              {t("setPin")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleToggle} disabled={pending}>
              <Power className="size-3.5" />
              {worker.is_active ? t("deactivate") : t("activate")}
            </Button>
            {/* YALNIZ gerçekten kilitliyken. Her zaman duran bir "kilit kaldır"
                düğmesi, kilidin olağan bir durum olduğunu ima ederdi. */}
            {loginLock.locked && (
              <Button variant="outline" size="sm" onClick={handleUnlock} disabled={pending}>
                <LockOpen className="size-3.5" />
                {t("unlockLogin")}
              </Button>
            )}
            <Button size="sm" onClick={exportPdf} disabled={entries.length === 0}>
              <FileText className="size-3.5" />
              {t("pdfForWorker")}
            </Button>
          </div>
        </div>
      </div>

      {/* ② ÖZET ŞERİDİ — dört ayrı kart değil, tek panelde dört sayı. */}
      {/* Sütun sayısı kutu sayısını İZLER: paket sayacı kapalıyken üç kutu
          kalır ve sabit 4 sütunlu ızgarada boş bir hücre açılırdı. */}
      <div
        className={cn(
          "glass-panel mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[16px]",
          stats.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"
        )}
      >
        {stats.map((s) => (
          <div key={s.k} className="px-5 py-4">
            <div className="font-mono text-[26px] font-bold leading-none tabular-nums tracking-[-0.01em]">
              {s.value}
            </div>
            <div className="mt-2 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-6 xl:flex-row xl:items-start">
        {/* ③ VARDİYA GEÇMİŞİ — mikro etiketli sakin liste. */}
        <section className="glass-panel min-w-0 flex-1 rounded-[16px] px-4 py-4 sm:px-6">
          <h2 className="mb-3 text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            {t("fullHistory")}
          </h2>

          {entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{ta("noEntries")}</p>
          ) : (
            <>
              <div className="hidden items-center gap-3 px-2 pb-2 text-[11px] uppercase tracking-[0.08em] text-text-tertiary lg:flex">
                <span className="w-[92px]">{ta("tblDate")}</span>
                <span className="w-[104px]">{ta("tblStart")} → {ta("tblEnd")}</span>
                <span className="w-[70px] text-right">{ta("tblWorked")}</span>
                <span className="w-[54px] text-right">{ta("tblBreak")}</span>
                <span className="w-[64px] text-right">{ta("tblKm")}</span>
                <span className="w-[56px] text-right">{ta("tblCargo")}</span>
                <span className="w-[80px]">{ta("tblPlate")}</span>
                <span className="min-w-0 flex-1">{ta("tblNote")}</span>
                <span className="w-8" aria-hidden />
              </div>

              <ul className="divide-y divide-border/60">
                {entries.map((e) => {
                  const w = workedMs(e);
                  const km = kmDiff(e);
                  const open = e.ended_at === null;
                  return (
                    <li
                      key={e.id}
                      className={cn(
                        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] px-2 py-2.5 transition-colors hover:bg-surface-panel lg:flex-nowrap",
                        open && "bg-accent-coral-soft"
                      )}
                    >
                      <span className="w-[92px] shrink-0 font-mono text-[12px] tabular-nums">
                        {formatDate(e.started_at, locale)}
                      </span>
                      <span className="w-[104px] shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                        {formatTime(e.started_at, locale)} → {formatTime(e.ended_at, locale)}
                      </span>
                      <span className="w-[70px] shrink-0 text-right font-mono text-[12px] font-medium tabular-nums">
                        {formatDurationShort(w, locale)}
                      </span>
                      <span className="w-[54px] shrink-0 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                        {e.break_minutes ?? 0}
                      </span>
                      <span className="w-[64px] shrink-0 text-right font-mono text-[12px] tabular-nums">
                        {km !== null ? km.toLocaleString(nf) : "—"}
                      </span>
                      <span className="w-[56px] shrink-0 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                        {open ? "—" : e.cargo_count ?? "—"}
                      </span>
                      <span className="w-[80px] shrink-0 font-mono text-[12px] uppercase tabular-nums">
                        {e.plate ?? "—"}
                      </span>
                      {/* Not mobilde SARAR, masaüstünde kırpılır. */}
                      <span
                        className="min-w-0 flex-1 break-words text-[12px] text-muted-foreground lg:truncate"
                        title={e.notes ?? ""}
                      >
                        {e.notes ?? "—"}
                      </span>
                      <span className="w-8 shrink-0 text-right">
                        <KmEditButton entryId={e.id} startKm={e.start_km} endKm={e.end_km} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        {/* ④ SAĞ RAY — personel künyesi (Fernand'ın sağ paneli). */}
        <aside className="w-full shrink-0 space-y-4 xl:w-[320px]">
          {/* accent YOK: accent SpecGroup'u cam panele çeviriyor ve bu sayfada
              zaten 3 cam katman var (üst bar + özet + geçmiş) — §3.3 sınırı. */}
          <SpecGroup title={t("dossierTitle")}>
            <SpecRow label={t("tblPhone")} mono muted={!worker.phone}>
              {worker.phone || "—"}
            </SpecRow>
            <SpecRow label={t("tblPlate")} mono muted={!worker.plate}>
              {worker.plate || "—"}
            </SpecRow>
            <SpecRow label={t("employeeNumber")} mono muted={!worker.employee_number}>
              {worker.employee_number || "—"}
            </SpecRow>
            <SpecRow label={t("employmentStart")} mono muted={!worker.employment_start}>
              {worker.employment_start ? formatDate(worker.employment_start, locale) : "—"}
            </SpecRow>
            <SpecRow label={t("licenseExpiry")} mono muted={!worker.license_expiry}>
              {worker.license_expiry ? formatDate(worker.license_expiry, locale) : "—"}
            </SpecRow>
            <SpecRow label={t("email")} muted={!worker.email}>
              {worker.email || "—"}
            </SpecRow>
          </SpecGroup>

          <SpecGroup title={t("emergencyTitle")}>
            <SpecRow label={t("emergencyName")} muted={!worker.emergency_contact_name}>
              {worker.emergency_contact_name || "—"}
            </SpecRow>
            <SpecRow label={t("emergencyRelation")} muted={!worker.emergency_contact_relation}>
              {worker.emergency_contact_relation || "—"}
            </SpecRow>
            <SpecRow label={t("emergencyPhone")} mono muted={!worker.emergency_contact_phone}>
              {worker.emergency_contact_phone || "—"}
            </SpecRow>
          </SpecGroup>
        </aside>
      </div>

      <EditWorkerDialog worker={editOpen ? worker : null} onClose={() => setEditOpen(false)} />
      <SetPinDialog
        worker={pinOpen ? { id: worker.id, name: worker.name } : null}
        onClose={() => setPinOpen(false)}
      />
    </>
  );
}
