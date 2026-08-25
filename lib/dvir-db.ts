import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu } from "@/lib/fault-reports";
import { kullanimdaMi, type SilmeSonucu } from "@/lib/silme-sonucu";

/**
 * ARAÇ KONTROL FORMU (DVIR) — veri katmanı (migration 081).
 *
 * ═══ KUSUR → İŞ EMRİ AYNI YOLDA ═══
 *
 * `createForm` yanıtları yazdıktan sonra KUSURLU olanların her biri için bir
 * iş emri açıyor (`vehicle_fault_reports`, `kaynak='dvir'`). Ayrı bir çağrı
 * olarak bırakılsaydı, formu yazıp iş emrini açmayan bir yol doğardı ve kusur
 * kayda geçmiş ama kimse görmemiş olurdu — görevin tam olarak kaçınmak
 * istediği hâl.
 *
 * ⚠️ POSTGREST'TE İŞLEM (transaction) YOK. Form + yanıtlar + iş emirleri üç
 * ayrı yazma. Sıra bilinçli: önce form, sonra yanıtlar, en son iş emri. Yarıda
 * kesilirse eldeki şey EKSİK BİR KAYIT değil, İŞ EMRİSİZ BİR KUSURDUR ve o
 * panelde görünür (kusurlu yanıt listede durur). Tersi sıra, iş emri açılmış
 * ama kusuru olmayan bir kayıt bırakırdı.
 *
 * ═══ DEĞİŞMEZLİK ═══
 *
 * Bu dosyada form/yanıt GÜNCELLEME fonksiyonu yoktur — iptal dışında.
 * Veritabanı da aynı şeyi söylüyor (`trg_dvir_form_degismez`).
 */

export type DvirMadde = {
  id: string;
  kod: string;
  etiket: string;
  aciklama: string | null;
  tur: "once" | "sonra" | "ikisi";
  aracTipi: string | null;
  sira: number;
  aktif: boolean;
};

export type DvirYanitDurum = "tamam" | "kusurlu" | "uygulanamaz";

export type DvirYanit = {
  id: string;
  maddeId: string;
  maddeEtiket: string;
  durum: DvirYanitDurum;
  notlar: string | null;
  fotoYolu: string | null;
};

export type DvirForm = {
  id: string;
  vehicleId: string;
  workerId: string;
  seferId: string | null;
  tur: "once" | "sonra";
  odometreKm: number | null;
  odometreKaynak: "telemetri" | "yok";
  latitude: number | null;
  longitude: number | null;
  dogrulukM: number | null;
  dolduruldAt: string;
  iptalAt: string | null;
  iptalSebep: string | null;
  yanitlar: DvirYanit[];
};

const MADDE_COLS = "id, kod, etiket, aciklama, tur, arac_tipi, sira, aktif";
const FORM_COLS =
  "id, vehicle_id, worker_id, sefer_id, tur, odometre_km, odometre_kaynak, latitude, longitude, konum_dogruluk_m, dolduruldu_at, iptal_at, iptal_sebep";
const YANIT_COLS = "id, form_id, madde_id, durum, notlar, foto_yolu";

function maddeCevir(r: Record<string, unknown>): DvirMadde {
  return {
    id: String(r.id),
    kod: String(r.kod),
    etiket: String(r.etiket),
    aciklama: r.aciklama ? String(r.aciklama) : null,
    tur: String(r.tur) as DvirMadde["tur"],
    aracTipi: r.arac_tipi ? String(r.arac_tipi) : null,
    sira: Number(r.sira ?? 100),
    aktif: Boolean(r.aktif),
  };
}

export type DvirSonuc<T> =
  | { ok: true; veri: T }
  | { ok: false; sebep: "tablo_yok" | "cakisma" | "madde_yok" | "kanit_yok" | "hata"; mesaj?: string };

// ── MADDE SÖZLÜĞÜ (kiracı tanımlar) ───────────────────────────────────────

export async function listDvirMaddeleri(
  yalnizAktif = false,
  tur?: "once" | "sonra"
): Promise<{ maddeler: DvirMadde[]; tabloYok: boolean }> {
  // test-visible: madde SÖZLÜĞÜ — kişiye ait veri değil, kiracının tanımladığı
  // etiket kümesi. `is_test` kavramı bu tabloda YOK.
  let q = supabaseAdmin.from("dvir_maddeleri").select(MADDE_COLS);
  if (yalnizAktif) q = q.eq("aktif", true);
  const { data, error } = await q.order("sira").order("etiket");
  if (error) return { maddeler: [], tabloYok: tabloYokMu(error) };
  let maddeler = ((data ?? []) as Record<string, unknown>[]).map(maddeCevir);
  // "ikisi" her iki kontrolde de sorulur; süzme KODDA çünkü tek bir eq()
  // 'ikisi' satırlarını da elemek zorunda kalırdı.
  if (tur) maddeler = maddeler.filter((m) => m.tur === tur || m.tur === "ikisi");
  return { maddeler, tabloYok: false };
}

export async function upsertDvirMadde(
  m: {
    id?: string;
    kod: string;
    etiket: string;
    aciklama?: string | null;
    tur: DvirMadde["tur"];
    aracTipi?: string | null;
    sira: number;
    aktif: boolean;
  },
  actorWorkerId: string | null
): Promise<DvirSonuc<{ id: string }>> {
  const satir = {
    // 078'deki kural: kod küçük harfe iner — 'FREN' ve 'fren' aynı maddedir.
    kod: m.kod.trim().toLowerCase(),
    etiket: m.etiket.trim(),
    aciklama: m.aciklama?.trim() || null,
    tur: m.tur,
    arac_tipi: m.aracTipi?.trim() || null,
    sira: m.sira,
    aktif: m.aktif,
  };
  const q = m.id
    ? supabaseAdmin.from("dvir_maddeleri").update(satir).eq("id", m.id).select("id").maybeSingle()
    : supabaseAdmin
        .from("dvir_maddeleri")
        .insert({ ...satir, created_by: actorWorkerId })
        .select("id")
        .maybeSingle();
  const { data, error } = await q;
  if (error || !data) {
    return {
      ok: false,
      sebep: error && tabloYokMu(error)
        ? "tablo_yok"
        : (error?.code ?? "") === "23505"
          ? "cakisma"
          : "hata",
      mesaj: error?.message,
    };
  }
  return { ok: true, veri: { id: String((data as { id: string }).id) } };
}

// ── FORM YAZMA ────────────────────────────────────────────────────────────

export type YanitGirdi = {
  maddeId: string;
  durum: DvirYanitDurum;
  notlar?: string | null;
  fotoYolu?: string | null;
};

export type FormGirdi = {
  vehicleId: string;
  workerId: string;
  seferId?: string | null;
  tur: "once" | "sonra";
  odometreKm?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  dogrulukM?: number | null;
  yanitlar: YanitGirdi[];
};

/**
 * Formu, yanıtları ve kusurlardan doğan iş emirlerini yazar.
 *
 * Dönen `isEmri` sayısı KUSUR sayısıdır: her kusurlu madde bir iş emri açar.
 * Tek bir toplu iş emri açmak, servise "şu üç şey bozuk" diyen ama biri
 * düzelince kalanı kapatılamayan bir kayıt üretirdi.
 */
export async function createDvirForm(
  g: FormGirdi
): Promise<DvirSonuc<{ formId: string; kusur: number; isEmri: number }>> {
  if (g.yanitlar.length === 0) return { ok: false, sebep: "madde_yok" };

  // Kusurda kanıt şartı BURADA da denetleniyor (şemada da var): hatayı
  // kullanıcıya kısıt ihlali olarak değil, cümle olarak döndürmek için.
  for (const y of g.yanitlar) {
    if (y.durum === "kusurlu" && (!y.fotoYolu || !y.notlar?.trim())) {
      return { ok: false, sebep: "kanit_yok", mesaj: y.maddeId };
    }
  }

  const { data: formRow, error: formHata } = await supabaseAdmin
    .from("dvir_formlari")
    .insert({
      vehicle_id: g.vehicleId,
      worker_id: g.workerId,
      sefer_id: g.seferId ?? null,
      tur: g.tur,
      odometre_km: g.odometreKm ?? null,
      // Kaynak DEĞERDEN türetiliyor: km yoksa "yok". Elle giriş yolu YOK.
      odometre_kaynak: g.odometreKm == null ? "yok" : "telemetri",
      latitude: g.latitude ?? null,
      longitude: g.longitude ?? null,
      konum_dogruluk_m: g.dogrulukM ?? null,
    })
    .select("id")
    .maybeSingle();

  if (formHata || !formRow) {
    return {
      ok: false,
      sebep: formHata && tabloYokMu(formHata) ? "tablo_yok" : "hata",
      mesaj: formHata?.message,
    };
  }
  const formId = String((formRow as { id: string }).id);

  const { data: yanitRows, error: yanitHata } = await supabaseAdmin
    .from("dvir_yanitlari")
    .insert(
      g.yanitlar.map((y) => ({
        form_id: formId,
        madde_id: y.maddeId,
        durum: y.durum,
        notlar: y.notlar?.trim() || null,
        foto_yolu: y.fotoYolu || null,
      }))
    )
    .select("id, madde_id, durum, notlar");
  if (yanitHata) {
    return { ok: false, sebep: "hata", mesaj: yanitHata.message };
  }

  // ── KUSUR → İŞ EMRİ ──
  const kusurlular = ((yanitRows ?? []) as Record<string, unknown>[]).filter(
    (r) => String(r.durum) === "kusurlu"
  );
  let acilan = 0;
  if (kusurlular.length > 0) {
    // Madde etiketleri iş emri açıklamasına giriyor: servisteki kişi
    // "madde_id 3f2a…" değil "Fren sistemi" görmeli.
    const maddeIds = [...new Set(kusurlular.map((r) => String(r.madde_id)))];
    const { data: mRows } = await supabaseAdmin
      .from("dvir_maddeleri")
      .select("id, etiket")
      .in("id", maddeIds);
    const etiket = new Map(
      ((mRows ?? []) as { id: string; etiket: string }[]).map((m) => [m.id, m.etiket])
    );

    const { data: acilanlar, error: emirHata } = await supabaseAdmin
      .from("vehicle_fault_reports")
      .insert(
        kusurlular.map((r) => ({
          vehicle_id: g.vehicleId,
          reported_by: g.workerId,
          aciklama: `${etiket.get(String(r.madde_id)) ?? "Kontrol maddesi"}: ${
            String(r.notlar ?? "").slice(0, 400) || "kusurlu"
          }`,
          durum: "acik",
          kaynak: "dvir",
          dvir_yanit_id: String(r.id),
        }))
      )
      .select("id");
    if (emirHata) {
      // İş emri açılamadıysa FORM YİNE DE geçerlidir: kusur kayıtta duruyor.
      // Sessizce yutmuyoruz — çağıran sayıyı görüp kullanıcıya söyleyebilsin.
      return { ok: true, veri: { formId, kusur: kusurlular.length, isEmri: 0 } };
    }
    acilan = (acilanlar ?? []).length;
  }

  return { ok: true, veri: { formId, kusur: kusurlular.length, isEmri: acilan } };
}

// ── FORM OKUMA ────────────────────────────────────────────────────────────

async function formlariDoldur(satirlar: Record<string, unknown>[]): Promise<DvirForm[]> {
  if (satirlar.length === 0) return [];
  const ids = satirlar.map((r) => String(r.id));
  const [{ data: yRows }, { data: mRows }] = await Promise.all([
    supabaseAdmin.from("dvir_yanitlari").select(YANIT_COLS).in("form_id", ids),
    supabaseAdmin.from("dvir_maddeleri").select("id, etiket"),
  ]);
  const etiket = new Map(
    ((mRows ?? []) as { id: string; etiket: string }[]).map((m) => [m.id, m.etiket])
  );
  const yanitMap = new Map<string, DvirYanit[]>();
  for (const y of (yRows ?? []) as Record<string, unknown>[]) {
    const k = String(y.form_id);
    const arr = yanitMap.get(k) ?? [];
    arr.push({
      id: String(y.id),
      maddeId: String(y.madde_id),
      maddeEtiket: etiket.get(String(y.madde_id)) ?? "—",
      durum: String(y.durum) as DvirYanitDurum,
      notlar: y.notlar ? String(y.notlar) : null,
      fotoYolu: y.foto_yolu ? String(y.foto_yolu) : null,
    });
    yanitMap.set(k, arr);
  }
  return satirlar.map((r) => ({
    id: String(r.id),
    vehicleId: String(r.vehicle_id),
    workerId: String(r.worker_id),
    seferId: r.sefer_id ? String(r.sefer_id) : null,
    tur: String(r.tur) as "once" | "sonra",
    odometreKm: r.odometre_km == null ? null : Number(r.odometre_km),
    odometreKaynak: String(r.odometre_kaynak) as "telemetri" | "yok",
    latitude: r.latitude == null ? null : Number(r.latitude),
    longitude: r.longitude == null ? null : Number(r.longitude),
    dogrulukM: r.konum_dogruluk_m == null ? null : Number(r.konum_dogruluk_m),
    dolduruldAt: String(r.dolduruldu_at),
    iptalAt: r.iptal_at ? String(r.iptal_at) : null,
    iptalSebep: r.iptal_sebep ? String(r.iptal_sebep) : null,
    yanitlar: (yanitMap.get(String(r.id)) ?? []).sort((a, b) =>
      a.maddeEtiket.localeCompare(b.maddeEtiket)
    ),
  }));
}

/** Aracın son kontrol formları (yönetici ekranı). */
export async function listDvirByVehicle(
  vehicleId: string,
  limit = 20
): Promise<{ formlar: DvirForm[]; tabloYok: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("dvir_formlari")
    .select(FORM_COLS)
    .eq("vehicle_id", vehicleId)
    .order("dolduruldu_at", { ascending: false })
    .limit(limit);
  if (error) return { formlar: [], tabloYok: tabloYokMu(error) };
  return { formlar: await formlariDoldur((data ?? []) as Record<string, unknown>[]), tabloYok: false };
}

/** Şoförün kendi formları. */
export async function listDvirByWorker(
  workerId: string,
  limit = 20
): Promise<{ formlar: DvirForm[]; tabloYok: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("dvir_formlari")
    .select(FORM_COLS)
    .eq("worker_id", workerId)
    .order("dolduruldu_at", { ascending: false })
    .limit(limit);
  if (error) return { formlar: [], tabloYok: tabloYokMu(error) };
  return { formlar: await formlariDoldur((data ?? []) as Record<string, unknown>[]), tabloYok: false };
}

export async function getDvirForm(id: string): Promise<DvirForm | null> {
  const { data, error } = await supabaseAdmin
    .from("dvir_formlari")
    .select(FORM_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const [form] = await formlariDoldur([data as Record<string, unknown>]);
  return form ?? null;
}

/** Formu geçersiz ilan eder — silmez (080/081 deseni). */
export async function iptalDvirForm(
  id: string,
  sebep: string,
  actorWorkerId: string | null
): Promise<DvirSonuc<{ id: string }>> {
  const temiz = sebep.trim();
  if (temiz.length < 3) return { ok: false, sebep: "hata", mesaj: "sebep_kisa" };
  const { error } = await supabaseAdmin
    .from("dvir_formlari")
    .update({ iptal_at: new Date().toISOString(), iptal_sebep: temiz.slice(0, 300), iptal_eden: actorWorkerId })
    .eq("id", id)
    .is("iptal_at", null);
  if (error) return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error.message };
  return { ok: true, veri: { id } };
}

/**
 * KONTROL MADDESİNİ SİLER — doldurulmuş bir formda geçiyorsa silmez.
 *
 * `dvir_yanitlari.madde_id` FK'si `on delete restrict` (081): maddeyi silmek,
 * o maddeye verilmiş "kusurlu" cevabının neye ait olduğunu yok etmek olurdu —
 * yani kanıtın yarısını. Çağıran taraf "kullanimda" cevabında PASİFLEŞTİRMEYİ
 * önerir: madde yeni formlarda sorulmaz, eski formlar okunmaya devam eder.
 */
export async function deleteDvirMadde(id: string): Promise<SilmeSonucu> {
  const { error } = await supabaseAdmin.from("dvir_maddeleri").delete().eq("id", id);
  if (error) {
    return {
      ok: false,
      sebep: tabloYokMu(error) ? "tablo_yok" : kullanimdaMi(error) ? "kullanimda" : "hata",
      mesaj: error.message,
    };
  }
  return { ok: true };
}
