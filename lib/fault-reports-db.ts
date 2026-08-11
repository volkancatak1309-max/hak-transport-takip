import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu, type ArizaDurum } from "@/lib/fault-reports";

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
  const { data, error, count } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("id, reported_by, aciklama, durum, created_at", { count: "exact" })
    .eq("vehicle_id", vehicleId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false }) // eş anlı kayıtlarda deterministik sıra
    .limit(ARIZA_LISTE_TAVANI);

  if (error) {
    return {
      satirlar: [],
      durum: tabloYokMu(error) ? "tablo_yok" : "hata",
      toplam: null,
      kirpildi: false,
    };
  }

  const rows = (data ?? []) as {
    id: string;
    reported_by: string | null;
    aciklama: string;
    durum: string;
    created_at: string;
  }[];

  const ids = [...new Set(rows.map((r) => r.reported_by).filter((x): x is string => !!x))];
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
    })),
    durum: "var",
    toplam,
    kirpildi: toplam > rows.length,
  };
}

export type ArizaDurumYazma =
  | { ok: true; satir: { id: string; vehicle_id: string; aciklama: string; durum: string; created_at: string }; degisti: boolean }
  | { ok: false; sebep: "yok" | "tablo_yok" | "hata" };

/**
 * Bir bildirimin durumunu değiştirir (kapat / yeniden aç).
 *
 * ── ÖNCE OKU, SONRA YAZ ────────────────────────────────────────────────────
 * `degisti` bayrağı için önceki durum gerekiyor: aynı durumu ikinci kez
 * göndermek HATA DEĞİLDİR (iki telefonun aynı düğmeye basması olağan), ama
 * ekranın "kapatıldı" bildirimi göstermesi de yanlış olur. İstek başarılı,
 * `degisti:false`.
 *
 * Kayıt yoksa `yok` döner — uç 404 basar. `durum` alanı ŞEMA CHECK'iyle de
 * korunuyor; buraya geçersiz bir değer gelirse (uç ayıklaması atlanırsa) yazma
 * 23514 ile düşer ve `hata` olur, sessizce geçmez.
 */
export async function setFaultReportStatus(
  id: string,
  durum: ArizaDurum
): Promise<ArizaDurumYazma> {
  const { data: onceki, error: okumaHatasi } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select("durum")
    .eq("id", id)
    .maybeSingle();
  if (okumaHatasi) {
    return { ok: false, sebep: tabloYokMu(okumaHatasi) ? "tablo_yok" : "hata" };
  }
  if (!onceki) return { ok: false, sebep: "yok" };

  const { data, error } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .update({ durum })
    .eq("id", id)
    .select("id, vehicle_id, aciklama, durum, created_at")
    .maybeSingle();
  if (error) return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata" };
  if (!data) return { ok: false, sebep: "yok" };

  return {
    ok: true,
    satir: data as { id: string; vehicle_id: string; aciklama: string; durum: string; created_at: string },
    degisti: (onceki as { durum: string }).durum !== durum,
  };
}
