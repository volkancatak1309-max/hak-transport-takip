import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { kolonYokMu, tabloYokMu, type ArizaDurum } from "@/lib/fault-reports";

/**
 * ELLE ARIZA BİLDİRİMİ — sorgu katmanı (migration 056).
 *
 * `lib/fault-reports.ts` saf kurallar (muhafız orayı Node'da çalıştırıyor),
 * burası `server-only` + `supabaseAdmin`. Bölünme keyfî değil: saf tarafa tek
 * bir DB satırı sızsa muhafız betiği çalışamaz olurdu.
 */

export type ArizaBildirimSatiri = {
  id: string;
  aciklama: string;
  durum: string;
  olusturma: string;
  bildirenId: string | null;
  /** Bildirenin adı — TÜRETİLMİŞ, tabloda yok. Çözülemezse null. */
  bildiren: string | null;
  /**
   * Kapatma izi (migration 057). AÇIK bildirimde ikisi de null — açık bir
   * bildirimin kapatma anı YOKTUR. Yeniden açılınca da null'a dönerler.
   * 057'si olmayan kurulumda kolonlar hiç gelmez, yine null olurlar.
   */
  kapatmaAni: string | null;
  kapatanId: string | null;
  kapatan: string | null;
};

/** Bir ekrana basılacak en fazla satır. Aşılırsa `kirpildi` ile SÖYLENİR. */
export const ARIZA_LISTE_TAVANI = 50;

export type ArizaBildirimListesi = {
  satirlar: ArizaBildirimSatiri[];
  /** `var` liste gerçek · `tablo_yok` migration 056 uygulanmamış · `hata` sorgu düştü. */
  durum: "var" | "tablo_yok" | "hata";
  /** Tablodaki TOPLAM satır (tavandan bağımsız). Hata hâlinde null. */
  toplam: number | null;
  kirpildi: boolean;
  /** migration 057 uygulanmış mı — false ise `kapatmaAni`/`kapatan` hep null. */
  kapatmaIzi: boolean;
};

/**
 * Bir aracın arıza bildirimleri, YENİDEN ESKİYE.
 *
 * ── BOŞ LİSTE ÜÇ AYRI ŞEY OLABİLİR ─────────────────────────────────────────
 * "bildirim yok" · "migration 056 bu kurulumda uygulanmamış" · "sorgu düştü".
 * Üçü yöneticiye farklı iş yaptırır, bu yüzden `durum` alanı taşınır. 056
 * yeni kurulumların install SQL'inde YOK — Sendigo/Galzura'da bu blok gerçekten
 * boş döner ve sebebini söylemezse "hiç arıza bildirilmemiş" gibi okunur.
 *
 * ── ADI NEDEN AYRI SORGU ───────────────────────────────────────────────────
 * PostgREST gömme (`workers(name)`) yerine iki adımlı anahtarlı okuma —
 * `listRecentEvents` ve `listIdleEpisodesInRange` ile aynı desen. Gömme,
 * ilişkinin şema önbelleğinde çözülmesine bağlıdır ve çözülmediğinde tüm
 * sorguyu düşürür; ad çözülemezse yalnız ad null olmalı, satır kaybolmamalı.
 *
 * TAVAN SÖYLENİR: `toplam` ile `kirpildi` beraber döner. 50 satır gösterip
 * "hepsi bu" demek, 300 bildirimi olan bir araçta sessiz kırpma olurdu.
 */
export async function listVehicleFaultReports(
  vehicleId: string
): Promise<ArizaBildirimListesi> {
  type Satir = {
    id: string;
    reported_by: string | null;
    aciklama: string;
    durum: string;
    created_at: string;
    closed_at?: string | null;
    closed_by?: string | null;
  };
  /** 057 kolonları AYRI: yoklarsa aynı sorgu onlarsız tekrarlanır (aşağıya bak). */
  const TEMEL = "id, reported_by, aciklama, durum, created_at";
  const oku = (kolonlar: string) =>
    supabaseAdmin
      .from("vehicle_fault_reports")
      .select(kolonlar, { count: "exact" })
      .eq("vehicle_id", vehicleId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }) // eş anlı kayıtlarda deterministik sıra
      .limit(ARIZA_LISTE_TAVANI);

  let { data, error, count } = await oku(`${TEMEL}, closed_at, closed_by`);
  /**
   * 056'sı olup 057'si OLMAYAN kurulum: kolon yoksa liste komple düşerdi.
   * Aynı sorgu 057 kolonları olmadan tekrarlanır — satırlar gelir, kapatma izi
   * alanları null kalır. Sessiz değil: `kapatmaIzi:false` bunu söyler.
   */
  const izVar = !(error && kolonYokMu(error));
  if (!izVar) ({ data, error, count } = await oku(TEMEL));

  if (error) {
    return {
      satirlar: [],
      durum: tabloYokMu(error) ? "tablo_yok" : "hata",
      toplam: null,
      kirpildi: false,
      kapatmaIzi: izVar,
    };
  }

  const rows = (data ?? []) as unknown as Satir[];

  // İki alan da kişi gösteriyor (bildiren + kapatan) — TEK sorguda çözülür.
  const ids = [
    ...new Set(
      rows.flatMap((r) => [r.reported_by, r.closed_by ?? null]).filter((x): x is string => !!x)
    ),
  ];
  let adlar = new Map<string, string>();
  if (ids.length) {
    const { data: wData } = await supabaseAdmin.from("workers").select("id, name").in("id", ids);
    adlar = new Map(((wData ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));
  }

  const toplam = count ?? rows.length;
  return {
    satirlar: rows.map((r) => ({
      id: r.id,
      aciklama: r.aciklama,
      durum: r.durum,
      olusturma: r.created_at,
      bildirenId: r.reported_by,
      bildiren: r.reported_by ? (adlar.get(r.reported_by) ?? null) : null,
      kapatmaAni: r.closed_at ?? null,
      kapatanId: r.closed_by ?? null,
      kapatan: r.closed_by ? (adlar.get(r.closed_by) ?? null) : null,
    })),
    durum: "var",
    toplam,
    kirpildi: toplam > rows.length,
    kapatmaIzi: izVar,
  };
}

export type ArizaYazmaSatiri = {
  id: string;
  vehicle_id: string;
  aciklama: string;
  durum: string;
  created_at: string;
  closed_at?: string | null;
  closed_by?: string | null;
};

export type ArizaDurumYazma =
  | { ok: true; satir: ArizaYazmaSatiri; degisti: boolean; kapatmaIzi: boolean }
  | { ok: false; sebep: "yok" | "tablo_yok" | "hata" };

/**
 * Bir bildirimin durumunu değiştirir (kapat / yeniden aç) ve KAPATMA İZİNİ
 * (migration 057) günceller.
 *
 * ── İZ KURALI ──────────────────────────────────────────────────────────────
 *   'kapali'ya geçiş → closed_at = şimdi, closed_by = isteği yapan yönetici
 *   'acik'a geçiş    → ikisi de NULL — açık bir bildirimin kapatma anı YOKTUR
 * Açılıp kapanma döngüsünün geçmişi tutulmuyor (057 notu): son kapanış geçerli.
 *
 * ── DEĞİŞİKLİK YOKSA HİÇ YAZILMAZ ──────────────────────────────────────────
 * Aynı durumu ikinci kez göndermek HATA DEĞİLDİR (iki telefonun aynı düğmeye
 * basması olağan) ama yazmak da yanlış olurdu: `closed_at` TAZELENİR ve ilk
 * kapatma anı kaybolurdu. Bu yüzden önce tam satır okunur; durum aynıysa satır
 * OLDUĞU GİBİ döner, `degisti:false` ve DB'ye hiç dokunulmaz.
 *
 * ── SAAT KİMİN ─────────────────────────────────────────────────────────────
 * `closed_at` UYGULAMA saatinden yazılır (`new Date()`), `created_at` ise şema
 * varsayılanıyla VERİTABANI saatinden. PostgREST gövdesine `now()` gibi bir SQL
 * ifadesi konamaz; tek alternatif tetikleyici yazmaktı ve iki kolon için
 * gereksiz. İki saat de NTP'li; fark milisaniye mertebesinde.
 *
 * Kayıt yoksa `yok` döner — uç 404 basar. `durum` ŞEMA CHECK'iyle de korunuyor:
 * ayıklama atlanırsa yazma 23514 ile düşer ve `hata` olur, sessizce geçmez.
 */
export async function setFaultReportStatus(
  id: string,
  durum: ArizaDurum,
  workerId: string
): Promise<ArizaDurumYazma> {
  const TEMEL = "id, vehicle_id, aciklama, durum, created_at";
  const okuSatir = (kolonlar: string) =>
    supabaseAdmin.from("vehicle_fault_reports").select(kolonlar).eq("id", id).maybeSingle();

  let { data: onceki, error: okumaHatasi } = await okuSatir(`${TEMEL}, closed_at, closed_by`);
  // 056 var, 057 YOK → kolonsuz tekrar dene. Uç çalışmaya devam eder ve
  // `kapatmaIzi:false` ile izin tutulmadığını SÖYLER.
  const izVar = !(okumaHatasi && kolonYokMu(okumaHatasi));
  if (!izVar) ({ data: onceki, error: okumaHatasi } = await okuSatir(TEMEL));

  if (okumaHatasi) {
    return { ok: false, sebep: tabloYokMu(okumaHatasi) ? "tablo_yok" : "hata" };
  }
  if (!onceki) return { ok: false, sebep: "yok" };
  const oncekiSatir = onceki as unknown as ArizaYazmaSatiri;

  // Durum zaten istenen değerse HİÇ YAZMA — ilk kapatma anı korunur.
  if (oncekiSatir.durum === durum) {
    return { ok: true, satir: oncekiSatir, degisti: false, kapatmaIzi: izVar };
  }

  const yama: Record<string, unknown> = { durum };
  if (izVar) {
    const kapaniyor = durum === "kapali";
    yama.closed_at = kapaniyor ? new Date().toISOString() : null;
    yama.closed_by = kapaniyor ? workerId : null;
  }

  const { data, error } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .update(yama)
    .eq("id", id)
    .select(izVar ? `${TEMEL}, closed_at, closed_by` : TEMEL)
    .maybeSingle();
  if (error) return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata" };
  if (!data) return { ok: false, sebep: "yok" };

  return {
    ok: true,
    satir: data as unknown as ArizaYazmaSatiri,
    degisti: true,
    kapatmaIzi: izVar,
  };
}
