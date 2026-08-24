"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Truck,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Loader2,
  Package,
  PackageCheck,
  PackageX,
  Pause,
  PlayCircle,
  Search,
  Square,
  MapPin,
} from "lucide-react";
import {
  endShiftAction,
  startShiftManualAction,
  addBreakMinutesAction,
  startBreakAction,
  updatePackageCountAction,
} from "../actions/shift";
import { formatDuration, formatTime, workedMs } from "@/lib/format";
import { listPickableVehiclesAction } from "@/app/actions/driver-panel";
import { pingPanelAction } from "@/app/actions/depot";
import type { PickableVehicle } from "@/lib/vehicles";
import { VehiclePickerList } from "./VehiclePickerList";
import { breakTargetMin, AZG_BREAK_AFTER_6H_MIN } from "@/lib/break-rules";
import { classifyUndelivered, type UndeliveredCheck } from "@/lib/package-limits";
import type { TimeEntry, VehicleBaseStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LenkzeitWarning } from "@/components/LenkzeitWarning";
import {
  LENKZEIT_WARNING_ENABLED,
  PACKAGES_ENABLED,
  DRIVER_VEHICLE_CHOICE,
  SHIFT_PER_DAY,
} from "@/lib/tenant";
import { tryServerAction } from "@/lib/offline-aware";
import { ConfirmShiftCard } from "./ConfirmShiftCard";
import { ShiftSummaryCard } from "./ShiftSummaryCard";
// YARDIM KATMANI ŞOFÖR PANELİNDE DE (28.07.2026, Volkan kararı). Sağlayıcı ve
// açma/kapama düğmesi ZATEN vardı — panel de DashboardShell kullanıyor; eksik
// olan yalnız balonlardı. HelpTip kapalıyken hiçbir şey render etmez ve balon
// yalnız açıldığında portala çizilir, yani panelin blur'suz/hafif kuralına
// dokunmaz (backdrop-filter kullanmaz).
import { HelpTip } from "@/components/help/HelpTip";

/**
 * Şoför Paneli v2 (Faz 1) — eğitimsiz, telefonla çalışan şoförler için:
 * dev butonlar, minimum okuma, sıfır karmaşa.
 *
 * Ekran öncelik sırası:
 *  1. İmzasız vardiya özeti varsa → tam ekran özet + yeşil ONAYLA (İş 3).
 *  2. Aktif vardiya "onay bekliyor" ise → tam ekran VARDİYAYI ONAYLA (İş 1).
 *  3. Aktif vardiya → süre/mola sayacı + bugünkü paket + paket butonu.
 *  4. Vardiya yok → "kontak açılınca otomatik başlar" bekleme ekranı.
 */

type Totals = {
  todayClosedPackages: number;
  weekMs: number;
  /**
   * Haftalık km artık tek sayı DEĞİL: cihazı sessiz vardiyalar toplamdan çıkar
   * ve kaç tanesinin ölçülemediği ayrıca taşınır (bkz. lib/km-quality.ts).
   */
  weekKm: { km: number; olculen: number; sinyalsiz: number; acik: number };
  weekShifts: number;
};

type AssignedVehicle = {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  status: VehicleBaseStatus;
};

type Props = {
  active: TimeEntry | null;
  pendingSummary: TimeEntry | null;
  totals: Totals;
  assignedVehicle: AssignedVehicle | null;
  /** Bugün (Viyana günü) bir vardiya açılmış mı — günde tek vardiya kuralı. */
  shiftDoneToday: boolean;
  /** Araç ≥3 dk depo bölgesinde ise giriş anı — "mesaiyi başlat?" önerisi (Modül 3). */
  depotPanel: {
    locked: boolean;
    state: string;
    enteredAt: string | null;
    zoneName: string | null;
  } | null;
};

export function PanelClient({
  active,
  pendingSummary,
  totals,
  assignedVehicle,
  shiftDoneToday,
  depotPanel,
}: Props) {
  const t = useTranslations("panel");
  const tc = useTranslations("common");
  const tOffline = useTranslations("offline");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Otomatik başlayan/biten vardiyalar sunucuda oluşur — panel 30 sn'de bir
  // tazelenir ki onay kartı/özet şoförün karşısına kendiliğinden çıksın.
  //
  // GÖRÜNÜRLÜK KAPISI: şoför telefonu cebine koyduğunda / başka uygulamaya
  // geçtiğinde panel arka plana düşer ama yenileme sürüyordu — 29 şoför ×
  // vardiya boyu. Sekme öne geldiğinde ilk tikte tazelenir, yani şoför
  // paneli açtığında gördüğü veri yine güncel.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [router]);

  // PANEL YOKLAMASI (Modül 7): panel açıkken workers.panel_seen_at güncellenir →
  // "auto vardiya açıldı ama şoför 2 saattir panele girmemiş" Dikkat kalemi bunu
  // kullanır (belki o araçta değil). Best-effort, hata yutulur.
  useEffect(() => {
    pingPanelAction();
    const id = setInterval(() => pingPanelAction(), 5 * 60_000);
    return () => clearInterval(id);
  }, []);

  // Tam ekran katmanların "Daha sonra" durumu (oturum-yerel; sunucu durumu
  // değişmediği sürece bir sonraki girişte tekrar çıkarlar).
  const [confirmLater, setConfirmLater] = useState(false);
  const [summaryLater, setSummaryLater] = useState(false);

  const [endOpen, setEndOpen] = useState(false);
  // Kapatma öncesi DİKKAT uyarısı (tek onay katmanı).
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Manuel paket sayısı (alınan/planlanan) — +1 sayaç yerine düz sayı girişi.
  const [pkgOpen, setPkgOpen] = useState(false);
  const [pkgVal, setPkgVal] = useState("");
  // Kapanış akışı (22.07.2026 yeniden yazımı):
  //   returnMode null   → soru + iki büyük buton
  //   returnMode "none" → "hepsini teslim ettim" (geri = 0)
  //   returnMode "some" → sayı girişi açık
  // endUndel BOŞ başlar (eski varsayılan "0" üzerine yazılıyordu).
  //
  // PAKET MODÜLÜ KAPALIYKEN 1. ADIM HİÇ YOKTUR: soru paket sorusudur ve
  // sorulmaması gerekir. Başlangıç değeri "none" (geri getirilen = 0) olur,
  // yani form doğrudan not + kapat adımına açılır ve undelivered_count 0 gider.
  const [returnMode, setReturnMode] = useState<null | "none" | "some">(
    PACKAGES_ENABLED ? null : "none"
  );
  const [endUndel, setEndUndel] = useState("");
  /** Sıra dışı sayı girildiğinde gösterilen teyit adımı (engel değil). */
  const [confirmNeeded, setConfirmNeeded] = useState(false);

  // Depo-giriş önerisini şoför kapatabilir (oturum-yerel); manuel başlatma açık kalır.
  const [depotDismissed, setDepotDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  // Mola — v1 ile aynı yerel-önce mantık: yerelde biriktir, kapatınca DB'ye yaz.
  // GEÇİCİ ARAÇ seçicisi (22.07.2026) — liste LAZY çekilir.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickable, setPickable] = useState<PickableVehicle[]>([]);
  /** Plaka araması — sabit atamasız filoda liste uzun olabilir. */
  const [pickerQuery, setPickerQuery] = useState("");
  /** Meşgul araç seçildiğinde önce onay sorulur; seçilen araç burada bekler. */
  const [confirmBusy, setConfirmBusy] = useState<PickableVehicle | null>(null);

  const [breakStartLocal, setBreakStartLocal] = useState<number | null>(null);
  // Molanın hedef süresi (dakika) — molanın BAŞLADIĞI anda sabitlenir.
  // § 13c Abs. 1 AZG: 9 saati aşan vardiyada 30 değil 45 dakika. Hedefi her
  // render'da yeniden hesaplamıyoruz; mola sürerken çalışılan süre eşiği
  // geçseydi hedef mola ortasında 30'dan 45'e atlar, sayaç geri sıçrardı.
  const [breakTargetLocal, setBreakTargetLocal] = useState(
    AZG_BREAK_AFTER_6H_MIN
  );
  const [pendingBreakMinutes, setPendingBreakMinutes] = useState(0);
  const activeId = active?.id ?? null;
  useEffect(() => {
    if (!activeId) {
      setBreakStartLocal(null);
      setPendingBreakMinutes(0);
      setConfirmLater(false);
    }
  }, [activeId]);

  /**
   * Şoför plakayı vardiya açarken kendisi mi seçiyor? (lib/tenant.ts)
   * 'assigned' (HAK61 varsayılanı) → hayır, atanmış aracıyla açar.
   */
  const freeVehicleChoice = DRIVER_VEHICLE_CHOICE === "free";

  /**
   * Aynı gün ikinci vardiya açılabilir mi? (14.08.2026)
   * 'many' (Sendigo) → gün kapandığında "YENİ VARDİYA AÇ" çıkar; sunucu YENİ
   * SATIR yazar. 'one' (HAK61 varsayılanı) → ekran aynen kalır: tek eylem
   * "yeniden aç", yani o günün satırını sürdürmek.
   */
  const manyShiftsPerDay = SHIFT_PER_DAY === "many";

  /** Seçicide gösterilecek araçlar — plaka/marka/model araması uygulanmış. */
  const visiblePickable = (() => {
    const q = pickerQuery.trim().toLocaleLowerCase("tr");
    if (!q) return pickable;
    return pickable.filter((v) =>
      [v.plate, v.make, v.model]
        .filter(Boolean)
        .some((s) => (s as string).toLocaleLowerCase("tr").includes(q))
    );
  })();

  // Alınan (planlanan) paket sayısı — sunucudaki manuel değer (start_package_count).
  const packagesTaken = active?.start_package_count ?? null;

  const totalBreakSoFar =
    (active?.break_minutes ?? 0) +
    pendingBreakMinutes +
    (breakStartLocal !== null ? Math.floor((now - breakStartLocal) / 60_000) : 0);

  const workedMsLive = active
    ? workedMs(
        {
          started_at: active.started_at,
          ended_at: null,
          break_minutes: totalBreakSoFar,
        },
        now
      )
    : 0;

  const onBreak = breakStartLocal !== null;
  /** Süren molanın geçen süresi — sayaç bunu 00:00:00'dan itibaren sayar. */
  const breakElapsedMs = breakStartLocal !== null ? Math.max(0, now - breakStartLocal) : 0;

  function startBreak() {
    setBreakTargetLocal(breakTargetMin(workedMsLive));
    setBreakStartLocal(Date.now());
    toast.info(t("breakStarted"));
    void startBreakAction().catch(() => {});
  }

  /**
   * Molayı bitirir ve GERÇEKTEN geçen dakikayı yazar.
   * `auto` = hedef süreye (BREAK_TARGET_MIN) ulaşıldığı için kendiliğinden
   * bitti; şoför erken bastıysa false. İkisinde de aynı kayıt yolu kullanılır —
   * mola süresi tek yerden birikir (time_entries.break_minutes), rapordaki
   * "Pause" kolonu buradan beslenir.
   */
  function endBreak(auto: boolean) {
    if (breakStartLocal === null) return;
    const elapsedMin = Math.max(0, Math.floor((Date.now() - breakStartLocal) / 60_000));
    setBreakStartLocal(null);
    setPendingBreakMinutes((m) => m + elapsedMin);
    // Şoför kaç dakika mola yaptığını HER hâlükârda görür (0 dk dahil).
    const msg = auto
      ? t("breakAutoDone", { min: breakTargetLocal })
      : t("breakEndedMin", { min: elapsedMin });

    // SUNUCU HER HÂLÜKÂRDA ÇAĞRILIR — 0 dakikalık mola dahil (22.07.2026).
    //
    // Eskiden bu çağrı `elapsedMin > 0` koşuluna bağlıydı. 60 saniyeden kısa
    // bir molada koşul tutmuyor, sunucuya hiç gidilmiyor ve
    // time_entries.break_started_at DB'de SET kalıyordu. Sonucu: şoför işe
    // dönmüş olsa bile YÖNETİCİ tarafı onu vardiya kapanana kadar "Molada"
    // gösteriyordu — hem Araçlar sayfası (computeLiveStatus) hem panonun
    // "Molada" sayacı `!!break_started_at`e bakıyor, ikisi de yanılıyordu.
    // Canlıda 5 gerçek vardiyada görüldü; en uzunu 7s 56dk yanlış "Molada".
    //
    // addBreakMinutesAction 0'ı zaten güvenle işliyor: toplama 0 ekler,
    // bayrağı temizler. Yani "sıfır dakika" ayrı bir yol değil, aynı yolun
    // sınır hâli — ayırmak zaten hatanın kaynağıydı.
    startTransition(async () => {
      const r = await tryServerAction(
        "break",
        { minutes: elapsedMin },
        new Date().toISOString(),
        () => addBreakMinutesAction(elapsedMin)
      );
      if (r.queued) {
        toast.warning(tOffline("queued_toast"));
        setPendingBreakMinutes(0);
        return;
      }
      if (r.result.ok) {
        toast.success(msg);
        setPendingBreakMinutes(0);
        router.refresh();
      } else {
        toast.error(r.result.error ?? "Error");
      }
    });
  }

  function toggleBreak() {
    if (breakStartLocal === null) startBreak();
    else endBreak(false);
  }

  // "En güncel fonksiyon" ref'i: endBreak her render'da yeni bir kimlik alır.
  // Zamanlayıcıya doğrudan verilseydi mola boyunca her saniye yeniden kurulur
  // ve hedefe hiç ulaşamazdı. Ref efekt İÇİNDE yazılır (render sırasında ref
  // yazmak React 19'da kirli sayılır).
  const endBreakRef = useRef(endBreak);
  useEffect(() => {
    endBreakRef.current = endBreak;
  });

  /**
   * Hedef süre (BREAK_TARGET_MIN) dolunca molayı OTOMATİK bitirir. Zamanlayıcı
   * mola başlangıcına göre KALAN süre kadar kurulur — her saniye kontrol eden
   * bir efekt değil. Telefon uykuya dalıp geç uyansa bile kaydedilen süre
   * gerçek zaman damgalarından hesaplandığı için doğru kalır.
   */
  useEffect(() => {
    if (breakStartLocal === null) return;
    const remaining =
      breakTargetLocal * 60_000 - (Date.now() - breakStartLocal);
    const id = setTimeout(() => endBreakRef.current(true), Math.max(0, remaining));
    return () => clearTimeout(id);
  }, [breakStartLocal, breakTargetLocal]);

  // Manuel paket sayısı: dialog'u mevcut değerle aç.
  function openPkg() {
    setPkgVal(packagesTaken !== null ? String(packagesTaken) : "");
    setPkgOpen(true);
  }
  // Kaydet: düz sayı → start_package_count (open-shift only). Boş = temizle.
  function savePkg() {
    const raw = pkgVal.trim();
    let v: number | null = null;
    if (raw !== "") {
      v = Math.floor(Number(raw));
      if (!Number.isFinite(v) || v < 0) {
        toast.error(t("v2PkgErr"));
        return;
      }
    }
    startTransition(async () => {
      const r = await updatePackageCountAction(v);
      if (r.ok) {
        // Girilen sayıyı GERİ OKUR. Eskiden burada "+1 paket eklendi" yazıyordu
        // — kaldırılmış +1 sayaç akışından kalma metin. Şoför 175 yazıp
        // "+1 paket eklendi" görünce alanın tek tek saydığını sanabiliyordu.
        toast.success(v === null ? t("v2PkgCleared") : t("v2PkgSavedN", { n: v }));
        setPkgOpen(false);
        router.refresh();
      } else {
        toast.error(t("v2PkgErr"));
      }
    });
  }

  // ── Kapanış hesapları — tek kaynak lib/package-limits.ts ────────────────
  /** Geri getirilen paket: "none" ise 0, "some" ise yazılan sayı (boşsa null). */
  const undeliveredValue: number | null =
    returnMode === "none"
      ? 0
      : endUndel.trim() === ""
        ? null
        : Number.isFinite(Number(endUndel))
          ? Math.floor(Number(endUndel))
          : null;

  /** Alan henüz boş: hata DEĞİL, sadece eksik. Uyarı basmayız, gönderimi kapatırız. */
  const undelEmpty =
    PACKAGES_ENABLED && returnMode === "some" && endUndel.trim() === "";
  // Paket modülü kapalıyken paket matematiği HİÇ ÇALIŞMAZ: soru sorulmadığı
  // için "eksik/çelişkili cevap" diye bir şey yoktur ve engel de üretilemez.
  const undelCheck: UndeliveredCheck = PACKAGES_ENABLED
    ? classifyUndelivered(undeliveredValue, packagesTaken)
    : { level: "ok" };
  /** Görsel uyarı yalnız gerçek çelişkilerde çıkar (boş alan sessizdir). */
  const showBlock = !undelEmpty && undelCheck.level === "block";

  const deliveredPreview =
    packagesTaken !== null
      ? Math.max(0, packagesTaken - (undeliveredValue ?? 0))
      : 0;

  /**
   * Gönderim kapısı: "confirm" seviyesindeki sayılar ENGELLENMEZ, sorulur.
   * Şoför teyit ettiyse (confirmNeeded true iken submit) doğrudan geçer —
   * gerçekten bütün paketler geri gelmiş olabilir.
   */
  function submitEnd(formData: FormData) {
    if (undelCheck.level === "block") return;
    if (undelCheck.level === "confirm" && !confirmNeeded) {
      setConfirmNeeded(true);
      return;
    }
    setConfirmNeeded(false);
    handleEnd(formData);
  }

  function handleEnd(formData: FormData) {
    if (breakStartLocal !== null) {
      // Süren mola, form alanı varsayılanı totalBreakSoFar'a zaten dahil.
      setBreakStartLocal(null);
    }
    // Çevrimdışı kuyruk yükünde de km YOK — bitiş km'si sunucuda cihazdan
    // türetilir (offline.ts "end" dalı endShiftAction ile aynı kaynağı kullanır).
    const payload = {
      notes: formData.get("notes") || null,
      break_minutes: formData.get("break_minutes") || null,
      undelivered_count: formData.get("undelivered_count") || null,
    };
    startTransition(async () => {
      const r = await tryServerAction(
        "end",
        payload,
        new Date().toISOString(),
        () => endShiftAction(formData)
      );
      if (r.queued) {
        toast.warning(tOffline("queued_toast"));
        setEndOpen(false);
        return;
      }
      if (r.result.ok) {
        toast.success(t("shiftEnded"));
        setEndOpen(false);
        setSummaryLater(false); // biten vardiyanın özeti hemen çıksın
        router.refresh();
      } else {
        toast.error(mapErr(r.result.error));
      }
    });
  }

  function mapErr(e?: string): string {
    if (!e) return "Error";
    if (e === "active") return t("errActive");
    if (e === "no_active") return t("errNoActive");
    if (e === "undelivered_required") return t("v2UndeliveredRequired");
    // Paket üst sınırı (lib/package-limits.ts). Şoför neyin fazla olduğunu
    // rakamla görmeli — "geçersiz değer" tek başına düzeltmeyi öğretmez.
    if (e.startsWith("undelivered_over:")) {
      const [, got, taken] = e.split(":");
      return t("v2UndeliveredOver", { got, taken });
    }
    if (e.startsWith("undelivered_max:")) {
      return t("v2UndeliveredMax", { max: e.split(":")[1] });
    }
    if (e === "undelivered_invalid") return t("v2PkgErr");
    // km_* hata kodları BİLİNÇLİ olarak kalktı: şoför km girmediği için sunucu
    // ondan km hatası döndüremez (km cihazdan türetilir, doğrulanacak girdi yok).
    if (e === "no_vehicle") return t("v2WaitNoVehicle");
    if (e === "vehicle_unavailable") return t("v2StartVehicleMaintenance");
    if (e === "vehicle_busy") return t("v2StartVehicleBusy");
    if (e === "inactive_worker") return t("v2StartInactiveWorker");
    if (e === "day_done") return t("v2DayDoneToast");
    return e;
  }

  /**
   * Manuel vardiya başlatma. Kontak sinyali gecikirse/gelmezse şoför kendi
   * başlatır; sunucu satırı auto-shift'le aynı biçimde yazar, çift açık vardiya
   * hem uygulama guard'ı hem uq_time_entries_one_open ile engellidir.
   * Offline kuyruğuna GİRMEZ: başlangıç km'sini sunucu telemetriden çözüyor,
   * istemci onu bilemez.
   */
  function handleManualStart(overrideVehicleId?: string) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error(t("v2StartOffline"));
      return;
    }
    startTransition(async () => {
      let r;
      try {
        r = await startShiftManualAction(overrideVehicleId);
      } catch {
        // navigator.onLine "şebeke var" der ama depoda/kapalı otoparkta istek
        // yolda ölebilir. try/catch olmadan reddedilen promise transition'dan
        // kaçar ve panel hata ekranına düşerdi. Vardiya sunucuda açılmış OLABİLİR
        // → tazeleyip şoföre gerçek durumu gösteriyoruz.
        toast.error(t("v2StartNetworkErr"));
        router.refresh();
        return;
      }
      if (r.ok) {
        // Yeniden açma ile yeni vardiya farklı şeylerdir; şoför hangisinin
        // olduğunu görmeli (aynı satıra devam mı, yeni gün mü).
        toast.success(r.reopened ? t("v2ReopenedToast") : t("shiftStarted"));
        router.refresh();
      } else {
        toast.error(mapErr(r.error));
        // "active" = kontak cron'u aynı anda açtı; ekran bekleme kartında
        // kalmasın, gerçek aktif vardiyaya geçsin.
        if (r.error === "active") router.refresh();
      }
    });
  }

  /** "Başka araç kullanacağım" — listeyi çeker ve seçiciyi açar. */
  function openVehiclePicker() {
    setPickerLoading(true);
    setPickerQuery("");
    startTransition(async () => {
      try {
        setPickable(await listPickableVehiclesAction());
        setPickerOpen(true);
      } catch {
        toast.error(t("v2OtherVehicleErr"));
      } finally {
        setPickerLoading(false);
      }
    });
  }

  /**
   * Araç seçildi. Araçta AÇIK vardiyası olan başka şoför varsa önce uyarı
   * çıkar — ENGEL DEĞİL (kural 3): şoför "Yine de devam et" diyebilir.
   */
  function pickVehicle(v: PickableVehicle) {
    if (v.inUseBy.length > 0) {
      setConfirmBusy(v);
      return;
    }
    setPickerOpen(false);
    handleManualStart(v.id);
  }

  // ── Ekran seçimi ───────────────────────────────────────────────────────────
  // `!active`: özet katmanı tam ekran ve paneli tamamen kapatıyor. Açık vardiya
  // varken gösterilirse şoför "Vardiyayı Bitir"e ulaşamaz (22.07.2026 olayı).
  // Sunucu da aynı kararı veriyor (app/panel/page.tsx) — bu ikinci savunma.
  const showSummary = !!pendingSummary && !summaryLater && !active;
  const showConfirm =
    !showSummary &&
    !!active &&
    active.confirmation_status === "pending" &&
    !confirmLater;

  return (
    <div className="mx-auto max-w-md space-y-5">
      {/* Telefon GPS + Lenkzeit uyarısı, onay durumu ne olursa olsun vardiya
          boyunca çalışır ("şoför onaylamasa bile veri akmaya devam eder"). */}
      {/* Telefon GPS'i KALDIRILDI (21.07.2026): rota takibinin tek kaynağı araç
          cihazı (FMC003 → device_telemetry). Şoför telefonu artık konum
          göndermiyor; Lenkzeit uyarısı vardiya saatinden hesaplandığı için
          konumdan bağımsız çalışmaya devam eder. */}
      {/* Lenkzeit (VO (EG) 561/2006) uyarısı müşteri ayarına bağlı: 2,5 t altı,
          sınır geçmeyen filoda AB sürüş-dinlenme tüzüğü uygulanmaz (bkz.
          lib/azg-rules.ts). HAK61'de AÇIK kalır — şoförler alışkın ve kaldırmak
          davranış değişikliği olurdu; Sendigo'da kapalı. */}
      {active && LENKZEIT_WARNING_ENABLED && (
        <>
          <LenkzeitWarning
            startedAt={active.started_at}
            isOnBreak={onBreak}
            breakMinutes={totalBreakSoFar}
            onStartBreak={() => {
              if (!onBreak) toggleBreak();
            }}
          />
        </>
      )}

      {showSummary && pendingSummary && (
        <ShiftSummaryCard
          entry={pendingSummary}
          week={{ ms: totals.weekMs, km: totals.weekKm, shifts: totals.weekShifts }}
          onLater={() => setSummaryLater(true)}
        />
      )}

      {showConfirm && active && (
        <ConfirmShiftCard
          plate={active.plate}
          startedAt={active.started_at}
          onLater={() => setConfirmLater(true)}
        />
      )}

      {active ? (
        <>
          {/* Üst blok: kocaman süre sayacı + bugünkü paket. Başka hiçbir şey. */}
          <Card>
            <CardContent className="space-y-4 py-5 text-center">
              {/* MOLADAYKEN sayaç yer değiştirir: molanın kendi süresi 00:00:00'dan
                  başlayıp öne çıkar, vardiya süresi küçülüp arkaya geçer. Eskiden
                  ekranda yalnız vardiya süresi dönüyordu ve şoför molasının kaç
                  dakika olduğunu göremiyordu — molanın tek görünür işareti donmuş
                  bir sayaçtı. */}
              {onBreak ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-accent-gold-text">
                    {t("v2OnBreakLabel")}
                  </div>
                  <div className="nums mt-1 text-6xl font-bold text-accent-gold-text">
                    {formatDuration(breakElapsedMs)}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t("v2BreakTarget", { min: breakTargetLocal })}
                    {" · "}
                    {t("v2ShiftTime")}:{" "}
                    <span className="nums text-foreground">
                      {formatDuration(workedMsLive)}
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t("v2ShiftTime")}
                  </div>
                  <div className="nums mt-1 text-6xl font-bold text-primary">
                    {formatDuration(workedMsLive)}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t("started")}:{" "}
                    <span className="nums text-foreground">
                      {formatTime(active.started_at, locale)}
                    </span>
                    {active.plate && (
                      <>
                        {" · "}
                        <span className="nums uppercase text-foreground">
                          {active.plate}
                        </span>
                      </>
                    )}
                    {/* Depo-tetikli otomatik açıldıysa şoför bilgilensin (Modül 7):
                        onay istemiyoruz, sadece "vardiyan depoya girişte başladı". */}
                    {active.auto_started && (
                      <>
                        {" · "}
                        <span className="text-accent-sky-text">{t("v2AutoDepotStart")}</span>
                      </>
                    )}
                    {/* Bugüne kadar yapılan toplam mola — molayı erken bitiren
                        şoför kaç dakika yaptığını burada görmeye devam eder. */}
                    {totalBreakSoFar > 0 && (
                      <>
                        {" · "}
                        {t("v2BreakTotal", { min: totalBreakSoFar })}
                      </>
                    )}
                  </div>
                </div>
              )}
              {PACKAGES_ENABLED && (
                <div className="flex items-center justify-center gap-3 border-t border-white/[0.06] pt-4">
                  <Package className="size-6 text-accent-sky-text" aria-hidden />
                  <span className="text-sm text-muted-foreground">
                    {t("v2TotalPackages")}
                  </span>
                  <span className="nums text-4xl font-bold text-foreground">
                    {packagesTaken ?? "—"}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tek dev buton. "FOTO ÇEK" ve "SORUN BİLDİR" panelden kaldırıldı
              (Volkan, 21.07.2026) — HAK61 kullanmıyordu. Bileşenleri ve rotaları
              (ShiftPhotoButton, ProblemReportDialog, /api foto yükleme) repoda
              DURUYOR; yalnız şoför ekranından gizlendi. */}
          {/* Paket modülü kapalı kiracıda bu dev buton HİÇ ÇIKMAZ — paket
              hiçbir adımda sorulmaz (03.08.2026). */}
          {PACKAGES_ENABLED && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={openPkg}
                className="btn-primary flex h-28 w-full items-center justify-center gap-4 rounded-2xl text-3xl font-bold tracking-wide text-primary-foreground shadow-lg transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98]"
              >
                <Package className="size-10" aria-hidden />
                {packagesTaken !== null ? t("v2EditPackages") : t("v2SetPackages")}
              </button>
              <div className="flex justify-center">
                <HelpTip tkey="drv_packages" />
              </div>
            </div>
          )}

          {/* İkincil: mola + vardiyayı bitir. Balonlar butonların İÇİNE değil
              üstlerine konuyor: butonlar dev ve tek dokunuşluk, içlerine (i)
              koymak yanlış dokunma riski yaratır (eldivenli el, sarsan araç). */}
          <div className="flex items-center justify-center gap-6 pb-0.5">
            <HelpTip tkey="drv_break" />
            {/* Balonun bugünkü metni "yalnız kaç paket geri getirdiğin
                sorulur" diyor — paket kapalıyken YANLIŞ. AdminClient'taki
                `_nopkg` deseninin aynısı. */}
            <HelpTip tkey={PACKAGES_ENABLED ? "drv_end" : "drv_end_nopkg"} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={toggleBreak}
              variant={onBreak ? "default" : "outline"}
              className="h-14 text-base"
              disabled={pending}
            >
              {onBreak ? (
                <>
                  <PlayCircle className="size-5" />
                  {t("endBreak")}
                </>
              ) : (
                <>
                  <Pause className="size-5" />
                  {t("startBreak")}
                </>
              )}
            </Button>
            {/* Önce DİKKAT uyarısı, sonra kapatma formu — TEK onay katmanı.
                Uyarı formdan SONRA sorulsaydı şoför paket sayısını girdikten
                sonra vazgeçmek zorunda kalırdı; kararın maliyeti en başta
                söylenmeli. */}
            <Button
              onClick={() => setConfirmEndOpen(true)}
              variant="destructive"
              className="h-14 text-base"
              disabled={pending}
            >
              <Square className="size-5" />
              {t("endShift")}
            </Button>
          </div>
        </>
      ) : shiftDoneToday ? (
        /* Günde tek vardiya: bugünkü vardiya kapandı. Kural duruyor — ikinci
           bir vardiya SATIRI açılmaz. Ama ekran artık çıkmaz sokak değil
           (22.07.2026): yanlışlıkla/erken kapatan şoför aynı vardiyayı
           YENİDEN AÇAR (sunucu yeni satır yazmaz, o günün son kapanmış
           vardiyasının ended_at'ini boşaltır). Aksi hâlde tek yanlış dokunuş
           günü bitiriyor ve yalnız yönetici kurtarabiliyordu. */
        <Card>
          <CardContent className="space-y-5 py-10 text-center">
            <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-accent-green/12 text-accent-green">
              <CheckCircle2 className="size-10" aria-hidden />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                {t("v2DayDoneTitle")}
              </h1>
              <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                {t("v2DayDoneDesc")}
              </p>
            </div>
            {/* İkincil eylem: dev yeşil "başlat" değil — bu bir düzeltme yolu,
                günün normal akışı değil. Bordo/outline ton hiyerarşiyi korur.

                'many' kiracısında (Sendigo) ANLAM DEĞİŞİR: gün kapandıktan
                sonra ikinci vardiya açmak bir düzeltme değil, işin NORMAL
                akışıdır (gece vardiyası + gündüz çağrı işi). O yüzden metin
                "yeniden aç" değil "yeni vardiya", ve serbest seçim kiracısında
                önce ARAÇ SEÇİCİ açılır — çünkü ikinci vardiya çoğu zaman
                başka plakayladır (canlıda: Can 20:2x'te DO-MDC3, 07:1x'te
                DO-MDC1). Seçici olmadan buton sabahki aracı varsayardı. */}
            <div className="space-y-2">
              <Button
                variant="outline"
                onClick={() =>
                  manyShiftsPerDay && freeVehicleChoice
                    ? openVehiclePicker()
                    : handleManualStart()
                }
                disabled={pending || pickerLoading}
                className="mx-auto h-14 w-full max-w-xs text-base"
              >
                {pending || pickerLoading ? (
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                ) : manyShiftsPerDay && freeVehicleChoice ? (
                  <Truck className="size-5" aria-hidden />
                ) : (
                  <PlayCircle className="size-5" aria-hidden />
                )}
                {manyShiftsPerDay
                  ? freeVehicleChoice
                    ? t("v2PickVehicleAndStart")
                    : t("v2DayDoneNewShift")
                  : t("v2DayDoneReopen")}
              </Button>
              <p className="mx-auto max-w-xs text-xs text-muted-foreground">
                {manyShiftsPerDay
                  ? t("v2DayDoneNewShiftHint")
                  : t("v2DayDoneReopenHint")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* Bekleme ekranı: kontak vardiyayı otomatik başlatır; aracı atanmış
           şoför beklemek istemezse elle de başlatabilir. */
        <Card>
          <CardContent className="space-y-5 py-10 text-center">
            <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-accent-sky/12 text-accent-sky-text pulse-soft">
              <KeyRound className="size-10" aria-hidden />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-foreground">
                {t("v2WaitTitle")}
              </h1>
              <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                {/* "Kontak açılınca otomatik başlar" cümlesi SERBEST SEÇİM
                    kiracısında YANLIŞTIR: otomatik motor vardiyayı aracın
                    ATANMIŞ şoförüne açar, burada atama yok — yani hiçbir zaman
                    kendiliğinden başlamaz. Şoföre yapması gerekeni söyleriz. */}
                {freeVehicleChoice ? t("v2WaitDescManual") : t("v2WaitDesc")}
              </p>
            </div>
            {assignedVehicle ? (
              <div className="inline-flex items-center gap-2 rounded-full bg-accent-sky/15 px-4 py-2 text-sm font-medium text-accent-sky-text">
                <span className="live-dot" aria-hidden />
                {t("v2YourVehicle")}:{" "}
                <span className="nums uppercase">{assignedVehicle.plate}</span>
              </div>
            ) : freeVehicleChoice ? (
              /* SERBEST SEÇİM kiracısında atama YOKLUĞU normaldir, kusur
                 değil — "aracın atanmamış" uyarısı ÇIKMAZ. Ne yapılacağını
                 yukarıdaki v2WaitDescManual zaten söylüyor, ikinci bir cümle
                 aynı şeyi tekrarlardı. */
              null
            ) : (
              <div className="mx-auto flex max-w-xs items-start gap-2 rounded-xl bg-accent-gold/12 px-4 py-3 text-left text-sm text-accent-gold-text">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t("v2WaitNoVehicle")}
              </div>
            )}

            {/* DEPO-GİRİŞ ÖNERİSİ (Modül 3): araç ≥3 dk depoda → mesai başlatma
                önerisi. OTOMATİK DEĞİL — aşağıdaki büyük buton tek dokunuşla
                başlatır (mesai depoda başlar, ev→depo yolu sayılmaz). Şoför
                kapatabilir; manuel başlatma her zaman açık. */}
            {depotPanel?.enteredAt &&
              !depotDismissed &&
              assignedVehicle &&
              assignedVehicle.status === "active" && (
                <div className="mx-auto max-w-xs rounded-2xl border-2 border-accent-sky/50 bg-accent-sky/10 p-4 text-left">
                  <p className="flex items-center gap-2 text-sm font-semibold text-accent-sky-text">
                    <MapPin className="size-4 shrink-0" aria-hidden />
                    {t("v2DepotArrived", {
                      time: formatTime(depotPanel.enteredAt, locale),
                    })}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("v2DepotStartHint")}
                  </p>
                  <button
                    type="button"
                    onClick={() => setDepotDismissed(true)}
                    className="mt-2 text-xs text-muted-foreground underline underline-offset-2"
                  >
                    {t("v2DepotDismiss")}
                  </button>
                </div>
              )}

            {/* Aracı atanmamış şoförde buton çıkmaz — yukarıdaki uyarı kalır.
                Aracı bakımdaysa buton yerine SEBEBİ yazılır; yoksa şoför
                "ekran bozuk" sanıp bekler. */}
            {assignedVehicle && assignedVehicle.status !== "active" && (
              <div className="mx-auto flex max-w-xs items-start gap-2 rounded-xl bg-accent-gold/12 px-4 py-3 text-left text-sm text-accent-gold-text">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t("v2StartVehicleMaintenance")}
              </div>
            )}
            {assignedVehicle && assignedVehicle.status === "active" && (
              <div className="space-y-2">
                {/* DEPO KİLİDİ (Modül 6): araç depo DIŞINDAYKEN buton pasif görünür
                    ve basınca neden çalışmadığını söyler — gizlenmez ki şoför anlasın.
                    Belirsiz/cihaz-ölü/muafiyette locked=false → normal çalışır. */}
                {depotPanel?.locked && (
                  <div className="mx-auto flex max-w-xs items-start gap-2 rounded-xl bg-accent-gold/12 px-4 py-3 text-left text-sm text-accent-gold-text">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {t("v2DepotLocked")}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() =>
                    depotPanel?.locked
                      ? toast.warning(t("v2DepotLocked"))
                      : handleManualStart()
                  }
                  disabled={pending}
                  aria-disabled={depotPanel?.locked || undefined}
                  className={`btn-primary flex h-24 w-full items-center justify-center gap-4 rounded-2xl text-xl font-bold tracking-wide text-primary-foreground shadow-lg transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98] disabled:opacity-60 ${
                    depotPanel?.locked ? "opacity-50" : ""
                  }`}
                >
                  {pending ? (
                    <Loader2 className="size-8 animate-spin" aria-hidden />
                  ) : (
                    <PlayCircle className="size-8" aria-hidden />
                  )}
                  {t("v2StartShift")}
                </button>
                <HelpTip tkey="drv_start" className="mx-auto" />
                {/* GEÇİCİ ARAÇ (22.07.2026): aracı bozulan / izinde olan
                    şoför başka araçla çıkar. Seçim YALNIZ bu vardiya için
                    geçerlidir — atanmış aracı değişmez, yarın yine kendi
                    aracıyla açar. Bordo aksan, yeni renk yok. */}
                <button
                  type="button"
                  onClick={openVehiclePicker}
                  disabled={pending || pickerLoading}
                  className="mx-auto flex items-center justify-center gap-2 rounded-[10px] border border-accent-claret/40 px-4 py-2.5 text-sm font-medium text-accent-claret-text transition-colors hover:bg-accent-claret/10 disabled:opacity-60"
                >
                  {pickerLoading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Truck className="size-4" aria-hidden />
                  )}
                  {t("v2OtherVehicle")}
                </button>
                <p className="mx-auto max-w-xs text-xs text-muted-foreground">
                  {t("v2StartHint")} {t("v2OncePerDayHint")}
                </p>
              </div>
            )}

            {/* SERBEST ARAÇ SEÇİMİ (03.08.2026, DRIVER_VEHICLE_CHOICE='free').
                Araç↔şoför sabit ataması olmayan filoda (aynı araç gece/gündüz
                farklı şoförlerde) vardiyayı açan kişi plakayı O AN seçer.
                Bu blok YALNIZCA atanmış araç yokken çıkar; ataması olan şoför
                yukarıdaki bildik akışı görür, yani HAK61 yolu değişmez.

                Sunucu tarafı zaten hazırdı: startShiftManualAction override
                araç kabul ediyor ve atanmış araç aramıyor (shift.ts). Burada
                yeni bir yazma yolu AÇILMIYOR, var olanın kapısı gösteriliyor. */}
            {!assignedVehicle && freeVehicleChoice && (
              <div className="space-y-2">
                {depotPanel?.locked && (
                  <div className="mx-auto flex max-w-xs items-start gap-2 rounded-xl bg-accent-gold/12 px-4 py-3 text-left text-sm text-accent-gold-text">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {t("v2DepotLocked")}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() =>
                    depotPanel?.locked
                      ? toast.warning(t("v2DepotLocked"))
                      : openVehiclePicker()
                  }
                  disabled={pending || pickerLoading}
                  aria-disabled={depotPanel?.locked || undefined}
                  className={`btn-primary flex h-24 w-full items-center justify-center gap-4 rounded-2xl text-xl font-bold tracking-wide text-primary-foreground shadow-lg transition-all duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98] disabled:opacity-60 ${
                    depotPanel?.locked ? "opacity-50" : ""
                  }`}
                >
                  {pending || pickerLoading ? (
                    <Loader2 className="size-8 animate-spin" aria-hidden />
                  ) : (
                    <Truck className="size-8" aria-hidden />
                  )}
                  {t("v2PickVehicleAndStart")}
                </button>
                <HelpTip tkey="drv_start" className="mx-auto" />
                <p className="mx-auto max-w-xs text-xs text-muted-foreground">
                  {t("v2StartHint")} {t("v2OncePerDayHint")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sessiz alt bağlantılar: geçmiş / ayarlar. "Seferler" linki kaldırıldı
          (Volkan, 21.07.2026); /panel/seferler rotası ve sefer modülü DURUYOR. */}
      {/* DOKUNMA HEDEFİ (mobilde ölçüldü): bu iki bağlantı 20px yüksekliğindeydi
          — WCAG 2.2 AA'nın 24px asgarisinin bile altında ve sarsılan bir aracın
          içinde eldivenli parmakla ıskalanır. Görsel olarak yine "sessiz" ama
          artık 44px'lik bir hap; şoför panelinin geri kalanıyla aynı ölçü. */}
      <div className="flex items-center justify-center gap-3 pb-2 text-sm">
        <Link
          href="/panel/gecmis"
          className="inline-flex min-h-[44px] items-center rounded-full px-4 font-medium text-muted-foreground transition-colors hover:bg-surface-panel hover:text-foreground"
        >
          {t("v2LinkHistory")}
        </Link>
        {/* ARAÇ KONTROLÜ (081) — geçmişle aynı sessiz banttan giriliyor.
            Vardiya başlatma akışının İÇİNE koymadık bilerek: kontrol formu
            vardiyanın ön koşulu DEĞİL (kiracı isterse şart koşar, ürün
            koşmaz) ve o akışa bir adım daha eklemek, günde iki kez yapılan
            en kritik işlemi yavaşlatırdı. */}
        <Link
          href="/panel/kontrol"
          className="inline-flex min-h-[44px] items-center rounded-full px-4 font-medium text-muted-foreground transition-colors hover:bg-surface-panel hover:text-foreground"
        >
          {t("v2LinkInspection")}
        </Link>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-full px-4 font-medium text-muted-foreground transition-colors hover:bg-surface-panel hover:text-foreground"
        >
          {t("v2LinkSettings")} <ArrowRight className="size-3" aria-hidden />
        </button>
      </div>

      {/* Ayarlar: başlangıç km düzeltme */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("v2LinkSettings")}</DialogTitle>
          </DialogHeader>
          {/* Başlangıç KM düzeltme kaldırıldı: km cihazdan geliyor, şoför
              sayaç girmiyor. Yanlış türetilmiş bir değeri yönetici düzeltir
              (çalışan detayındaki KM düzenle). */}
        </DialogContent>
      </Dialog>

      {/* Vardiyayı bitir — sade form: bitiş km + teslim edilemeyen + not */}
      <Dialog open={endOpen} onOpenChange={setEndOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("endShift")}</DialogTitle>
            {/* SORU ARTIK BAŞLIKTA. Eskiden burada şoförün kendi girdiği
                "Pakete gesamt: 175" yazıyordu — girmesi gereken sayı ile
                girdiği sayı yan yana duruyordu ve karışıyordu. */}
            <DialogDescription className="text-base text-foreground">
              {/* Paket modülü kapalıyken bu soru PAKET sorusudur ve sorulmaz;
                  yerine ne olacağını anlatan nötr bir cümle kalır. */}
              {PACKAGES_ENABLED ? t("v2ReturnQuestion") : t("v2EndNoPackagesDesc")}
            </DialogDescription>
          </DialogHeader>
          {/* ADIM 1 — SORU + İKİ BÜYÜK BUTON (22.07.2026 yeniden yazımı).
              Eski form tek bir "Nicht zugestellt (retour)" alanıydı: otomatik
              odaklı, varsayılan "0", üstünde de şoförün kendi girdiği toplam
              paket sayısı yazıyordu. Bir şoför aynı sayıyı iki kere girdi
              (alınan 175 / geri 175 → teslim edilen 0). Olumsuz soru + hazır
              sayı + otomatik odak üst üste binince hata kaçınılmazdı.
              Artık soru fiziksel ("kaç paket geri getirdin"), en sık cevap tek
              dokunuş, sayı girişi ise bilinçli bir seçimin arkasında. */}
          {returnMode === null ? (
            <div className="space-y-3 py-1">
              <button
                type="button"
                onClick={() => setReturnMode("none")}
                className="btn-primary flex h-20 w-full items-center justify-center gap-3 rounded-2xl text-xl font-bold text-primary-foreground shadow-lg transition-all active:scale-[0.98]"
              >
                <PackageCheck className="size-7" aria-hidden />
                {t("v2ReturnNone")}
              </button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setReturnMode("some")}
                className="h-20 w-full rounded-2xl text-lg font-semibold"
              >
                <PackageX className="size-6" aria-hidden />
                {t("v2ReturnSome")}
                <ArrowRight className="size-5" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEndOpen(false)}
                className="h-11 w-full text-muted-foreground"
              >
                {tc("cancel")}
              </Button>
            </div>
          ) : (
            /* ADIM 2 — sayı (gerekiyorsa) + BÜYÜK hesap + not + kapat.
               action={} DEĞİL onSubmit: React 19 form action'ı tamamlanınca
               formu sıfırlar, sunucu hatasında şoför girdiğini kaybederdi. */
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                submitEnd(new FormData(ev.currentTarget));
              }}
              className="space-y-4"
            >
              <input type="hidden" name="break_minutes" value={totalBreakSoFar} />
              {/* Paket kapalıyken alan HİÇ GÖNDERİLMEZ → sunucu null yazar,
                  yani "sayılmadı". 0 göndermek sayılmış gibi görünürdü. */}
              {PACKAGES_ENABLED && (
                <input
                  type="hidden"
                  name="undelivered_count"
                  value={undeliveredValue ?? ""}
                />
              )}
              {/* KM ALANI YOK (21.07.2026). Kilometre cihazdan türetiliyor. */}

              {returnMode === "some" && (
                <div className="space-y-1.5">
                  <Label htmlFor="undel_input" className="text-base">
                    {t("v2ReturnCountLabel")}
                  </Label>
                  {/* autoFocus YOK ve varsayılan BOŞ: şoför bilinçli yazsın. */}
                  <Input
                    id="undel_input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="0"
                    value={endUndel}
                    onChange={(e) => setEndUndel(e.target.value)}
                    className="nums h-16 text-2xl"
                  />
                </div>
              )}

              {/* BÜYÜK HESAP — eski tasarımda bu bilgi 11px soluk griydi ve
                  "Zugestellt: 0" uyarısı görülmedi. Artık ekranın en okunur
                  cümlesi; sonuç 0 ise bordoya döner. */}
              {PACKAGES_ENABLED && (
                <div className="rounded-xl bg-surface-2/60 px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    {packagesTaken !== null
                      ? t("v2CalcLine", {
                          taken: packagesTaken,
                          returned: undeliveredValue ?? 0,
                        })
                      : t("v2CalcNoTotal")}
                  </p>
                  {packagesTaken !== null && (
                    <p
                      className={`nums mt-1 text-3xl font-bold ${
                        deliveredPreview === 0
                          ? "text-accent-claret-text"
                          : "text-foreground"
                      }`}
                    >
                      {t("v2CalcDelivered", { n: deliveredPreview })}
                    </p>
                  )}
                </div>
              )}

              {/* ENGEL — alınan girilmemişken geri > 0. Şoförü çıkmaza sokmadan
                  eksik bilgiyi tamamlatıyoruz: buton paket dialogunu açar. */}
              {showBlock && (
                <div className="space-y-2 rounded-xl bg-accent-claret/12 px-4 py-3">
                  <p className="flex items-start gap-2 text-sm text-accent-claret-text">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {t(
                      undelCheck.code === "no_total"
                        ? "v2BlockNoTotal"
                        : undelCheck.code === "over"
                          ? "v2BlockOver"
                          : "v2PkgErr"
                    )}
                  </p>
                  {undelCheck.code === "no_total" && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full"
                      onClick={() => {
                        setEndOpen(false);
                        openPkg();
                      }}
                    >
                      <Package className="size-4" aria-hidden />
                      {t("v2SetPackages")}
                    </Button>
                  )}
                </div>
              )}

              {/* ONAY — mümkün ama sıra dışı. Engel değil, soru. */}
              {confirmNeeded && (
                <div className="space-y-2 rounded-xl bg-accent-gold/12 px-4 py-3">
                  <p className="flex items-start gap-2 text-sm text-accent-gold-text">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {t(
                      undelCheck.level === "confirm" && undelCheck.code === "all_returned"
                        ? "v2ConfirmAllReturned"
                        : "v2ConfirmManyReturned"
                    )}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 flex-1"
                      onClick={() => setConfirmNeeded(false)}
                    >
                      {t("v2ConfirmFix")}
                    </Button>
                    <Button
                      type="submit"
                      variant="destructive"
                      className="h-11 flex-1"
                      disabled={pending}
                    >
                      {pending && <Loader2 className="size-4 animate-spin" />}
                      {t("v2ConfirmYesClose")}
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="notes">{t("notes")}</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  rows={2}
                  maxLength={500}
                  placeholder={t("notesPlaceholder")}
                />
              </div>

              {!confirmNeeded && (
                <DialogFooter>
                  {/* Paket kapalıyken 1. adım YOK — dönülecek yer de yok. */}
                  {PACKAGES_ENABLED && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setReturnMode(null)}
                    >
                      {t("v2Back")}
                    </Button>
                  )}
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={pending || undelEmpty || undelCheck.level === "block"}
                  >
                    {pending && <Loader2 className="size-4 animate-spin" />}
                    {pending ? tc("saving") : t("endShift")}
                  </Button>
                </DialogFooter>
              )}
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* DİKKAT — kapatma akışının ilk ve TEK uyarısı. Kararın sonucunu
          ("bugün tekrar vardiya açamazsınız") soruyla birlikte yazar; "Evet"
          teslim edilemeyen paket formunu açar, kapatma orada tamamlanır. */}
      <Dialog open={confirmEndOpen} onOpenChange={setConfirmEndOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-accent-gold-text" aria-hidden />
              {t("v2ConfirmEndTitle")}
            </DialogTitle>
            <DialogDescription>{t("v2ConfirmEndDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-12 flex-1"
              onClick={() => setConfirmEndOpen(false)}
            >
              {tc("no")}
            </Button>
            <Button
              variant="destructive"
              className="h-12 flex-1"
              onClick={() => {
                setConfirmEndOpen(false);
                // Her açılışta sıfırdan: mod seçilmemiş, sayı boş, teyit yok.
                // Paket kapalıyken 1. adım yok — doğrudan "none"a açılır.
                setReturnMode(PACKAGES_ENABLED ? null : "none");
                setEndUndel("");
                setConfirmNeeded(false);
                setEndOpen(true);
              }}
            >
              {tc("yes")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Paket sayısı — alınan/planlanan toplam. Düz sayı girişi (mobil sayı
          klavyesi), +1 sayaç YOK. Gün içinde düzeltilebilir. */}
      <Dialog open={pkgOpen} onOpenChange={setPkgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("v2SetPackages")}</DialogTitle>
            <DialogDescription>{t("v2PackagesHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="pkg_total">{t("v2TotalPackages")}</Label>
            <Input
              id="pkg_total"
              type="number"
              inputMode="numeric"
              min={0}
              value={pkgVal}
              onChange={(e) => setPkgVal(e.target.value)}
              className="h-16 text-2xl nums"
              placeholder="0"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPkgOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={savePkg} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── GEÇİCİ ARAÇ SEÇİCİSİ ─────────────────────────────────────────────
          TÜM aktif araçlar listelenir; filo ayrımı BİLEREK yoktur (kural 2).
          Kendi aracı en üstte. Meşgul araçta uyarı rozeti, ama seçim serbest. */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            {/* Aynı dialog iki ayrı soruyu karşılıyor. Atanmış aracı OLAN
                şoförde soru "bugün başka araç mı?"dır. Serbest seçim
                kiracısında ise "kendi aracı" diye bir şey yoktur — o metin
                orada var olmayan bir aracı ima ederdi. */}
            <DialogTitle>
              {assignedVehicle ? t("v2OtherVehicle") : t("v2PickVehicleTitle")}
            </DialogTitle>
            <DialogDescription>
              {assignedVehicle ? t("v2OtherVehicleHint") : t("v2PickVehicleDesc")}
            </DialogDescription>
          </DialogHeader>
          {/* PLAKA ARAMASI — sabit atamasız filoda şoför kendi aracını
              listeden gözle aramak zorunda kalmasın. Marka/model de eşleşir.
              autoFocus YOK: mobilde klavye açılıp listeyi kapatırdı. */}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder={t("v2VehicleSearch")}
              aria-label={t("v2VehicleSearch")}
              className="nums h-11 pl-9 uppercase"
            />
          </div>
          {/* Liste artık İKİ BAŞLIK altında: boştakiler üstte, kullanımdakiler
              altta ve KİMİN kullandığı satırda görünür (21.08.2026). Meşgul araç
              seçilebilir kalır — uyarı diyaloğu aşağıda. */}
          <VehiclePickerList
            vehicles={visiblePickable}
            disabled={pending}
            onPick={pickVehicle}
          />
          {visiblePickable.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {pickable.length === 0
                ? t("v2VehicleNone")
                : t("v2VehicleNoMatch", { q: pickerQuery.trim() })}
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Meşgul araç onayı — bilgilendirir, engellemez. */}
      <Dialog
        open={confirmBusy !== null}
        onOpenChange={(o) => !o && setConfirmBusy(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmBusy?.plate}</DialogTitle>
            <DialogDescription>
              {t("v2VehicleBusyWarn", {
                name: confirmBusy?.inUseBy.join(", ") ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmBusy(null)}>
              {tc("cancel")}
            </Button>
            <Button
              onClick={() => {
                const v = confirmBusy;
                setConfirmBusy(null);
                setPickerOpen(false);
                if (v) handleManualStart(v.id);
              }}
              disabled={pending}
            >
              {t("v2VehicleBusyProceed")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
