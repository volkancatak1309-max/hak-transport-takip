"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  KeyRound,
  UserPlus,
  MoreHorizontal,
  Pencil,
  Power,
  UserMinus,
  MapPinOff,
  PlayCircle,
  Search,
  ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { toggleActiveAction } from "../../actions/workers";
import { setDepotExemptionAction } from "@/app/actions/depot";
import { formatDate, formatDurationShort } from "@/lib/format";
import { licenseState, LICENSE_BADGE } from "@/lib/worker-ui";
import { UserAvatar } from "@/components/UserAvatar";
import { AddWorkerDialog } from "@/components/admin/AddWorkerDialog";
import { EditWorkerDialog } from "@/components/admin/EditWorkerDialog";
import { SetPinDialog } from "@/components/admin/SetPinDialog";
import { TerminateWorkerDialog } from "@/components/admin/TerminateWorkerDialog";
import { StartShiftForWorkerDialog } from "@/components/admin/StartShiftForWorkerDialog";
import { cn } from "@/lib/utils";
import { HelpTip } from "@/components/help/HelpTip";
import type { WorkerWithStats } from "./page";

type Props = { workers: WorkerWithStats[] };

/**
 * ÇALIŞANLAR — Fernand `7dcc0952` klonu, Authkit cilt.
 *
 * Referansın taşıdığımız dört özelliği:
 *  1. **Mikro kolon etiketi** — 11px uppercase, geniş harf aralığı, üçüncül
 *     ton. Ağır tablo başlığı YOK; etiket satırı neredeyse görünmez durur.
 *  2. **İki satırlı kimlik hücresi** — avatar + ad, altında ikincil satır
 *     (telefon). Kişi bir hücreye sığar, göz tek yere bakar.
 *  3. **Satır içi durum pilleri** — Fernand'da "INVITE PENDING"; bizde yönetici
 *     rozeti ve ehliyet uyarısı adın hemen yanında yaşar.
 *  4. **Sessiz tek eylem** — satır sonunda tek üç-nokta. Fernand'da tek ×.
 *
 * Dikey çizgi yok, zebra yok, ağır kenarlık yok; satırlar yalnız ince ayraçla
 * ayrılır ve bol nefes alır.
 */
export function WorkersClient({ workers }: Props) {
  const router = useRouter();
  const t = useTranslations("workers");
  const tc = useTranslations("common");
  const ta = useTranslations("admin");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  const [pinFor, setPinFor] = useState<WorkerWithStats | null>(null);
  const [editing, setEditing] = useState<WorkerWithStats | null>(null);
  const [terminating, setTerminating] = useState<WorkerWithStats | null>(null);
  const [startingShift, setStartingShift] = useState<WorkerWithStats | null>(null);
  const [status, setStatus] = useState<"active" | "passive" | "all">("active");
  const [q, setQ] = useState("");

  // İşten AYRILANLAR (terminated_at dolu) ana listeden çıkar → aşağıda "Eski
  // Personeller". Pasif = geçici durdurulmuş, ayrılmış DEĞİL. Kayıt silinmez.
  const roster = useMemo(() => workers.filter((w) => !w.terminated_at), [workers]);
  const former = useMemo(() => workers.filter((w) => w.terminated_at), [workers]);

  const visible = useMemo(() => {
    const s = q.trim().toLocaleLowerCase("tr");
    return roster.filter((w) => {
      if (status !== "all" && (status === "active") !== w.is_active) return false;
      if (!s) return true;
      return (
        w.name.toLocaleLowerCase("tr").includes(s) ||
        (w.phone ?? "").includes(s) ||
        (w.assignedPlate ?? "").toLocaleLowerCase("tr").includes(s)
      );
    });
  }, [roster, status, q]);

  function handleToggle(w: WorkerWithStats) {
    if (
      !confirm(
        t("confirmStatus", {
          name: w.name,
          action: w.is_active ? tc("passive") : tc("active"),
        })
      )
    )
      return;
    startTransition(async () => {
      const res = await toggleActiveAction(w.id);
      if (res.ok) {
        toast.success(tc("save"));
        router.refresh();
      } else {
        toast.error(res.error ?? "Error");
      }
    });
  }

  function handleDepotExempt(w: WorkerWithStats) {
    startTransition(async () => {
      const res = await setDepotExemptionAction(w.id);
      if (res.ok) {
        toast.success(tc("save"));
        router.refresh();
      } else {
        toast.error(res.error ?? "Error");
      }
    });
  }

  return (
    <>
      <div>
        <h1 className="flex items-center gap-1 text-[28px] font-semibold leading-tight">
          {t("title")}
          <HelpTip tkey="page_workers" />
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Araç çubuğu — solda durum, sağda arama + birincil eylem. */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={(v) => v && setStatus(v as typeof status)}>
          <SelectTrigger
            className="h-9 w-auto gap-1.5 rounded-full px-3.5 text-[13px]"
            aria-label={t("filter_status")}
          >
            <span>
              {status === "active" ? tc("active") : status === "passive" ? tc("passive") : tc("all")}
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{tc("active")}</SelectItem>
            <SelectItem value="passive">{tc("passive")}</SelectItem>
            <SelectItem value="all">{tc("all")}</SelectItem>
          </SelectContent>
        </Select>
        <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
          {visible.length !== roster.length ? `${visible.length} / ${roster.length}` : visible.length}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              className="h-9 w-[180px] rounded-full pl-9"
            />
          </div>
          <AddWorkerDialog>
            <Button className="h-9 shrink-0" title={ta("addWorker")}>
              <UserPlus className="size-4" />
              <span className="ml-1 hidden sm:inline">{ta("addWorker")}</span>
            </Button>
          </AddWorkerDialog>
        </div>
      </div>

      {/* LİSTE — cam bölüm paneli (§3.1). İçindeki satırlar cam DEĞİL. */}
      <div className="glass-panel mt-4 rounded-[16px] px-4 py-3 sm:px-6 sm:py-4">
        {/* Fernand'ın mikro kolon etiketi — ağır başlık değil, fısıltı. */}
        <div className="hidden items-center gap-4 px-2 pb-2 text-[11px] uppercase tracking-[0.08em] text-text-tertiary md:flex">
          <span className="flex-1">{t("tblName")}</span>
          <span className="w-[96px]">{t("tblPlate")}</span>
          <span className="w-[92px]">{t("tblStatus")}</span>
          <span className="w-[92px]">{t("tblLastShift")}</span>
          <span className="w-[76px] text-right">{t("tblMonthHours")}</span>
          <span className="w-8" aria-hidden />
        </div>

        {visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("noWorkers")}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {visible.map((w) => {
              const ls = licenseState(w.license_expiry);
              return (
                <li
                  key={w.id}
                  className={cn(
                    "group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] px-2 py-3 transition-colors hover:bg-surface-panel md:flex-nowrap",
                    !w.is_active && "opacity-65"
                  )}
                >
                  {/* ① İki satırlı kimlik hücresi */}
                  <Link
                    href={`/admin/workers/${w.id}`}
                    // Mobilde kimlik TAM SATIR: sabit meta sütunları (96+92+92+76+32px)
                    // 390px'te kimliği eziyor ve ad/telefon kırpılıyordu.
                    className="flex w-full min-w-0 items-center gap-3 md:w-auto md:flex-1"
                  >
                    <UserAvatar name={w.name} size="sm" />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[14px] font-medium">{w.name}</span>
                        {w.is_admin && (
                          <span className="rounded-[6px] bg-surface-panel px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                            {tc("admin")}
                          </span>
                        )}
                        {/* Ehliyet uyarısı (migration 025) — adın yanında yaşar. */}
                        {ls && (
                          <span
                            className={cn(
                              "rounded-[6px] px-1.5 py-0.5 text-[10px] font-semibold",
                              LICENSE_BADGE[ls.state]
                            )}
                          >
                            {ls.state === "expired"
                              ? t("licenseExpired")
                              : t("licenseExpiring", { days: ls.days })}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[12px] tabular-nums text-muted-foreground">
                        {w.phone}
                      </span>
                    </span>
                  </Link>

                  <span className="w-[72px] shrink-0 font-mono text-[12px] font-medium uppercase tabular-nums sm:w-[96px]">
                    {w.assignedPlate ?? <span className="text-text-tertiary">—</span>}
                  </span>

                  <span className="w-[92px] shrink-0">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                        w.is_active
                          ? "bg-accent-sky/15 text-accent-sky-text"
                          : "bg-surface-panel text-muted-foreground"
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          w.is_active ? "bg-accent-sky" : "bg-muted-foreground"
                        )}
                      />
                      {w.is_active ? tc("active") : tc("passive")}
                    </span>
                  </span>

                  <span className="w-[84px] shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground sm:w-[92px]">
                    {w.lastShiftAt ? formatDate(w.lastShiftAt, locale) : "—"}
                  </span>

                  <span className="w-[76px] shrink-0 text-right font-mono text-[12px] tabular-nums">
                    {formatDurationShort(w.monthHoursMs, locale)}
                  </span>

                  {/* ④ Sessiz tek eylem */}
                  <span className="w-8 shrink-0 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={pending}
                            aria-label={tc("actions")}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4 text-text-tertiary" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {w.is_active && (
                          <DropdownMenuItem onClick={() => setStartingShift(w)}>
                            <PlayCircle className="size-4" /> {t("startShift")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setEditing(w)}>
                          <Pencil className="size-4" /> {tc("edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setPinFor(w)}>
                          <KeyRound className="size-4" /> {t("setPin")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggle(w)}>
                          <Power className="size-4" />{" "}
                          {w.is_active ? t("deactivate") : t("activate")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTerminating(w)}>
                          <UserMinus className="size-4" /> {t("terminate")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDepotExempt(w)}>
                          <MapPinOff className="size-4" /> {t("depotExempt")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── ESKİ PERSONELLER ── kayıt silinmez; ad geçmiş raporlarda kalır. */}
      {former.length > 0 && (
        <details className="surface-card mt-5 overflow-hidden rounded-[12px]">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-medium">
            <ChevronRight className="size-3.5 text-text-tertiary transition-transform" aria-hidden />
            {t("formerTitle", { n: former.length })}
          </summary>
          <div className="border-t border-border/60 px-4 py-3">
            <p className="mb-3 text-xs text-muted-foreground">{t("formerNote")}</p>
            <ul className="divide-y divide-border/50">
              {former.map((w) => (
                <li
                  key={w.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <UserAvatar name={w.name} size="xs" />
                    <span className="font-medium">{w.name}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono tabular-nums">
                      {t("formerPeriod")}:{" "}
                      {w.employment_start ? formatDate(w.employment_start, locale) : "—"}
                      {" → "}
                      {w.terminated_at ? formatDate(w.terminated_at, locale) : "—"}
                    </span>
                    <Link
                      href={`/admin/workers/${w.id}`}
                      className="font-medium text-accent-sky-text hover:underline"
                    >
                      {t("formerReport")}
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <StartShiftForWorkerDialog
        worker={startingShift ? { id: startingShift.id, name: startingShift.name } : null}
        onClose={() => setStartingShift(null)}
        onDone={() => router.refresh()}
      />
      <EditWorkerDialog worker={editing} onClose={() => setEditing(null)} />
      <SetPinDialog worker={pinFor} onClose={() => setPinFor(null)} />
      <TerminateWorkerDialog
        worker={terminating ? { id: terminating.id, name: terminating.name } : null}
        onClose={() => setTerminating(null)}
      />
    </>
  );
}
