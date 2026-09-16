import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { createDvirForm, type YanitGirdi } from "@/lib/dvir-db";
import { coklaYukleVeYaz, type YuklemeHatasi } from "@/lib/upload-core";

/**
 * DVIR FORM GÖNDERİMİ — panel ve mobil TEK yerden yazar.
 *
 * `lib/shift-start.ts` / `lib/shift-correct.ts` ile aynı desen: karar ve yazma
 * burada, kimlik doğrulama çağıranda.
 *
 * ── NEDEN ÇEKİRDEK ────────────────────────────────────────────────────────
 * Form gönderimi göründüğünden fazlasını yapıyor: kusurlu maddede fotoğraf +
 * not ZORUNLU, odometre TELEMETRİDEN okunur (formda km alanı yok — beyanda en
 * kolay çarpıtılacak alanı kullanıcıya bırakmamak için), her kusur bir iş
 * emri açar, ve N fotoğraf TEK kayıtla birlikte yazılır. İkinci bir kopya ilk
 * değişiklikte geride kalırdı.
 *
 * ── 🔑 FOTOĞRAF YALNIZ BURADA KONABİLİR ───────────────────────────────────
 * `dvir_yanitlari` KOŞULSUZ değişmez (081 `trg_dvir_yanit_degismez`): satır
 * yazıldıktan sonra hiçbir update kabul edilmiyor. Yani "fotoğrafı sonradan
 * ekle" diye bir yol YOK ve olamaz — fotoğraf formla birlikte, bu fonksiyonun
 * içinde yazılır. Düzeltmenin yolu YENİ FORM doldurmaktır.
 *
 * Bu, `coklaYukleVeYaz`ı zorunlu kılıyor: N dosya yüklenip TEK kayıt yazılacak
 * ve kayıt düşerse N dosyanın HEPSİ geri alınacak.
 */

export type DvirGonderimSonuc =
  | { ok: true; formId: string; kusur: number; isEmri: number }
  | {
      ok: false;
      sebep:
        | "arac_senin_degil"
        | "madde_yok"
        | "kanit_yok"
        | "tablo_yok"
        | "hata"
        | YuklemeHatasi;
      /** kanit_yok: hangi madde · yükleme hatası: ayrıntı */
      mesaj?: string;
      retryAfter?: number;
    };

export type DvirGonderimGirdi = {
  vehicleId: string;
  tur: "once" | "sonra";
  seferId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  dogrulukM?: number | null;
  yanitlar: YanitGirdi[];
  /** Kusurlu madde kimliği → fotoğraf. Anahtar `YanitGirdi.maddeId`. */
  fotograflar: Map<string, File>;
};

/** DVIR kusur fotoğraflarının kovası — panel ve mobil aynı. */
export const DVIR_KOVA = "dvir-fotolari";

/**
 * Şoförün form doldurabileceği araç mı? Kapı ÇAĞIRANIN kimliğiyle değil,
 * HEDEF aracın kişiye bağlılığıyla ilgili; bu yüzden çekirdekte.
 */
async function aracSoforun(workerId: string, vehicleId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select("id")
    .eq("id", vehicleId)
    .eq("assigned_worker_id", workerId)
    .maybeSingle();
  if (data) return true;
  // Atanmış değilse: bugün o araçla AÇIK vardiyası var mı (geçici araç).
  const { data: v } = await supabaseAdmin
    .from("time_entries")
    .select("id")
    .eq("worker_id", workerId)
    .eq("vehicle_id", vehicleId)
    .is("ended_at", null)
    .maybeSingle();
  return !!v;
}

export async function dvirFormuGonder(
  workerId: string,
  g: DvirGonderimGirdi
): Promise<DvirGonderimSonuc> {
  if (g.yanitlar.length === 0) return { ok: false, sebep: "madde_yok" };
  if (!(await aracSoforun(workerId, g.vehicleId))) {
    return { ok: false, sebep: "arac_senin_degil" };
  }

  // Kusurlu maddede fotoğraf ZORUNLU — yüklemeye başlamadan önce denetlenir ki
  // eksik bir formda hiç dosya yüklenmesin.
  const kusurlular = g.yanitlar.filter((y) => y.durum === "kusurlu");
  const dosyalar: { anahtar: string; file: File }[] = [];
  for (const y of kusurlular) {
    const f = g.fotograflar.get(y.maddeId);
    if (!f || f.size === 0) return { ok: false, sebep: "kanit_yok", mesaj: y.maddeId };
    dosyalar.push({ anahtar: y.maddeId, file: f });
  }

  // ODOMETRE: aracın son telemetri okuması (72 saatten taze). Formda km alanı
  // YOK — beyanda en kolay çarpıtılacak alanı kullanıcıya bırakmamak için.
  const { data: odo } = await supabaseAdmin
    .from("device_telemetry")
    .select("odometer_km")
    .eq("vehicle_id", g.vehicleId)
    .not("odometer_km", "is", null)
    .gte("recorded_at", new Date(Date.now() - 72 * 3600_000).toISOString())
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let yazmaHatasi: DvirGonderimSonuc | null = null;
  const c = await coklaYukleVeYaz(DVIR_KOVA, workerId, dosyalar, async (yollar) => {
    for (const y of kusurlular) y.fotoYolu = yollar.get(y.maddeId) ?? null;
    const r = await createDvirForm({
      vehicleId: g.vehicleId,
      workerId,
      seferId: g.seferId ?? null,
      tur: g.tur,
      odometreKm: odo ? Number((odo as { odometer_km: number }).odometer_km) : null,
      latitude: g.latitude ?? null,
      longitude: g.longitude ?? null,
      dogrulukM: g.dogrulukM ?? null,
      yanitlar: g.yanitlar,
    });
    if (!r.ok) {
      yazmaHatasi = {
        ok: false,
        sebep: r.sebep === "cakisma" ? "hata" : r.sebep,
        mesaj: r.mesaj,
      };
      return null;
    }
    return r.veri;
  });

  if (!c.ok) {
    if (yazmaHatasi) return yazmaHatasi;
    /**
     * Yükleme adımı düştü; dosyalar TEMİZLENDİ (coklaYukleVeYaz garantisi).
     *
     * `yazma_hatasi` buraya DÜŞEMEZ — o dal `yazmaHatasi` doluyken yukarıda
     * dönüyor. Yine de tip düzeyinde eleniyor: çekirdek bir gün `yaz`
     * dışında bir sebeple "yazma_hatasi" üretirse sessizce genel bir "hata"ya
     * çevrilsin, `sebep` alanına sızıp istemciyi şaşırtmasın.
     */
    const sebep = c.hata === "yazma_hatasi" ? "hata" : c.hata;
    return { ok: false, sebep, mesaj: c.ayrinti, retryAfter: c.retryAfter };
  }
  return { ok: true, ...c.kayit };
}
