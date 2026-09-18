import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { computeTopDriversByType, computeIdleWaste } from "@/lib/analytics";
import { TOP10_EVENT_TYPES, type DateRange } from "@/lib/analytics-shared";
import {
  okuEvren,
  okuOlaylar,
  okuRolanti,
  okuVardiyaMesafe,
  okuFiloSpan,
} from "@/lib/report-reads";
import { sayacIle } from "@/lib/query-counter";
import { buildPerformanceReport, buildFuelReport } from "@/lib/reports";
import { resolveCostRates } from "@/lib/cost-rates-db";
import { alarmKademe } from "@/lib/event-ui";
import { listFleets, type FiloSatiri } from "@/lib/fleets-db";
import type { FleetScope } from "@/lib/fleet-scope";

/**
 * FİLO KARŞILAŞTIRMASI (9D) — "hangi filo nasıl gidiyor".
 *
 * ═══ TEK KURAL: YENİ FORMÜL YOK ═══════════════════════════════════════════
 *
 * Bu modül HİÇBİR metriği kendi hesaplamaz. Yaptığı tek şey, Analiz ekranının
 * kullandığı GİRDİ DİZİLERİNİ filoya göre süzüp AYNI toplayıcıları filo başına
 * bir kez daha çağırmak:
 *
 *   alarm    → computeTopDriversByType(o filonun olayları, …)      [Analiz]
 *   rölanti  → computeIdleWaste(o filonun epizodları, …)           [Analiz]
 *   km       → getWorkerShiftDistance(...).windows[].km            [052 RPC]
 *   vardiya  → getWorkerShiftDistance(...).windows                 [052 RPC]
 *   yakıt    → buildFuelReport(range).rows (araç ekseninde)        [Yakıt raporu]
 *   skor     → buildPerformanceReport(range).rows (şoför ekseninde)[Performans]
 *   araç/kişi→ listFleets()                                        [Filo ucu]
 *
 * Sonucu ölçülebilir bir kimlik: Σ(filolar) === toplayıcının kendi genel
 * toplamı. Bu kimlik yanıtta `denklik` bloğuyla DÖNER — istemci ikinci bir
 * çağrı yapmadan doğrulayabilsin ve bir gün bozulursa sessiz kalmasın.
 *
 * ═══ ⚠️ KM İKİ EKSEN, İKİSİ AYNI SAYI DEĞİL ═══════════════════════════════
 *
 * Bu ucun `km` alanı 052 EKSENİDİR (`shift_odometer_spans` — cihaz odometresi).
 * Analiz ekranının `km` alanı ise `end_km - start_km` eksenidir. İkisi AYNI
 * OLGUYU ölçmez ve canlıda ayrışıyorlar (ölçüldü 16.09.2026):
 *     galzura-demo  hafta  Analiz  4.613 · 052  5.245   (+%13,7)
 *     galzura-demo  ay     Analiz 20.850 · 052 20.034   (−%3,9)
 *     HAK61         hafta  Analiz  2.776 · 052  3.455   (+%24,5)
 *     HAK61         ay     Analiz 17.681 · 052 17.757   (+%0,4)
 * Bu bir kusur değil, iki ölçüm yöntemi: 052 vardiya penceresindeki cihaz
 * odometresini okur, diğeri şoförün girdiği/işaretlenen sayaç farkını. Volkan
 * 052'yi SEÇTİ ("start/end_km DEĞİL"), dolayısıyla `km`in Σ'sı Analiz'in
 * km'sine EŞİT ÇIKMAZ ve çıkmamalı. Eşitlik iddiası 052 toplamına karşı
 * kurulur; `denklik.km.kaynak` alanı hangi eksenin ölçüldüğünü SÖYLER.
 * Vardiya sayısı, alarm ve rölanti Analiz ile BİREBİR eşittir.
 *
 * ═══ ⚠️ İKİ EVREN: SAYIM test-HARİÇ, METRİK test-DÂHİL ═════════════════════
 *
 * `aracSayisi`/`personelSayisi` `listFleets()`ten gelir ve TEST kayıtlarını
 * eler (panelin araç listesiyle aynı). Metrikler ise Analiz'in evrenini
 * kullanır ve Analiz test aracının olaylarını toplamdan DÜŞMEZ (Σ tur "filo
 * geneli, atanmamış araçların olayları dâhil"). İkisini zorla eşitlemek
 * şıklardan birini bozardı: ya panelle araç sayısı tutmazdı ya Analiz'le
 * alarm. Fark BİLİNÇLİ ve yanıtta `sayimTestHaric` ile söyleniyor.
 */

/** Filo başına tek satır. `kod: null` → filosuz araçların kovası. */
export type FiloKarsilastirmaSatiri = {
  /** Filo kodu; `null` yalnız "sahipsiz" kovasında. */
  kod: string | null;
  ad: string;
  /** Kiracının arayüzünde gösteriliyor mu (ACTIVE_FLEETS). Sahipsizde null. */
  gorunur: boolean | null;
  /** TEST kayıtları HARİÇ (listFleets ile aynı eleme). */
  aracSayisi: number;
  personelSayisi: number;
  /** 052 ekseni (shift_odometer_spans). `start/end_km` DEĞİL. */
  km: number;
  vardiyaSayisi: number;
  /** Yakıt raporu ölçemediyse null — 0 DEĞİL ("ölçülemedi" ≠ "hiç yakmadı"). */
  yakitLitre: number | null;
  yakitEuro: number | null;
  /**
   * Filonun L/100 km'si — YALNIZ güvenilirlik kapısını geçen araçlardan
   * (Σ litre / Σ km × 100). Kapıyı geçen araç yoksa null.
   *
   * ⚠️ PAYDA VE PAY AYNI KÜMEDEN. Bir aracın litresi gizlenmişse km'si de
   * paydaya girmez; yoksa "gizlediğimiz araç oranı aşağı çekiyor" olurdu.
   * Kapı tek yerde: lib/fuel-vehicle.ts `yakitKapisi`.
   */
  yakitL100: number | null;
  /** L/100'ün kaç araçtan geldiği — `aracSayisi` ile birlikte okunur. */
  yakitGuvenilirArac: number;
  alarm: {
    toplam: number;
    kritik: number;
    uyari: number;
    /**
     * Rutin kademe (bugün yalnız `idling`). Yanıtta DURUYOR çünkü Analiz'in
     * `alarm.toplam`ı rölanti epizodlarını da sayar; rutini gizleseydik
     * `toplam ≠ kritik + uyari` olur ve okuyan "eksik" sanırdı.
     */
    rutin: number;
  };
  rolantiSaat: number;
  /** buildPerformanceReport'un avgScore'uyla AYNI formül; null = skorlanan yok. */
  skorOrtalama: number | null;
  /** Ortalamanın paydası — partisyon kanıtı için taşınır. */
  skorlananSayisi: number;
  /** Alarm / 100 km. km 0 ise null (sıfıra bölme uydurulmaz). */
  kmBasinaAlarm: number | null;
};

/**
 * NORMALİZE KIYAS — "hangi filo daha iyi" sorusunun dürüst hâli.
 *
 * Ham toplamlar filo büyüklüğünü ölçer, performansı değil: 19 araçlı filo
 * elbette daha çok km yapar. Bu blok her metriği KENDİ paydasına bölüp filo
 * ortalamasına göre yüzde farkını verir.
 *
 * ⚠️ EN İYİ / EN KÖTÜ YALNIZ YÖNLÜ METRİKTE. `kmPerArac` yönsüzdür: çok km
 * yapmak ne iyi ne kötüdür, işin hacmidir. Ona ok koymak, yoğun çalışan
 * filoyu "kazanan" ilan etmek olurdu — ölçmediğimiz bir şeyi iddia etmek.
 */
export type NormalizeYon = "dusukIyi" | "yuksekIyi" | "yonsuz";

export type NormalizeFiloDegeri = {
  kod: string | null;
  ad: string;
  /** null = o filoda bu metrik ölçülemedi (0 DEĞİL). */
  deger: number | null;
  /** Filo ortalamasına göre yüzde fark; ortalama 0/null ise null. */
  yuzdeFark: number | null;
  /** Yalnız yönlü metrikte dolu. */
  enIyi: boolean;
  enKotu: boolean;
};

export type NormalizeMetrik = {
  anahtar: "kmPerArac" | "alarmPer100km" | "l100" | "rolantiSaatPerVardiya" | "skor";
  yon: NormalizeYon;
  /** Payda: metriğin neye bölündüğü (ekranda birim yazısı için). */
  birim: string;
  /** Tüm kapsamın tek sayısı — filoların ortalaması DEĞİL, bütünün oranı. */
  ortalama: number | null;
  filolar: NormalizeFiloDegeri[];
};

export type Denklik = {
  /** Σ filolar (+ sahipsiz). */
  filolarToplami: number;
  /** Toplayıcının kendi genel toplamı, aynı pencerede. */
  kaynakToplam: number;
  esit: boolean;
  /** Hangi toplayıcıdan geldiği — "Analiz ile aynı mı" sorusu buradan cevaplanır. */
  kaynak: string;
};

export type FiloKarsilastirmasi = {
  filolar: FiloKarsilastirmaSatiri[];
  /** Büyüklükten arındırılmış kıyas — bkz. NormalizeMetrik. */
  normalize: NormalizeMetrik[];
  /**
   * Filosu tanımlı filolardan HİÇBİRİ olmayan araçların kovası. Şefte null.
   * Gizlenmez: gizlenseydi Σ filolar < toplam olur ve fark sessizce kaybolurdu.
   */
  sahipsiz: FiloKarsilastirmaSatiri | null;
  toplam: FiloKarsilastirmaSatiri;
  /** Şefe daraltılmış kapsamda da geçerli — evren neyse Σ ona eşit olmalı. */
  denklik: {
    km: Denklik;
    vardiya: Denklik;
    alarm: Denklik;
    yakitLitre: Denklik;
    rolantiSaat: Denklik;
  };
  /** Yakıt €/L oranı ve nereden geldiği (resolveCostRates). */
  oran: { yakitEurPerL: number | null; kaynak: string };
  /** 052 yoksa/zaman aşımına uğradıysa sebep; km ve vardiya 0 döner. */
  kmKaynagi: "052" | "yok" | "zaman_asimi" | "hata";
  /** Yakıt raporu hesaplanamadıysa sebep. */
  yakitKaynagi: string | null;
  /**
   * PostgREST tavanı: olay/epizod okumaları `fetchAllRows` ile SAYFALI, yani
   * kırpılmaz. Kırpılabilecek tek yer 052 RPC'sinin dönüşüdür (tek atış).
   * 1000'e DAYANDIYSA söylenir — sessizce eksik sayı YASAK.
   */
  kirpildi: boolean;
  /** Sayımlar test kayıtlarını eliyor, metrikler elemiyor (yukarıdaki not). */
  sayimTestHaric: true;
};

const BOS_ALARM = { toplam: 0, kritik: 0, uyari: 0, rutin: 0 };

/** PostgREST'in tek atışta döndürebileceği tavan — dayanırsak kırpılmış olabiliriz. */
const POSTGREST_TAVAN = 1000;

function bosSatir(kod: string | null, ad: string): FiloKarsilastirmaSatiri {
  return {
    kod,
    ad,
    gorunur: null,
    aracSayisi: 0,
    personelSayisi: 0,
    km: 0,
    vardiyaSayisi: 0,
    yakitLitre: null,
    yakitEuro: null,
    yakitL100: null,
    yakitGuvenilirArac: 0,
    alarm: { ...BOS_ALARM },
    rolantiSaat: 0,
    skorOrtalama: null,
    skorlananSayisi: 0,
    kmBasinaAlarm: null,
  };
}

/** Alarm/100 km — tek yerde, üç çağıran da aynı kuralı kullansın. */
function kmBasina(alarmToplam: number, km: number): number | null {
  if (km <= 0) return null;
  return (alarmToplam * 100) / km;
}

/** avgScore ile AYNI formül: null'lar sayılmaz, payda skorlanan sayısıdır. */
function ortalama(degerler: number[]): number | null {
  if (degerler.length === 0) return null;
  return degerler.reduce((a, b) => a + b, 0) / degerler.length;
}

/**
 * ═══ TUR KABI + TEK DALGA (16. madde, 16.09.2026) ══════════════════════════
 *
 * ÖNCE: iki ardışık `Promise.all` bloğu vardı ve ikisi de kendi paylaşılan
 * okumalarını KENDİ başına yapıyordu. Yani `buildPerformanceReport` bitmeden
 * olay/epizod/052 okumaları başlamıyor, üstelik o rapor zaten aynı üç şeyi
 * kendi içinde okumuş oluyordu. Sorgu sayacıyla ölçüldü (demo, "ay"):
 *     fleet_odometer_spans 2× · shift_odometer_spans 3× · vehicle_events 6×
 *     idle_episodes 2× · vehicles 21× · workers 19×   → toplam 206 çağrı
 *
 * ŞİMDİ: `sayacIle` turu bir kap açıyor, paylaşılan okumalar `turMemo` ile
 * turda BİR KEZ yapılıyor (lib/report-reads.ts) ve bağımsız olan her şey TEK
 * dalgada başlıyor. Eşzamanlılık artmıyor: tekrarlar kalktığı için turun
 * toplam sorgu sayısı DÜŞÜYOR.
 *
 * ⚠️ HİÇBİR FORMÜL DEĞİŞMEDİ. Aynı toplayıcılar, aynı girdiler, aynı sıra-
 * bağımsız hesaplar. `denklik` bloğu bunun ölçülen kanıtı olarak duruyor.
 */
export async function buildFleetComparison(
  range: DateRange,
  scope: FleetScope
): Promise<FiloKarsilastirmasi> {
  return sayacIle(() => karsilastirmayiKur(range, scope));
}

async function karsilastirmayiKur(
  range: DateRange,
  scope: FleetScope
): Promise<FiloKarsilastirmasi> {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();

  /**
   * ── 1. DALGA: PAYLAŞILAN GİRDİLER ──────────────────────────────────────
   *
   * `vehicles/fleet` okuması da buraya alındı: eskiden iki raporun ARDINDAN
   * tek başına bekliyordu ve hiçbir şeye bağımlı değildi.
   *
   * ⚠️ `okuFiloSpan` BİLEREK BURADA, iki ağır raporla AYNI ANDA DEĞİL.
   * Ölçüldü (demo, "ay"): tek gövdeli 097 çağrısı rakipsizken 4.183 ms,
   * yani 8 sn'lik ifade tavanının yarısı. İki raporla birlikte koşturunca
   * tavanı aştı ve `null` döndü; her iki rapor da araç-araç yedek yola
   * düştü (device_telemetry çağrısı 91 → 207). Sonuç yine doğruydu ama
   * turda İKİ KAT iş yapılıyordu. Önce tek başına koşup memoya girmesi
   * hem hızlı hem de yedek yolu hiç tetiklemiyor.
   */
  // En uzun çağrı ÖNCE başlatılır; sonucu burada kullanılmıyor, amacı turun
  // memosuna girmesi. `await` aşağıda — bu satır yalnız işi kuyruğa koyar.
  const filoSpanIsi = okuFiloSpan(startISO, endISO);
  // Yakıt raporu da HEMEN başlar: 097'ye ancak en sonda ihtiyacı var, ilk
  // işi araç-eksenli yakıt RPC'leri. Böylece 097 beklerken boş geçen ~4 sn
  // yakıt RPC'leriyle doluyor.
  const yakitIsi = buildFuelReport(range);
  const [filoListesi, evren, events, idleEpisodes, shiftDist, aracSorgusu] =
    await Promise.all([
      listFleets(),
      okuEvren(),
      okuOlaylar(startISO, endISO),
      okuRolanti(startISO, endISO),
      okuVardiyaMesafe(startISO, endISO),
      // test-visible: metrikler Analiz'in evrenini kullanır ve Analiz test
      // aracının olaylarını toplamdan düşmez. Elersek Σ(filolar) Analiz'in
      // toplamına EŞİT ÇIKMAZ ve bu ucun tek sözü o eşitliktir. Sayımlar
      // (araç/personel) listFleets'ten gelir ve test kaydını eler — fark
      // yanıtta `sayimTestHaric` ile söyleniyor.
      supabaseAdmin.from("vehicles").select("id, fleet, assigned_worker_id"),
    ]);
  await filoSpanIsi;

  /**
   * ── 2. DALGA: İKİ AĞIR RAPOR, ARTIK YAN YANA ───────────────────────────
   * Eskiden ardışıktı (`buildPerformanceReport` bitmeden yakıt başlamıyordu).
   * Paylaştıkları her şey 1. dalgada okundu; burada yalnız KENDİ özel
   * sorguları kaldı, yani yan yana koşmaları eşzamanlılığı patlatmıyor.
   */
  const [rapor, yakit] = await Promise.all([
    buildPerformanceReport(range),
    yakitIsi,
  ]);

  const vehiclesById = new Map(evren.vehicles.map((v) => [v.id, v]));
  const workersById = new Map(evren.workers.map((w) => [w.id, w]));

  // ── Araç → filo. Metrik evreni: test elemesi YOK (sorgunun başındaki not).
  const { data: vehRows, error: vehErr } = aracSorgusu;
  if (vehErr) throw new Error("vehicles/fleet okunamadi");
  const aracSatirlari = (vehRows ?? []) as {
    id: string;
    fleet: string | null;
    assigned_worker_id: string | null;
  }[];
  const filoByArac = new Map<string, string | null>(
    aracSatirlari.map((v) => [v.id, v.fleet ?? null])
  );

  // Şoför → filo: ATANMIŞ aracından TÜRETİLİR (lib/fleet-scope.ts kararı;
  // workers üzerinde filo kolonu YOK ve olmamalı).
  const filoBySofor = new Map<string, string | null>();
  for (const v of aracSatirlari) {
    if (!v.assigned_worker_id) continue;
    if (!filoBySofor.has(v.assigned_worker_id)) {
      filoBySofor.set(v.assigned_worker_id, v.fleet ?? null);
    }
  }

  // ── Kapsam: şef yalnız KENDİ filosunu görür, "diğerleri" toplamı YOK ──────
  const tanimliKodlar = filoListesi.ok
    ? filoListesi.liste.filolar.map((f) => f.kod)
    : [];
  const gorunurKodlar = scope.restricted
    ? tanimliKodlar.filter((k) => k === scope.fleet)
    : tanimliKodlar;
  const kapsamdaMi = (filoKodu: string | null): boolean =>
    scope.restricted ? filoKodu === scope.fleet : true;

  // ── Filoya göre süzülmüş GİRDİ dizileri ──────────────────────────────────
  const kovaKodu = (aracId: string | null | undefined): string | null => {
    if (!aracId) return null;
    const f = filoByArac.get(aracId) ?? null;
    return f !== null && tanimliKodlar.includes(f) ? f : null;
  };

  /**
   * ── DÖNEMİN VARDİYALARI: ARALIKTA BAŞLAYANLAR ─────────────────────────────
   *
   * ⚠️ BU SÜZGEÇ ÖLÇÜMLE KONDU (HAK61, 16.09.2026). 052 RPC'si aralıkla
   * KESİŞEN tüm vardiyaları döndürüyor (skor için doğrusu bu: pencere "kim
   * direksiyondaydı"yı söyler). Analiz ise `started_at` aralık İÇİNDE olanları
   * sayıyor. Süzgeçsiz hâlde "ay" penceresinde 425 vardiya çıkıyordu, Analiz
   * 419 diyordu — altı ayrı şoförde birer vardiya, hepsi pencereden ÖNCE
   * başlayıp içine sarkmış. Süzgeçle sayı tam 419.
   *
   * Test/şoför kapsamı ise farkın sebebi DEĞİL: aynı ölçümde iki süzgeç de
   * uygulandığında sayı 425'te kaldı, yani 052'nin dönüşünde test ya da
   * yönetici vardiyası YOK. Bu yüzden burada yalnız zaman yüklemi hizalanıyor;
   * olmayan bir sızıntı için süzgeç eklemek, yanlış bir şeyi düzeltiyormuş
   * gibi görünen ölü kod olurdu.
   */
  const araStart = range.start.getTime();
  const araEnd = range.end.getTime();
  const donemVardiyalari = (shiftDist.windows ?? []).filter(
    (w) => w.startMs >= araStart && w.startMs <= araEnd
  );

  const satirlar: FiloKarsilastirmaSatiri[] = [];
  const filoTanimById = new Map<string, FiloSatiri>(
    (filoListesi.ok ? filoListesi.liste.filolar : []).map((f) => [f.kod, f])
  );

  const kovalar: (string | null)[] = [...gorunurKodlar];
  // Sahipsiz kova YALNIZ kısıtsız aktörde: şefin filosuna girmeyen araç onun
  // görmesi gereken bir şey değil (kapsam daraltması, gizleme değil).
  if (!scope.restricted) kovalar.push(null);

  /** TOPLAM L/100'ün pay ve paydası — kova döngüsünde biriktirilir. */
  const guvenilirToplam = { litre: 0, km: 0 };
  for (const kod of kovalar) {
    const tanim = kod !== null ? filoTanimById.get(kod) : undefined;
    const satir = bosSatir(
      kod,
      kod === null ? "Filosuz araçlar" : (tanim?.ad ?? kod)
    );
    satir.gorunur = tanim ? tanim.gorunur : null;
    satir.aracSayisi =
      kod === null
        ? aracSatirlari.filter((v) => kovaKodu(v.id) === null).length
        : (tanim?.aracSayisi ?? 0);
    satir.personelSayisi = kod === null ? 0 : (tanim?.personelSayisi ?? 0);

    // ALARM — Analiz'in fonksiyonu, yalnız bu kovanın olaylarıyla.
    const kovaEvents = events.filter((e) => kovaKodu(e.vehicle_id) === kod);
    const kovaIdle = idleEpisodes.filter((ep) => kovaKodu(ep.vehicle_id) === kod);
    const topByType = computeTopDriversByType(
      kovaEvents,
      kovaIdle,
      vehiclesById,
      workersById
    );
    for (const ty of TOP10_EVENT_TYPES) {
      const adet = topByType[ty].total;
      satir.alarm.toplam += adet;
      const kademe = alarmKademe(ty);
      if (kademe === "kritik") satir.alarm.kritik += adet;
      else if (kademe === "uyari") satir.alarm.uyari += adet;
      else satir.alarm.rutin += adet;
    }

    // RÖLANTİ — Analiz'in fonksiyonu, yalnız bu kovanın epizodlarıyla.
    satir.rolantiSaat =
      computeIdleWaste(kovaIdle, vehiclesById, workersById).totalMs / 3_600_000;

    // KM + VARDİYA — 052'nin vardiya pencereleri, aracın filosuna göre.
    const kovaVardiya = donemVardiyalari.filter(
      (w) => kovaKodu(w.vehicleId) === kod
    );
    satir.vardiyaSayisi = kovaVardiya.length;
    satir.km = kovaVardiya.reduce((a, w) => a + (w.km ?? 0), 0);

    // YAKIT — yakıt raporunun araç satırları; ölçülemeyen araç null taşır.
    if (yakit.available) {
      const kovaYakit = yakit.rows.filter((r) => kovaKodu(r.vehicleId) === kod);
      const olculen = kovaYakit.filter((r) => r.consumedLiters != null);
      satir.yakitLitre =
        olculen.length > 0
          ? olculen.reduce((a, r) => a + (r.consumedLiters ?? 0), 0)
          : null;
      /**
       * L/100 — GÜVENİLİRLİK KAPISINI GEÇEN araçlardan, pay ve payda AYNI
       * kümeden. `consumedLiters` kapıdan geçmişse dolu, geçememişse null
       * (lib/reports.ts 2. aşama); yani süzgeç burada yeniden yazılmıyor,
       * kapının kararı okunuyor.
       */
      const guvenilir = kovaYakit.filter(
        (r) => r.consumedLiters != null && r.km != null && r.km > 0
      );
      // oran-kume: `guvenilir` kümesi bir satır yukarıda HEM litre HEM km için
      // null'dan süzüldü; `?? 0` burada yalnız tür kapısı. Pay ve payda aynı
      // satırlardan geliyor — bir aracın litresi gizlenmişse km'si de yok.
      const gLitre = guvenilir.reduce((a, r) => a + (r.consumedLiters ?? 0), 0);
      const gKm = guvenilir.reduce((a, r) => a + (r.km ?? 0), 0);
      satir.yakitGuvenilirArac = guvenilir.length;
      satir.yakitL100 = gKm > 0 ? (gLitre / gKm) * 100 : null;
      // TOPLAM için pay/payda biriktirilir — oranların ortalaması DEĞİL.
      guvenilirToplam.litre += gLitre;
      guvenilirToplam.km += gKm;
    }

    // SKOR — Performans raporunun satırları, şoförün filosuna göre.
    const kovaSkorlar = rapor.rows
      .filter((r) => kapsamdaMi(filoBySofor.get(r.workerId) ?? null))
      .filter((r) => (filoBySofor.get(r.workerId) ?? null) === kod)
      .map((r) => r.safetyScore)
      .filter((s): s is number => s !== null);
    satir.skorOrtalama = ortalama(kovaSkorlar);
    satir.skorlananSayisi = kovaSkorlar.length;

    satir.kmBasinaAlarm = kmBasina(satir.alarm.toplam, satir.km);
    satirlar.push(satir);
  }

  const sahipsiz = satirlar.find((s) => s.kod === null) ?? null;
  const filolar = satirlar.filter((s) => s.kod !== null);

  // ── Yakıt €: resolveCostRates, DÖNEM BİTİŞİNE göre ───────────────────────
  // `asOf = range.end` — geçmiş bir dönemi BUGÜNKÜ fiyatla etiketlemek, biten
  // bir olguyu olmayan bir fiyatla fiyatlamaktır (lib/cost-rates-db.ts notu).
  const oranlar = await resolveCostRates(
    yakit.available ? yakit.fleetLPer100Km : null,
    new Date(),
    range.end
  );
  const eurPerL = oranlar.rates.fuelEurPerL ?? null;
  for (const s of satirlar) {
    s.yakitEuro =
      s.yakitLitre != null && eurPerL != null ? s.yakitLitre * eurPerL : null;
  }

  // ── TOPLAM: Σ döndürülen satırlar ────────────────────────────────────────
  const toplam = bosSatir(null, "TOPLAM");
  for (const s of satirlar) {
    toplam.aracSayisi += s.aracSayisi;
    toplam.personelSayisi += s.personelSayisi;
    toplam.km += s.km;
    toplam.vardiyaSayisi += s.vardiyaSayisi;
    toplam.alarm.toplam += s.alarm.toplam;
    toplam.alarm.kritik += s.alarm.kritik;
    toplam.alarm.uyari += s.alarm.uyari;
    toplam.alarm.rutin += s.alarm.rutin;
    toplam.rolantiSaat += s.rolantiSaat;
    toplam.skorlananSayisi += s.skorlananSayisi;
    if (s.yakitLitre != null) toplam.yakitLitre = (toplam.yakitLitre ?? 0) + s.yakitLitre;
    if (s.yakitEuro != null) toplam.yakitEuro = (toplam.yakitEuro ?? 0) + s.yakitEuro;
    toplam.yakitGuvenilirArac += s.yakitGuvenilirArac;
  }
  /**
   * TOPLAM L/100 da AYNI kümeden: güvenilir araçların Σlitre/Σkm.
   * Filoların oranlarının ORTALAMASI DEĞİL — küçük filoyu büyükle eşit
   * ağırlıkta sayar ve yüzde farklarını anlamsızlaştırırdı. Pay ve payda
   * kova döngüsünde SATIR SATIR biriktirildi, yani kümeler ayrışamaz.
   */
  toplam.yakitL100 =
    guvenilirToplam.km > 0
      ? (guvenilirToplam.litre / guvenilirToplam.km) * 100
      : null;
  const tumSkorlar = rapor.rows
    .filter((r) => kapsamdaMi(filoBySofor.get(r.workerId) ?? null))
    .map((r) => r.safetyScore)
    .filter((s): s is number => s !== null);
  toplam.skorOrtalama = ortalama(tumSkorlar);
  toplam.kmBasinaAlarm = kmBasina(toplam.alarm.toplam, toplam.km);

  // ── NORMALİZE KIYAS: büyüklükten arındırılmış beş metrik ─────────────────
  /**
   * PAYDA HER METRİKTE FARKLI ve bilerek: kilometreyi araç sayısına, alarmı
   * kilometreye, rölantiyi vardiyaya bölüyoruz. Aynı paydaya zorlamak (ör.
   * hepsini araca bölmek) az vardiya açan filoyu haksız yere iyi gösterirdi.
   *
   * `ortalama` FİLOLARIN ORTALAMASI DEĞİL, bütünün oranıdır (Σpay/Σpayda).
   * Ortalamanın ortalaması küçük filoyu büyük filoyla eşit ağırlıkta sayar ve
   * yüzde farkları anlamsızlaşır.
   */
  const oran2 = (pay: number | null, payda: number | null): number | null =>
    pay === null || payda === null || payda === 0 ? null : pay / payda;
  const metrikTanim: {
    anahtar: NormalizeMetrik["anahtar"];
    yon: NormalizeYon;
    birim: string;
    deger: (x: FiloKarsilastirmaSatiri) => number | null;
  }[] = [
    {
      anahtar: "kmPerArac",
      yon: "yonsuz",
      birim: "km / araç",
      deger: (x) => oran2(x.km, x.aracSayisi),
    },
    {
      anahtar: "alarmPer100km",
      yon: "dusukIyi",
      birim: "alarm / 100 km",
      deger: (x) => (x.km > 0 ? (x.alarm.toplam / x.km) * 100 : null),
    },
    {
      anahtar: "l100",
      yon: "dusukIyi",
      birim: "L / 100 km",
      deger: (x) => x.yakitL100,
    },
    {
      anahtar: "rolantiSaatPerVardiya",
      yon: "dusukIyi",
      birim: "rölanti saat / vardiya",
      deger: (x) => oran2(x.rolantiSaat, x.vardiyaSayisi),
    },
    { anahtar: "skor", yon: "yuksekIyi", birim: "puan", deger: (x) => x.skorOrtalama },
  ];
  const normalize: NormalizeMetrik[] = metrikTanim.map((m) => {
    const ortalama = m.deger(toplam);
    const degerler = filolar.map((x) => ({
      kod: x.kod,
      ad: x.ad,
      deger: m.deger(x),
      yuzdeFark: null as number | null,
      enIyi: false,
      enKotu: false,
    }));
    for (const d of degerler) {
      d.yuzdeFark =
        d.deger === null || ortalama === null || ortalama === 0
          ? null
          : ((d.deger - ortalama) / ortalama) * 100;
    }
    // İşaret YALNIZ yönlü metrikte ve YALNIZ ölçülmüş değerler arasında.
    if (m.yon !== "yonsuz") {
      const olculen = degerler.filter((d) => d.deger !== null);
      if (olculen.length >= 2) {
        const sirali = [...olculen].sort((a, b) => (a.deger as number) - (b.deger as number));
        const iyi = m.yon === "dusukIyi" ? sirali[0] : sirali[sirali.length - 1];
        const kotu = m.yon === "dusukIyi" ? sirali[sirali.length - 1] : sirali[0];
        // Beraberlikte işaret KONMAZ: "en iyi" bir sıralama iddiasıdır.
        if (iyi.deger !== kotu.deger) {
          iyi.enIyi = true;
          kotu.enKotu = true;
        }
      }
    }
    return { anahtar: m.anahtar, yon: m.yon, birim: m.birim, ortalama, filolar: degerler };
  });

  // ── DENKLİK: Σ satırlar === toplayıcının kendi toplamı ───────────────────
  // Kısıtlı aktörde kaynak toplam da AYNI kapsama süzülür; kimlik iki durumda
  // da geçerli olmalı.
  const kapsamdakiArac = (aracId: string | null | undefined) =>
    kapsamdaMi(kovaKodu(aracId));

  const kapsamVardiya = donemVardiyalari.filter((w) =>
    kapsamdakiArac(w.vehicleId)
  );
  const kaynakKm = kapsamVardiya.reduce((a, w) => a + (w.km ?? 0), 0);
  const kaynakVardiya = kapsamVardiya.length;
  const kapsamEvents = events.filter((e) => kapsamdakiArac(e.vehicle_id));
  const kapsamIdle = idleEpisodes.filter((ep) => kapsamdakiArac(ep.vehicle_id));
  const kaynakTop = computeTopDriversByType(
    kapsamEvents,
    kapsamIdle,
    vehiclesById,
    workersById
  );
  const kaynakAlarm = TOP10_EVENT_TYPES.reduce(
    (a, ty) => a + kaynakTop[ty].total,
    0
  );
  const kaynakRolanti =
    computeIdleWaste(kapsamIdle, vehiclesById, workersById).totalMs / 3_600_000;
  const kaynakYakit = yakit.available
    ? yakit.rows
        .filter((r) => kapsamdakiArac(r.vehicleId) && r.consumedLiters != null)
        .reduce((a, r) => a + (r.consumedLiters ?? 0), 0)
    : 0;

  const esitMi = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const denklik = {
    km: {
      filolarToplami: toplam.km,
      kaynakToplam: kaynakKm,
      esit: esitMi(toplam.km, kaynakKm),
      // ⚠️ Analiz'in `km`i BAŞKA EKSEN (end_km - start_km). Eşitlik 052'ye karşı.
      kaynak: "shift_odometer_spans (052) · Analiz'in km ekseni DEĞİL",
    },
    vardiya: {
      filolarToplami: toplam.vardiyaSayisi,
      kaynakToplam: kaynakVardiya,
      esit: esitMi(toplam.vardiyaSayisi, kaynakVardiya),
      kaynak: "shift_odometer_spans pencereleri · Analiz `vardiya` ile aynı",
    },
    alarm: {
      filolarToplami: toplam.alarm.toplam,
      kaynakToplam: kaynakAlarm,
      esit: esitMi(toplam.alarm.toplam, kaynakAlarm),
      kaynak: "computeTopDriversByType · Analiz `alarm.toplam` ile aynı",
    },
    yakitLitre: {
      filolarToplami: toplam.yakitLitre ?? 0,
      kaynakToplam: kaynakYakit,
      esit: esitMi(toplam.yakitLitre ?? 0, kaynakYakit),
      kaynak: "buildFuelReport satırları · Yakıt raporuyla aynı",
    },
    rolantiSaat: {
      filolarToplami: toplam.rolantiSaat,
      kaynakToplam: kaynakRolanti,
      esit: esitMi(toplam.rolantiSaat, kaynakRolanti),
      kaynak: "computeIdleWaste · Analiz `rolanti.toplamMs` ile aynı",
    },
  };

  return {
    filolar,
    normalize,
    sahipsiz,
    toplam,
    denklik,
    oran: {
      yakitEurPerL: eurPerL,
      kaynak: oranlar.origin.fuel.source,
    },
    kmKaynagi:
      shiftDist.unavailable === null
        ? "052"
        : shiftDist.unavailable === "missing_function"
          ? "yok"
          : shiftDist.unavailable === "timeout"
            ? "zaman_asimi"
            : "hata",
    yakitKaynagi: yakit.available ? null : yakit.unavailableReason,
    // Tek atışlık RPC tavana dayandıysa sayılar EKSİK olabilir — söylenir.
    kirpildi: (shiftDist.windows?.length ?? 0) >= POSTGREST_TAVAN,
    sayimTestHaric: true,
  };
}

