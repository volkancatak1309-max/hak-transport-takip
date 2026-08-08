"use client";
import { useState, useTransition } from "react";
import { MonitorSmartphone, ShieldOff, Snowflake, Undo2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ui-v2/DataTable";
import { StatCard } from "@/components/ui-v2/StatCard";
import { EmptyState } from "@/components/ui-v2/EmptyState";
import { SegmentedControl } from "@/components/ui-v2/SegmentedControl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui-v2/ConfirmDialog";
import type { SessionRow, AuditRow, SecurityWorker } from "@/lib/security-read";
import { revokeSessionsAction, unfreezeAccountAction } from "@/app/actions/security";

/**
 * GÜVENLİK EKRANI (045) — dört sekme: giriş geçmişi, aktif oturumlar,
 * şüpheli işaretler, eylem izi + kullanıcı yönetimi.
 *
 * ⚠️ Ekran görüntüsü / sağ tık / DevTools engelleme BİLEREK YOK. Hiçbiri
 * çalışmıyor (ekran fotoğrafı çekilebilir, DevTools kapatılamaz) ve paneli
 * kullanılamaz hâle getiriyor. Caydırıcılık filigran + iz kaydıyla sağlanıyor.
 */

type Sekme = "gecmis" | "aktif" | "supheli" | "iz";

function zaman(iso: string): string {
  return new Date(iso).toLocaleString("de-AT", { timeZone: "Europe/Vienna" });
}

/** UA'dan okunabilir kısa cihaz adı. Kesin değil — yalnız ekranda ipucu. */
function cihaz(ua: string | null): string {
  if (!ua) return "—";
  const os = /Windows/i.test(ua) ? "Windows"
    : /Android/i.test(ua) ? "Android"
    : /iPhone|iPad|iOS/i.test(ua) ? "iOS"
    : /Mac OS X/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux" : "?";
  const tr = /Edg\//i.test(ua) ? "Edge"
    : /Chrome\//i.test(ua) ? "Chrome"
    : /Firefox\//i.test(ua) ? "Firefox"
    : /Safari\//i.test(ua) ? "Safari" : "?";
  return `${os} · ${tr}`;
}

function konum(s: SessionRow): string {
  if (!s.city && !s.country) return "—";
  return [s.city, s.country].filter(Boolean).join(", ");
}

export function GuvenlikClient({
  sessions,
  open,
  audit,
  workers,
  meId,
  layerEnabled,
  singleSession,
}: {
  sessions: SessionRow[];
  open: SessionRow[];
  audit: AuditRow[];
  workers: SecurityWorker[];
  meId: string;
  layerEnabled: boolean;
  singleSession: boolean;
}) {
  const [sekme, setSekme] = useState<Sekme>("gecmis");
  const [pending, start] = useTransition();
  const [onay, setOnay] = useState<{ id: string; ad: string; dondur: boolean } | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  const supheli = sessions.filter((s) => s.new_device || s.concurrent);
  const donmus = workers.filter((w) => !w.is_active);

  function uygula() {
    if (!onay) return;
    const { id, dondur } = onay;
    setOnay(null);
    setHata(null);
    start(async () => {
      const r = await revokeSessionsAction(id, dondur);
      if (!r.ok) setHata(r.error ?? "Bilinmeyen hata");
    });
  }

  function geriAc(id: string) {
    setHata(null);
    start(async () => {
      const r = await unfreezeAccountAction(id);
      if (!r.ok) setHata(r.error ?? "Bilinmeyen hata");
    });
  }

  const oturumKolon: Column<SessionRow>[] = [
    { key: "kim", header: "Kim", cell: (r) => r.worker_name, sortable: true, sortValue: (r) => r.worker_name },
    { key: "baslangic", header: "Giriş", cell: (r) => zaman(r.started_at), sortable: true, sortValue: (r) => r.started_at },
    { key: "ip", header: "IP", cell: (r) => r.ip ?? "—", hideBelow: "md" },
    { key: "konum", header: "Konum", cell: (r) => konum(r), hideBelow: "md" },
    { key: "cihaz", header: "Cihaz", cell: (r) => cihaz(r.user_agent), hideBelow: "sm" },
    {
      key: "kapi",
      header: "Kapı",
      cell: (r) => (r.source === "mobile" ? "mobil" : "tarayıcı"),
      hideBelow: "md",
    },
    {
      key: "durum",
      header: "Durum",
      // "Açık" ile "canlı" farklı: çıkış yapmadan tarayıcıyı kapatan biri açık
      // kalır ama son 30 dakikada iz bırakmamıştır. Tek kelimeyle "açık" demek
      // patrona olmayan bir eşzamanlılık gösterirdi.
      cell: (r) =>
        r.ended_at ? (
          <span className="text-text-tertiary">{r.ended_reason ?? "kapandı"}</span>
        ) : r.live ? (
          <span className="text-accent-green">canlı</span>
        ) : (
          <span className="text-text-secondary" title={`Son görülme: ${zaman(r.last_seen_at)}`}>
            açık · uykuda
          </span>
        ),
    },
    {
      key: "son",
      header: "Son görülme",
      cell: (r) => zaman(r.last_seen_at),
      sortable: true,
      sortValue: (r) => r.last_seen_at,
      hideBelow: "lg",
    },
    {
      key: "isaret",
      header: "İşaret",
      cell: (r) => (
        <span className="flex gap-1">
          {r.new_device && <span title="Bu cihaz izi bu kişide ilk kez görüldü">🆕</span>}
          {r.concurrent && <span title="Giriş anında başka bir oturumu açıktı">⧉</span>}
        </span>
      ),
    },
  ];

  const izKolon: Column<AuditRow>[] = [
    { key: "kim", header: "Kim", cell: (r) => r.worker_name },
    { key: "ne", header: "Eylem", cell: (r) => r.action, sortable: true, sortValue: (r) => r.action },
    { key: "hedef", header: "Hedef", cell: (r) => r.target ?? "—" },
    { key: "ip", header: "IP", cell: (r) => r.ip ?? "—", hideBelow: "md" },
    { key: "ne_zaman", header: "Zaman", cell: (r) => zaman(r.at), sortable: true, sortValue: (r) => r.at },
  ];

  if (!layerEnabled) {
    return (
      <EmptyState
        title="Güvenlik katmanı kapalı"
        hint="Bu kurulumda SECURITY_LAYER_ENABLED tanımlı değil, bu yüzden giriş oturumu ve eylem izi kaydedilmiyor. Katmanı açmak için env'i ekleyip migration 045'i çalıştırın."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Canlı oturum"
          value={String(open.filter((s) => s.live).length)}
          scope={`${open.length} açık · son 30 dk iz bırakan`}
        />
        <StatCard label="Kayıtlı giriş" value={String(sessions.length)} scope="son 200" />
        <StatCard label="Şüpheli işaret" value={String(supheli.length)} scope="son 200 giriş" tone={supheli.length ? "warning" : "neutral"} />
        <StatCard label="Donmuş hesap" value={String(donmus.length)} scope="tüm kullanıcılar" tone={donmus.length ? "warning" : "neutral"} />
      </div>

      {!singleSession && (
        <p className="text-sm text-text-tertiary">
          Tek oturum kilidi bu kurulumda <strong>kapalı</strong> — bir hesap aynı anda birden çok
          cihazda açık kalabilir. Çoklu oturum yine de işaretlenir.
        </p>
      )}
      {hata && (
        <p className="text-sm text-status-critical-text" role="alert">
          İşlem başarısız: {hata}
        </p>
      )}

      <SegmentedControl
        value={sekme}
        onChange={(v) => setSekme(v as Sekme)}
        options={[
          { value: "gecmis", label: "Giriş geçmişi" },
          { value: "aktif", label: `Aktif oturumlar (${open.length})` },
          { value: "supheli", label: `Şüpheli (${supheli.length})` },
          { value: "iz", label: "Eylem izi" },
        ]}
      />

      {sekme === "gecmis" && (
        <DataTable rows={sessions} columns={oturumKolon} rowKey={(r) => r.id}
          empty={<EmptyState title="Henüz giriş kaydı yok" />} />
      )}
      {sekme === "aktif" && (
        <DataTable rows={open} columns={oturumKolon} rowKey={(r) => r.id}
          empty={<EmptyState title="Açık oturum yok" />} />
      )}
      {sekme === "supheli" && (
        <DataTable rows={supheli} columns={oturumKolon} rowKey={(r) => r.id}
          empty={<EmptyState title="Şüpheli işaret yok" hint="Yeni cihazdan giriş ya da eşzamanlı oturum görülmedi." />} />
      )}
      {sekme === "iz" && (
        <DataTable rows={audit} columns={izKolon} rowKey={(r) => r.id}
          empty={<EmptyState title="Eylem izi boş" />} />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Kullanıcılar</h2>
        <div className="flex flex-col gap-2">
          {workers.map((w) => (
            <div key={w.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">
                  {w.name}
                  {w.is_owner && <span className="ml-2 text-xs text-accent-coral">patron</span>}
                  {w.is_admin && !w.is_owner && <span className="ml-2 text-xs text-text-tertiary">yönetici</span>}
                </span>
                <span className="text-xs text-text-tertiary">
                  {w.phone} · {w.acikOturum} açık oturum
                  {w.acikOturum > 0 && ` (${w.canliOturum} canlı)`}
                  {!w.is_active && <span className="ml-2 text-status-critical-text">donmuş</span>}
                </span>
              </div>
              <div className="flex gap-2">
                {w.is_active ? (
                  <>
                    <Button variant="outline" size="sm" disabled={pending || w.id === meId}
                      onClick={() => setOnay({ id: w.id, ad: w.name, dondur: false })}>
                      <ShieldOff className="size-4" aria-hidden /> Oturumları sonlandır
                    </Button>
                    <Button variant="outline" size="sm" disabled={pending || w.id === meId}
                      onClick={() => setOnay({ id: w.id, ad: w.name, dondur: true })}>
                      <Snowflake className="size-4" aria-hidden /> Dondur
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => geriAc(w.id)}>
                    <Undo2 className="size-4" aria-hidden /> Geri aç
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="flex items-start gap-2 text-xs text-text-tertiary">
        <MonitorSmartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
        Cihaz izi yalnız tarayıcı ve dil bilgisinden türer — aynı tarayıcı sürümünü aynı dille
        kullanan iki kişi aynı izi üretir. &quot;Yeni cihaz&quot; işareti bir ipucudur, kanıt değil.
      </p>

      <ConfirmDialog
        open={onay !== null}
        onOpenChange={(o) => { if (!o) setOnay(null); }}
        title={onay?.dondur ? "Hesabı dondur" : "Oturumları sonlandır"}
        description={
          onay?.dondur
            ? `${onay?.ad}: tüm web ve mobil oturumları kapanacak ve hesap giriş yapamayacak. Geri açılabilir.`
            : `${onay?.ad}: açık tüm web ve mobil oturumları kapanacak. Hesap yeniden giriş yapabilir.`
        }
        confirmLabel={onay?.dondur ? "Dondur" : "Sonlandır"}
        onConfirm={uygula}
        destructive
      />
    </div>
  );
}
