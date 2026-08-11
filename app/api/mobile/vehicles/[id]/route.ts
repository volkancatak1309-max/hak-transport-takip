import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { getVehicleDetail } from "@/lib/vehicles";
import { listVehicleFaultReports } from "@/lib/fault-reports-db";
import { mobileError } from "@/lib/mobile-auth";
import { fleetLabeller } from "@/lib/mobile-labels";
import { lookupDtc } from "@/lib/dtc-codes";
import { DEFAULT_LOCALE } from "@/i18n/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/vehicles/[id] — araç detayı.
 *
 * KAPI: requireMobileAdmin ↔ /admin/araclar/[id] sayfasının requireAdmin()'i.
 * VERİ: getVehicleDetail(id) — detay sayfasının okuduğu fonksiyonun aynısı.
 * Bugünün km / paket / vardiya özeti ve ceza listesi oradan olduğu gibi gelir.
 *
 * ── ARIZALAR (10.08.2026) ─────────────────────────────────────────────────
 * `arizalar[]` mobilde arıza verisinin ilk kez araç ekseninde göründüğü yer;
 * bugüne dek arıza YALNIZ panoda (dashboard `dtc[]`) yaşıyordu, oysa Dikkat
 * listesindeki "N aktif arıza" satırı bu ekrana gidiyor.
 *
 * Satırlar getVehicleDetail'in `faults`'undan gelir — panel rozetiyle aynı
 * kaynak, `kmSurulen` dahil. Sözlük metni BURADA iliştirilir: `lib/dtc-codes.ts`
 * `server-only` ve 335 kodluk sözlük istemci paketine girmemeli (panel sayfası
 * da tam olarak bunu yapıyor). Sözlükte olmayan kodda `aciklama: null` —
 * uydurma tanım YOK; `detay` de null olur.
 *
 * DİL: `hak_locale` çerezi mobilde yok → kurulumun varsayılan dili
 * (lib/mobile-labels.ts ile aynı gerekçe).
 *
 * TAVAN YOK: araç başına aktif kod sayısı tek haneli (panoda 10'luk tavan tüm
 * filoyu tek yanıta sığdırmak içindi, burada öyle bir baskı yok). Kırpma
 * olmadığı için `kodKirpildi` deseni de gerekmiyor.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const d = await getVehicleDetail(id);
  if (!d) return mobileError(404, "not_found");

  const v = d.vehicle;
  const [fleetName, bildirimler] = await Promise.all([
    fleetLabeller(),
    listVehicleFaultReports(id),
  ]);
  return Response.json({
    ok: true,
    arac: {
      id: v.id,
      plaka: v.plate,
      marka: v.make,
      model: v.model,
      yil: v.year,
      filo: v.fleet,
      filoEtiketi: fleetName(v.fleet),
      durum: v.status,
      canliDurum: v.live_status,
      sofor: v.driver_name,
      soforId: v.driver_id,
      soforCanli: v.driver_is_live,
      canliSoforler: v.live_drivers,
      muayeneSon: v.inspection_due,
      sigortaSon: v.insurance_due,
      cihaz: {
        flespiId: v.flespi_device_id,
        imei: v.imei,
        vin: v.vin,
        /**
         * Takip cihazının ADI, ör. "Teltonika FMC003" (migration 055).
         *
         * KOLON OLMAYABİLİR: `getVehicleDetail` `select("*")` yaptığı için
         * kolon eklenince alan kendiliğinden dolar, eklenmemiş kurulumda
         * `undefined` gelir ve BURADA null'a çevrilir — istemci tek şey okur.
         * Cihaz modeli bugün depoda hiçbir yerde VERİ olarak durmuyor
         * ("FMC003" yalnız kod yorumlarında geçiyor); uydurulmuyor, elle
         * girilene kadar null kalıyor.
         */
        ad: (v as { device_model?: string | null }).device_model ?? null,
        var: v.flespi_device_id != null || !!v.imei,
      },
      depoLitre: v.tank_capacity_l,
      notlar: v.notes,
    },
    bugun: {
      km: d.today.km,
      baslangicKm: d.today.startKm,
      bitisKm: d.today.endKm,
      ilkBaslangic: d.today.firstStart,
      sonBitis: d.today.lastEnd,
      paketAlinan: d.today.startPackages,
      paketTeslim: d.today.endPackages,
    },
    sonVardiyalar: d.recent.map((r) => ({
      id: r.id,
      tarih: r.date,
      sofor: r.driver_name,
      baslangicKm: r.start_km,
      bitisKm: r.end_km,
      km: r.km,
      kapandi: r.ended,
    })),
    cezalar: d.penalties,
    /**
     * ELLE BİLDİRİLEN arızalar (migration 056) — `arizalar[]`ın YANINDA, içinde
     * DEĞİL. `arizalar[]` cihazın okuduğu DTC kodlarıdır (P0100 …) ve flespi
     * akışıyla kendi kendini uzlaştırır; bunlar insanın yazdığı serbest metin.
     * Aynı diziye karıştırmak iki farklı güven düzeyini tek listeye koymak olurdu.
     *
     * `arizaBildirimDurumu` boş listenin SEBEBİNİ söyler: `var` (gerçekten yok)
     * · `tablo_yok` (056 bu kurulumda uygulanmamış) · `hata`. Üçü yöneticiye
     * farklı iş yaptırır. `kirpildi`/`toplam` da tavanı sessiz bırakmaz.
     */
    arizaBildirimleri: bildirimler.satirlar,
    arizaBildirimDurumu: bildirimler.durum,
    arizaBildirimToplam: bildirimler.toplam,
    arizaBildirimKirpildi: bildirimler.kirpildi,
    /** migration 057 uygulanmış mı — false ise satırların kapatma izi hep null. */
    arizaBildirimKapatmaIzi: bildirimler.kapatmaIzi,
    arizalar: d.faults.map((f) => {
      const info = lookupDtc(f.code, DEFAULT_LOCALE);
      return {
        id: f.id,
        kod: f.code,
        standart: f.standard,
        aciklama: info ? info.title : null,
        ilkGorulme: f.first_seen,
        sonGorulme: f.last_seen,
        kmSurulen: f.km_driven,
        detay: info
          ? { parca: info.part, belirtiler: info.symptoms, risk: info.risk }
          : null,
      };
    }),
  });
}
