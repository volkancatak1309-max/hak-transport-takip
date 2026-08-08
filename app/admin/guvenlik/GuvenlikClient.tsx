"use client";
import { useState, useTransition } from "react";
import {
  MonitorSmartphone,
  ShieldOff,
  Snowflake,
  Undo2,
  Check,
  X,
  Power,
  Clock,
  ChevronDown,
  Eye,
} from "lucide-react";
import { DataTable, type Column } from "@/components/ui-v2/DataTable";
import { StatCard } from "@/components/ui-v2/StatCard";
import { EmptyState } from "@/components/ui-v2/EmptyState";
import { SegmentedControl } from "@/components/ui-v2/SegmentedControl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui-v2/ConfirmDialog";
import { Input } from "@/components/ui/input";
import type { SessionRow, AuditRow, SecurityWorker } from "@/lib/security-read";
import type { ChangeField } from "@/lib/security-read";
import type {
  PendingDevice,
  PendingCountry,
  AccessRule,
} from "@/lib/access-read";
import { revokeSessionsAction, unfreezeAccountAction } from "@/app/actions/security";
import {
  approveDeviceAction,
  approveCountryAction,
  setAccessHoursAction,
  setGateExemptAction,
  killSwitchConfirmAction,
  killSwitchActivateAction,
  killSwitchDeactivateAction,
  getDayReplayAction,
  lookupFingerprintAction,
} from "@/app/actions/access";
import { enterShadowAction } from "@/app/actions/shadow";
import type { ReplayEvent } from "@/lib/replay";
import type { FingerprintHit } from "@/lib/pdf-fingerprint";

/**
 * GÜVENLİK EKRANI (045) — dört sekme: giriş geçmişi, aktif oturumlar,
 * şüpheli işaretler, eylem izi + kullanıcı yönetimi.
 *
 * ⚠️ Ekran görüntüsü / sağ tık / DevTools engelleme BİLEREK YOK. Hiçbiri
 * çalışmıyor (ekran fotoğrafı çekilebilir, DevTools kapatılamaz) ve paneli
 * kullanılamaz hâle getiriyor. Caydırıcılık filigran + iz kaydıyla sağlanıyor.
 */

type Sekme =
  | "gecmis"
  | "aktif"
  | "supheli"
  | "iz"
  // ── ERİŞİM KAPILARI (046) — yalnız gatesEnabled iken görünür ─────────────
  | "onaylar"
  | "kurallar"
  | "anahtar"
  // ── DALGA 3 ──────────────────────────────────────────────────────────────
  | "oynatici"
  | "parmakizi";

export type KillSwitchView = {
  active: boolean;
  activatedAt: string | null;
  reason: string | null;
  lockedUntil: string | null;
  kalanHak: number;
};

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

/**
 * Eylem adlarının okunur karşılığı.
 *
 * Tablo ham `action` dizesini basıyordu ("page_view", "kill_switch_on") — yani
 * ekran, veritabanı kolonunu olduğu gibi gösteriyordu. Bilinmeyen bir ad
 * gelirse ham hâli basılır: sözlükte olmayan yeni bir eylem satırı KAYBETMEZ.
 */
const EYLEM_ADI: Record<string, string> = {
  page_view: "Sayfa görüntüleme",
  export_pdf: "PDF indirme",
  export_csv: "CSV indirme",
  session_revoke: "Oturumları sonlandırdı",
  account_freeze: "Hesabı dondurdu",
  account_unfreeze: "Hesabı geri açtı",
  access_approve: "Erişim onayladı",
  access_deny: "Erişim reddetti",
  access_hours: "Saat aralığı değiştirdi",
  kill_switch_on: "SİSTEMİ KAPATTI",
  kill_switch_off: "Sistemi geri açtı",
  create: "Kayıt oluşturdu",
  update: "Kayıt değiştirdi",
  delete: "Kayıt sildi",
  // Dört eski iz tablosundan gelen satırlar (birleşik zaman çizgisi)
  admin_grant: "Yönetici yetkisi verdi",
  admin_revoke: "Yönetici yetkisini aldı",
  shift_edit: "Vardiya düzenledi",
  leave_create: "İzin oluşturdu",
  leave_update: "İzin değiştirdi",
  leave_delete: "İzin sildi",
  leave_approve: "İzin onayladı",
  leave_reject: "İzin reddetti",
  login_unlock: "Giriş kilidini açtı",
  shadow_enter: "GÖLGE MODUNA girdi",
  shadow_exit: "Gölge modundan çıktı",
};

/**
 * Alan adlarının Türkçe karşılığı.
 *
 * Sözlükte olmayan alan HAM ADIYLA görünür — yeni bir kolon eklendiğinde satır
 * kaybolmaz, yalnız İngilizce görünür. Sessizce gizlemek, izin en çok
 * güvenilmesi gereken yerinde veri kaybı olurdu.
 */
const ALAN_ADI: Record<string, string> = {
  plate: "Plaka",
  make: "Marka",
  model: "Model",
  year: "Model yılı",
  status: "Durum",
  fleet: "Filo",
  imei: "IMEI",
  flespi_device_id: "Cihaz no",
  inspection_due: "Muayene bitişi",
  insurance_due: "Sigorta bitişi",
  tank_capacity_l: "Depo (L)",
  assigned_worker_id: "Atanmış şoför",
  name: "Ad",
  phone: "Telefon",
  is_admin: "Yönetici",
  is_active: "Aktif",
  is_owner: "Patron",
  counts_as_driver: "Şoför sayılır",
  employee_number: "Personel no",
  employment_type: "Sözleşme türü",
  employment_start: "İşe giriş",
  terminated_at: "İşten çıkış",
  managed_fleet: "Yönettiği filo",
  license_no: "Ehliyet no",
  license_expiry: "Ehliyet bitişi",
  birth_date: "Doğum tarihi",
  email: "E-posta",
  address: "Adres",
  social_security_no: "Sigorta no",
  emergency_contact_name: "Acil durum kişisi",
  emergency_contact_phone: "Acil durum telefonu",
  emergency_contact_relation: "Acil durum yakınlığı",
  access_hours_start: "Giriş saati (baş)",
  access_hours_end: "Giriş saati (bit)",
  allowed_countries: "İzinli ülkeler",
  center_lat: "Merkez enlem",
  center_lng: "Merkez boylam",
  radius_m: "Yarıçap (m)",
  rule_kind: "Kural türü",
  purpose: "Amaç",
  active: "Etkin",
  worker_id: "Personel",
  scheduled_at: "Planlanan zaman",
  category: "Kategori",
  stops: "Duraklar",
  package_count: "Paket sayısı",
  notes: "Not",
  cancel_reason: "İptal sebebi",
  exempt_date: "Muafiyet günü",
  cleared_rows: "Silinen deneme",
  break_minutes: "Mola (dk)",
  started_at: "Başlangıç",
  ended_at: "Bitiş",
  start_date: "Başlangıç",
  end_date: "Bitiş",
  leave_type: "İzin türü",
};

/** Ekranda gösterilecek alan sayısı; gerisi katlanır. */
const ACIK_ALAN = 3;

/**
 * "Değişiklik" hücresi — her alan AYRI SATIR.
 *
 * ── NEDEN TEK DİZE DEĞİL ───────────────────────────────────────────────────
 * Önce sunucu tek satırlık bir özet üretiyordu ("make: Mercedes → Fiat · model:
 * … · …"). Dört değişiklik yan yana dizilince hücre okunmaz bir metin bloğuna
 * dönüşüyordu. Artık alanlar ayrı satırlarda, aralarında ince ayırıcı var.
 *
 * ── RENK TOKEN'LARI (elle hex YOK) ─────────────────────────────────────────
 *   eski  → text-status-critical-text   (globals.css --status-critical-text)
 *   yeni  → text-accent-green-text      (globals.css --accent-green-text)
 *   alan  → text-text-tertiary          (nötr)
 * Yeşilin -text varyantı bu iş için EKLENDİ: --accent-green dolgu/ikon için
 * tasarlanmış ve metin olarak açık temada AA'yı geçmiyordu (3.27:1).
 */
function Degisiklik({ alanlar }: { alanlar: ChangeField[] }) {
  const [acik, setAcik] = useState(false);
  if (alanlar.length === 0) {
    return <span className="text-xs text-text-tertiary">—</span>;
  }
  const gorunen = acik ? alanlar : alanlar.slice(0, ACIK_ALAN);
  const kalan = alanlar.length - gorunen.length;

  return (
    <div className="flex flex-col text-xs">
      {gorunen.map((f, i) => (
        <div
          key={`${f.alan}-${i}`}
          className={
            "flex flex-wrap items-baseline gap-x-1.5 py-1" +
            (i > 0 ? " border-t border-border/60" : "")
          }
        >
          <span className="text-text-tertiary">{ALAN_ADI[f.alan] ?? f.alan}</span>
          <span className="text-status-critical-text line-through decoration-1">
            {f.eski}
          </span>
          <span className="text-text-tertiary" aria-hidden>→</span>
          <span className="text-accent-green-text">{f.yeni}</span>
        </div>
      ))}
      {(kalan > 0 || acik) && (
        <button
          type="button"
          onClick={() => setAcik((v) => !v)}
          aria-expanded={acik}
          className="mt-1 self-start text-xs text-text-secondary underline underline-offset-2"
        >
          {acik ? "daha az göster" : `+${kalan} alan daha`}
        </button>
      )}
    </div>
  );
}

/**
 * Kişi başına saat aralığı satırı (KAPI 3).
 *
 * Kendi yerel durumunu tutar: aynı ekranda 30 satır varsa üst bileşende 60
 * ayrı alan tutmak yerine her satır kendi iki kutusunu yönetir. Kaydetme yine
 * sunucu action'ıdır; buradaki durum yalnız yazarken görünen metindir.
 */
function SaatSatiri({
  kural,
  pending,
  onKaydet,
  onMuafiyet,
}: {
  kural: AccessRule;
  pending: boolean;
  onKaydet: (workerId: string, bas: string, bit: string) => void;
  onMuafiyet: (workerId: string, muaf: boolean) => void;
}) {
  const [bas, setBas] = useState(kural.start ?? "");
  const [bit, setBit] = useState(kural.end ?? "");
  const degisti = bas !== (kural.start ?? "") || bit !== (kural.end ?? "");

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">
          {kural.name}
          {kural.is_owner && (
            <span className="ml-2 text-xs text-accent-coral">patron · muaf</span>
          )}
        </span>
        <span className="text-xs text-text-tertiary">
          Etkin:{" "}
          {kural.is_owner
            ? "kısıt yok (patron)"
            : kural.gate_exempt
              ? "kısıt yok (muaf) · anahtar hariç"
              : kural.etkin}{" "}
          · Ülke: {kural.etkinCountries.join(", ")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Input value={bas} onChange={(e) => setBas(e.target.value)}
          placeholder="07:00" className="w-[86px]" autoComplete="off"
          aria-label={`${kural.name} başlangıç saati`} />
        <span className="text-text-tertiary">–</span>
        <Input value={bit} onChange={(e) => setBit(e.target.value)}
          placeholder="21:00" className="w-[86px]" autoComplete="off"
          aria-label={`${kural.name} bitiş saati`} />
        <Button variant="outline" size="sm" disabled={pending || !degisti}
          onClick={() => onKaydet(kural.id, bas, bit)}>
          Kaydet
        </Button>
        {/* Patron zaten dört kapıdan da muaf; ona ayrıca muafiyet vermek
            anlamsız ve kafa karıştırıcı olurdu. */}
        {!kural.is_owner && (
          <Button variant="outline" size="sm" disabled={pending}
            onClick={() => onMuafiyet(kural.id, !kural.gate_exempt)}>
            {kural.gate_exempt ? "Muafiyeti kaldır" : "Kapılardan muaf yap"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function GuvenlikClient({
  sessions,
  open,
  audit,
  workers,
  meId,
  layerEnabled,
  singleSession,
  gatesEnabled,
  pendingDevices,
  pendingCountries,
  accessRules,
  accessDefaults,
  killSwitch,
}: {
  sessions: SessionRow[];
  open: SessionRow[];
  audit: AuditRow[];
  workers: SecurityWorker[];
  meId: string;
  layerEnabled: boolean;
  singleSession: boolean;
  gatesEnabled: boolean;
  pendingDevices: PendingDevice[];
  pendingCountries: PendingCountry[];
  accessRules: AccessRule[];
  accessDefaults: { hours: string; countries: string[] };
  killSwitch: KillSwitchView;
}) {
  const [sekme, setSekme] = useState<Sekme>("gecmis");
  const [pending, start] = useTransition();
  const [onay, setOnay] = useState<{ id: string; ad: string; dondur: boolean } | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  // ── ÖLÜ ADAM ANAHTARI: üç aşama, istemcide YALNIZ adım sayacı ───────────
  // Aşamaların kendisi sunucuda doğrulanıyor (killSwitchConfirmAction →
  // killSwitchActivateAction). Buradaki sayaç sadece hangi ekranın
  // gösterileceğini söyler; atlanırsa da sunucu geçirmez.
  const [asama, setAsama] = useState<0 | 1 | 2 | 3>(0);
  const [onayMetni, setOnayMetni] = useState("");
  const [cevap, setCevap] = useState("");
  const [sebep, setSebep] = useState("");
  const [anahtarHata, setAnahtarHata] = useState<string | null>(null);
  const [kalanHak, setKalanHak] = useState<number>(killSwitch.kalanHak);
  // Kullanıcı listesi varsayılan KAPALI — kadro büyüdükçe sayfayı şişiriyordu.
  const [kullanicilarAcik, setKullanicilarAcik] = useState(false);
  // ── OYNATICI: istek üzerine yüklenir (altı tabloyu birden okuyor) ────────
  const [oyKisi, setOyKisi] = useState("");
  const [oyGun, setOyGun] = useState("");
  const [oyOlaylar, setOyOlaylar] = useState<ReplayEvent[] | null>(null);
  // ── PARMAK İZİ SORGUSU ──────────────────────────────────────────────────
  const [fpSorgu, setFpSorgu] = useState("");
  const [fpSonuc, setFpSonuc] = useState<FingerprintHit | null | "yok">(null);
  // ── EYLEM İZİ SÜZGEÇLERİ ────────────────────────────────────────────────
  // İstemcide süzülüyor: sunucudan zaten 200 satır geliyor ve her süzme için
  // sunucuya gitmek, satır sayısı bu ölçekteyken yalnız gecikme eklerdi.
  const [fKisi, setFKisi] = useState("");
  const [fEylem, setFEylem] = useState("");
  const [fBas, setFBas] = useState("");
  const [fBit, setFBit] = useState("");

  const bekleyenToplam = pendingDevices.length + pendingCountries.length;

  // Süzgeç seçenekleri VERİDEN türer: elle liste tutmak, yeni bir eylem
  // eklendiğinde süzgeçte görünmemesine yol açardı.
  const izKisiler = [...new Set(audit.map((r) => r.worker_name))].sort();
  const izEylemler = [...new Set(audit.map((r) => r.action))].sort();
  const izSuzulmus = audit.filter((r) => {
    if (fKisi && r.worker_name !== fKisi) return false;
    if (fEylem && r.action !== fEylem) return false;
    // Tarih karşılaştırması YEREL güne göre: ISO dizesinin ilk 10 hanesi UTC
    // günüdür ve gece yarısına yakın satırları yanlış güne atardı.
    const gun = new Date(r.at).toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" });
    if (fBas && gun < fBas) return false;
    if (fBit && gun > fBit) return false;
    return true;
  });

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

  // ── KAPI 1/2: onay kararı ───────────────────────────────────────────────
  function kararVer(tur: "device" | "country", id: string, onayla: boolean) {
    setHata(null);
    start(async () => {
      const r =
        tur === "device"
          ? await approveDeviceAction(id, onayla)
          : await approveCountryAction(id, onayla);
      if (!r.ok) setHata(r.error ?? "Bilinmeyen hata");
    });
  }

  // ── KAPI 3: saat aralığı ────────────────────────────────────────────────
  function saatKaydet(workerId: string, bas: string, bit: string) {
    setHata(null);
    start(async () => {
      const r = await setAccessHoursAction(workerId, bas, bit);
      if (!r.ok) setHata(r.error ?? "Bilinmeyen hata");
    });
  }

  function oynat() {
    setHata(null);
    start(async () => {
      const r = await getDayReplayAction(oyKisi, oyGun);
      setOyOlaylar(r);
    });
  }

  function fpSor() {
    setHata(null);
    start(async () => {
      const r = await lookupFingerprintAction(fpSorgu);
      setFpSonuc(r ?? "yok");
    });
  }

  function golgele(id: string) {
    setHata(null);
    start(async () => {
      const r = await enterShadowAction(id);
      if (r && !r.ok) setHata(r.error ?? "Gölge moduna girilemedi");
    });
  }

  function muafiyetDegistir(workerId: string, muaf: boolean) {
    setHata(null);
    start(async () => {
      const r = await setGateExemptAction(workerId, muaf);
      if (!r.ok) setHata(r.error ?? "Bilinmeyen hata");
    });
  }

  // ── KAPI 4: aşama 2 → 3 ─────────────────────────────────────────────────
  function onayiDogrula() {
    setAnahtarHata(null);
    start(async () => {
      const r = await killSwitchConfirmAction(onayMetni);
      if (r.ok) {
        setAsama(3);
        setOnayMetni("");
      } else {
        setAnahtarHata("Metin birebir ONAYLIYORUM olmalı.");
      }
    });
  }

  // ── KAPI 4: aşama 3 → aktivasyon ────────────────────────────────────────
  function anahtariCek() {
    setAnahtarHata(null);
    start(async () => {
      const r = await killSwitchActivateAction(cevap, sebep);
      setCevap("");
      if (r.ok) {
        setAsama(0);
        return;
      }
      if (typeof r.kalanHak === "number") setKalanHak(r.kalanHak);
      if (r.error === "locked") {
        setAnahtarHata(
          `Anahtar kilitlendi. ${r.lockedUntil ? zaman(r.lockedUntil) : "24 saat"} tarihine kadar açılamaz.`
        );
        setAsama(0);
      } else if (r.error === "wrong_answer") {
        setAnahtarHata(
          `Yanlış cevap. Kalan hak: ${typeof r.kalanHak === "number" ? r.kalanHak : "?"}`
        );
      } else {
        setAnahtarHata(r.error ?? "Bilinmeyen hata");
      }
    });
  }

  function anahtariAc() {
    setAnahtarHata(null);
    start(async () => {
      const r = await killSwitchDeactivateAction();
      if (!r.ok) setAnahtarHata(r.error ?? "Bilinmeyen hata");
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
    {
      key: "ne",
      header: "Eylem",
      cell: (r) => EYLEM_ADI[r.action] ?? r.action,
      sortable: true,
      sortValue: (r) => EYLEM_ADI[r.action] ?? r.action,
    },
    { key: "hedef", header: "Hedef", cell: (r) => r.target ?? "—" },
    {
      key: "detay",
      header: "Değişiklik",
      // Alan alan, eski kırmızı / yeni yeşil. Boşsa görüntüleme-indirme
      // satırıdır, değişiklik değil → "—".
      cell: (r) => <Degisiklik alanlar={r.degisim} />,
    },
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
          // Kapılar kapalıysa sekmeler HİÇ görünmez — boş ekran göstermek
          // yerine, o kurulumda var olmayan bir özelliği hiç anmamak doğru.
          ...(gatesEnabled
            ? ([
                { value: "onaylar", label: `Bekleyen onaylar (${bekleyenToplam})` },
                { value: "kurallar", label: "Erişim kuralları" },
                { value: "anahtar", label: "Ölü adam anahtarı" },
                { value: "oynatici", label: "Gün oynatıcı" },
                { value: "parmakizi", label: "PDF parmak izi" },
              ] as const)
            : []),
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
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-text-tertiary">
              Kişi
              <select value={fKisi} onChange={(e) => setFKisi(e.target.value)}
                className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-text-primary">
                <option value="">Hepsi</option>
                {izKisiler.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-tertiary">
              Eylem
              <select value={fEylem} onChange={(e) => setFEylem(e.target.value)}
                className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-text-primary">
                <option value="">Hepsi</option>
                {izEylemler.map((a) => (
                  <option key={a} value={a}>{EYLEM_ADI[a] ?? a}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-tertiary">
              Başlangıç
              <Input type="date" value={fBas} onChange={(e) => setFBas(e.target.value)}
                className="h-9 w-[150px]" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-tertiary">
              Bitiş
              <Input type="date" value={fBit} onChange={(e) => setFBit(e.target.value)}
                className="h-9 w-[150px]" />
            </label>
            {(fKisi || fEylem || fBas || fBit) && (
              <Button variant="outline" size="sm"
                onClick={() => { setFKisi(""); setFEylem(""); setFBas(""); setFBit(""); }}>
                Süzgeci temizle
              </Button>
            )}
            <span className="ml-auto self-center text-xs text-text-tertiary">
              {izSuzulmus.length} / {audit.length} satır
            </span>
          </div>
          <DataTable rows={izSuzulmus} columns={izKolon} rowKey={(r) => r.id}
            empty={<EmptyState title="Eylem izi boş"
              hint={audit.length ? "Süzgeç bu aralıkta satır bulamadı." : undefined} />} />
        </div>
      )}

      {/* ── BEKLEYEN ONAYLAR (KAPI 1 + 2) ─────────────────────────────── */}
      {sekme === "onaylar" && (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">
              Yeni cihaz ({pendingDevices.length})
            </h2>
            {pendingDevices.length === 0 ? (
              <EmptyState title="Bekleyen cihaz onayı yok" />
            ) : (
              pendingDevices.map((d) => (
                <div key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{d.worker_name}</span>
                    <span className="text-xs text-text-tertiary">
                      {cihaz(d.user_agent)} · {d.first_ip ?? "—"}
                      {(d.first_city || d.first_country) &&
                        ` · ${[d.first_city, d.first_country].filter(Boolean).join(", ")}`}
                      {" · "}{zaman(d.requested_at)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={pending}
                      onClick={() => kararVer("device", d.id, true)}>
                      <Check className="size-4" aria-hidden /> Onayla
                    </Button>
                    <Button variant="outline" size="sm" disabled={pending}
                      onClick={() => kararVer("device", d.id, false)}>
                      <X className="size-4" aria-hidden /> Reddet
                    </Button>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">
              Yeni ülke ({pendingCountries.length})
            </h2>
            <p className="text-xs text-text-tertiary">
              Onay beklemeden serbest ülkeler: {accessDefaults.countries.join(", ")}
            </p>
            {pendingCountries.length === 0 ? (
              <EmptyState title="Bekleyen ülke onayı yok" />
            ) : (
              pendingCountries.map((c) => (
                <div key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {c.worker_name} · {c.country}
                    </span>
                    <span className="text-xs text-text-tertiary">{zaman(c.requested_at)}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={pending}
                      onClick={() => kararVer("country", c.id, true)}>
                      <Check className="size-4" aria-hidden /> Onayla
                    </Button>
                    <Button variant="outline" size="sm" disabled={pending}
                      onClick={() => kararVer("country", c.id, false)}>
                      <X className="size-4" aria-hidden /> Reddet
                    </Button>
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      )}

      {/* ── GÜN OYNATICI (dalga 3) ────────────────────────────────────── */}
      {sekme === "oynatici" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-text-tertiary">
              Kişi
              <select value={oyKisi} onChange={(e) => setOyKisi(e.target.value)}
                className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-text-primary">
                <option value="">Seçin</option>
                {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-tertiary">
              Gün
              <Input type="date" value={oyGun} onChange={(e) => setOyGun(e.target.value)}
                className="h-9 w-[160px]" />
            </label>
            <Button variant="outline" size="sm" disabled={pending || !oyKisi || !oyGun}
              onClick={oynat}>
              Günü aç
            </Button>
          </div>

          {oyOlaylar === null ? (
            <EmptyState title="Bir kişi ve gün seçin"
              hint="Giriş, sayfa görüntülemeleri, indirmeler ve değişiklikler tek zaman çizgisinde gelir." />
          ) : oyOlaylar.length === 0 ? (
            <EmptyState title="O gün kayıt yok" />
          ) : (
            /* Dikey çizgi: sol kenarda tek bir hat, olaylar üstüne oturuyor. */
            <ol className="relative flex flex-col gap-0 border-l border-border pl-4">
              {oyOlaylar.map((o) => (
                <li key={o.id} className="relative py-2">
                  <span
                    className={
                      "absolute -left-[21px] top-3.5 size-2 rounded-full " +
                      (o.kind === "gap" ? "bg-border" : "bg-accent-coral")
                    }
                    aria-hidden
                  />
                  {o.kind === "gap" ? (
                    <span className="text-xs italic text-text-tertiary">{o.baslik}</span>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm">
                        <span className="tabular-nums text-text-tertiary">
                          {new Date(o.at).toLocaleTimeString("de-AT", {
                            timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit",
                          })}
                        </span>{" "}
                        <span className="font-medium">{EYLEM_ADI[o.baslik] ?? o.baslik}</span>
                        {o.alt && <span className="text-text-tertiary"> · {o.alt}</span>}
                      </span>
                      {o.degisim.length > 0 && <Degisiklik alanlar={o.degisim} />}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* ── PDF PARMAK İZİ SORGUSU (dalga 3) ──────────────────────────── */}
      {sekme === "parmakizi" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-secondary">
            Elinizdeki PDF&apos;ten çıkan işareti yapıştırın. İşaret belgede
            görünmezdir; metin ayıklayıcı ya da belge künyesi (&quot;Konu&quot;
            alanı) ile okunur.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Input value={fpSorgu} onChange={(e) => setFpSorgu(e.target.value)}
              placeholder="HAK-XXXX-XXXX-XXXX" className="w-[260px]" autoComplete="off" />
            <Button variant="outline" size="sm" disabled={pending || !fpSorgu} onClick={fpSor}>
              Sorgula
            </Button>
          </div>
          {fpSonuc === "yok" && (
            <EmptyState title="Bu işaret bulunamadı"
              hint="İz bu kurulumda üretilmemiş olabilir. Tahmini eşleşme gösterilmez." />
          )}
          {fpSonuc && fpSonuc !== "yok" && (
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3">
              <span className="font-medium">{fpSonuc.worker_name}</span>
              <span className="text-sm text-text-secondary">
                {zaman(fpSonuc.at)} · {fpSonuc.report_type} raporu · IP {fpSonuc.ip ?? "—"}
              </span>
              <span className="text-xs text-text-tertiary">{fpSonuc.fingerprint}</span>
            </div>
          )}
        </div>
      )}

      {/* ── ERİŞİM KURALLARI (KAPI 3) ─────────────────────────────────── */}
      {sekme === "kurallar" && (
        <div className="flex flex-col gap-3">
          <p className="flex items-start gap-2 text-sm text-text-tertiary">
            <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
            Varsayılan aralık {accessDefaults.hours} (Europe/Istanbul). Boş
            bırakılan satır varsayılanı kullanır; iki ucu birlikte doldurun.
          </p>
          {accessRules.length === 0 ? (
            <EmptyState title="Kadro boş" />
          ) : (
            accessRules.map((r) => (
              <SaatSatiri key={r.id} kural={r} pending={pending} onKaydet={saatKaydet}
                onMuafiyet={muafiyetDegistir} />
            ))
          )}
        </div>
      )}

      {/* ── ÖLÜ ADAM ANAHTARI (KAPI 4) ────────────────────────────────── */}
      {sekme === "anahtar" && (
        <div className="flex flex-col gap-4">
          {anahtarHata && (
            <p className="text-sm text-status-critical-text" role="alert">
              {anahtarHata}
            </p>
          )}

          {killSwitch.active ? (
            <div className="flex flex-col gap-3 rounded-xl border border-status-critical-border bg-status-critical-bg px-4 py-4">
              <span className="font-semibold text-status-critical-text">
                SİSTEM KAPALI
              </span>
              <span className="text-sm">
                {killSwitch.activatedAt ? zaman(killSwitch.activatedAt) : "—"}
                {killSwitch.reason ? ` · ${killSwitch.reason}` : ""}
              </span>
              <span className="text-sm text-text-secondary">
                Sizin dışınızda herkesin oturumu düşürüldü ve girişler
                reddediliyor. Veriye dokunulmadı — geri açtığınızda sistem
                birebir eski hâline döner.
              </span>
              <div>
                <Button variant="outline" size="sm" disabled={pending} onClick={anahtariAc}>
                  <Power className="size-4" aria-hidden /> Sistemi geri aç
                </Button>
              </div>
            </div>
          ) : killSwitch.lockedUntil ? (
            <EmptyState
              title="Anahtar kilitli"
              hint={`Üst üste üç yanlış cevap verildi. ${zaman(killSwitch.lockedUntil)} tarihine kadar açılamaz.`}
            />
          ) : asama === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-secondary">
                Bu düğme sizin dışınızda herkesin oturumunu düşürür ve tüm
                girişleri reddeder. Üç aşamalı onay ister.
              </p>
              <div>
                <Button variant="outline" size="sm" disabled={pending}
                  onClick={() => { setAsama(1); setAnahtarHata(null); }}>
                  <Power className="size-4" aria-hidden /> Tüm sistemi kapat
                </Button>
              </div>
            </div>
          ) : asama === 1 ? (
            <div className="flex flex-col gap-3 rounded-xl border border-status-critical-border bg-status-critical-bg px-4 py-4">
              <span className="font-semibold text-status-critical-text">
                Aşama 1/3 — Ne olacağını okuyun
              </span>
              <ul className="list-disc pl-5 text-sm">
                <li>Sizin dışınızda TÜM oturumlar (web ve mobil) anında düşer.</li>
                <li>Yeni girişler reddedilir; şoför paneli ve mobil uygulama açılmaz.</li>
                <li>Telemetri akmaya devam eder — veri kaybı olmaz.</li>
                <li>Yalnız siz geri açabilirsiniz.</li>
              </ul>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setAsama(2)}>
                  Devam
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAsama(0)}>
                  Vazgeç
                </Button>
              </div>
            </div>
          ) : asama === 2 ? (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4">
              <span className="font-semibold">Aşama 2/3 — Onay metni</span>
              <p className="text-sm text-text-secondary">
                Devam etmek için kutuya <strong>ONAYLIYORUM</strong> yazın.
              </p>
              <Input value={onayMetni} onChange={(e) => setOnayMetni(e.target.value)}
                placeholder="ONAYLIYORUM" autoComplete="off" />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={pending} onClick={onayiDogrula}>
                  Devam
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setAsama(0); setOnayMetni(""); }}>
                  Vazgeç
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-status-critical-border bg-status-critical-bg px-4 py-4">
              <span className="font-semibold text-status-critical-text">
                Aşama 3/3 — Gizli soru
              </span>
              <p className="text-sm">Apolet no?</p>
              <Input value={cevap} onChange={(e) => setCevap(e.target.value)}
                type="password" autoComplete="off" inputMode="numeric" />
              <p className="text-xs text-text-tertiary">
                Kalan hak: {kalanHak}. Üçüncü yanlışta anahtar 24 saat kilitlenir.
              </p>
              <Input value={sebep} onChange={(e) => setSebep(e.target.value)}
                placeholder="Sebep (isteğe bağlı, ize yazılır)" autoComplete="off" />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={pending || !cevap}
                  onClick={anahtariCek}>
                  <Power className="size-4" aria-hidden /> Sistemi kapat
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setAsama(0); setCevap(""); }}>
                  Vazgeç
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* KULLANICILAR — VARSAYILAN KAPALI (Volkan, 08.08.2026).
          32 kişilik kadro sayfanın altına iki ekran boyu kart yığıyordu ve
          asıl bakılan yer (sekmeler) yukarıda kalıyordu. Liste kapalı;
          başlık düğmesi açıp kapatıyor. Sayı başlıkta duruyor, yani açmadan
          da "kaç kişi var" görülüyor. */}
      <section className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setKullanicilarAcik((v) => !v)}
          aria-expanded={kullanicilarAcik}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left"
        >
          <span className="text-base font-semibold">
            Kullanıcılar ({workers.length})
          </span>
          <span className="flex items-center gap-2 text-sm text-text-tertiary">
            {kullanicilarAcik ? "Gizle" : "Göster"}
            <ChevronDown
              className={`size-4 transition-transform ${kullanicilarAcik ? "rotate-180" : ""}`}
              aria-hidden
            />
          </span>
        </button>
        <div className={kullanicilarAcik ? "flex flex-col gap-2" : "hidden"}>
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
                    {/* GÖLGE MODU: yalnız YÖNETİCİ hesaplarda ve patron
                        kendini/başka patronu gölgeleyemez (sunucu da reddeder). */}
                    {w.is_admin && !w.is_owner && w.id !== meId && (
                      <Button variant="outline" size="sm" disabled={pending}
                        onClick={() => golgele(w.id)}>
                        <Eye className="size-4" aria-hidden /> Gözünden bak
                      </Button>
                    )}
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
