import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { getVehicleDetail } from "@/lib/vehicles";
import { aracGuncelle } from "@/lib/vehicle-update";
import { aracAlanlariniDogrula, ARAC_IZINLI_ANAHTARLAR } from "../route";
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
      /**
       * YAZILABİLEN ALAN OKUNABİLİR OLMAK ZORUNDA (19.09.2026).
       *
       * `PATCH` bu ikisini değiştirebiliyor; gövdede dönmezlerse düzenleme
       * ekranı mevcut değeri göremeden üzerine yazardı. `yakitTuru` CO₂
       * katsayısını seçen alan (089); kolon eklenmemiş bir kurulumda
       * `select("*")` onu hiç getirmez ve burada null'a düşer — istemci tek
       * şey okur.
       */
      yakitTuru: (v as { fuel_type?: string | null }).fuel_type ?? null,
      /**
       * `durum`un boolean kısayolu — PATCH `{aktif:false}` ile pasife alma
       * tam olarak bunu yazar. `maintenance` de aktif DEĞİLDİR: araç
       * kullanımda olmadığı için false döner ve ekran gerçek durumu `durum`
       * alanından gösterir.
       */
      aktif: v.status === "active",
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

/**
 * PATCH /api/mobile/vehicles/[id] — ARAÇ KAYDINI DÜZENLE (yönetici).
 *
 * ═══ KISMİ — GÖVDEDE OLMAYAN ALAN DEĞİŞMEZ ════════════════════════════════
 *
 * Panelin formu her alanı gönderdiği için `updateVehicle` bütün kolonları
 * birden yazıyor ve boş bırakılanı `null`a çekiyor. Bu bir FORM davranışı, bir
 * VERİ kuralı değil — ve PATCH'te aynısı felaket olurdu: telefondan yalnız
 * muayene tarihini düzelten bir yönetici, aracın IMEI'sini, depo hacmini ve
 * şoför atamasını da silerdi.
 *
 * Kural: alan YOK → dokunulmaz. Alan `null` → o kolon GERÇEKTEN boşaltılır
 * (ör. `{soforId: null}` atamayı kaldırır). İkisi ayrı şeydir.
 *
 * ═══ KURALLAR PANELDEN, KOPYALANMADI ══════════════════════════════════════
 *
 * Yazma `lib/vehicle-update.ts` çekirdeğinden geçiyor; panelin `updateVehicle`ı
 * da 19.09.2026'dan beri AYNI çekirdeği çağırıyor. Böylece:
 *   · plaka BÜYÜK harfe çevrilir,
 *   · plaka tekil — çakışırsa 409 ve ÇAKIŞAN ARACIN PLAKASI söylenir,
 *   · araca yönetici/test hesabı şoför olarak atanamaz,
 *   · bir şoför tek araca atanır (eski aracı serbest bırakılır) ve
 *     `workers.plate` aynası hizalanır,
 *   · denetim izi (`auditChange`) eski hâlle birlikte düşer.
 *
 * ═══ NE YAZILAMAZ ═════════════════════════════════════════════════════════
 * Beyaz liste dışındaki her anahtar 400 `invalid_field` + `sebep:"izinsiz"`.
 * Bu uçtan YAZILAMAYANLAR ve sebepleri:
 *   `is_test`  → verinin raporlardan elenmesini belirleyen anahtar; tek
 *                dokunuşla gerçek bir aracı bütün ölçümlerden düşürürdü.
 *   `imei` · `flespi_device_id` · `vin` → cihaz eşleme akışı ayrı; tekillik
 *                çakışması orada çözülür.
 *   `filo`     → görsel/raporsal ayrım, panelde seçilir.
 *
 * ═══ DEĞİŞİKLİĞİN ETKİSİ ANINDA ═══════════════════════════════════════════
 * `muayeneSon`/`sigortaSon` Dikkat panosunun ±30 günlük penceresini besliyor
 * (lib/admin-dashboard.ts); `depoLitre` yakıt kapısının üç şartından biri
 * (lib/fuel-vehicle.ts) — hacim silinirse o aracın litre/€/L100 değerleri
 * `depo_yok` sebebiyle "—" olur. İkisi de TÜRETİLMİŞ: ayrıca bir yeniden
 * hesaplama tetiklemek gerekmiyor, bir sonraki okuma yeni sayıyı verir.
 *
 * ═══ HATA KODLARI ═════════════════════════════════════════════════════════
 *   401 missing_token / invalid_token / revoked / inactive
 *   403 admin_required
 *   400 invalid_body · invalid_field (alan + sebep; izinsiz alanda `izinli`)
 *       · empty_patch (gövde tanınan hiçbir alan taşımıyor)
 *   404 not_found
 *   409 plate_taken (`conflict` = çakışan aracın plakası)
 *   500 write_failed
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let govde: Record<string, unknown> | null = null;
  try {
    const j = await req.json();
    govde = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    govde = null;
  }
  if (!govde) return mobileError(400, "invalid_body", { bicim: "json_nesne" });

  const d = aracAlanlariniDogrula(govde, false);
  if (!d.ok) {
    return mobileError(400, "invalid_field", { ...d.hata, ...(d.izinli ? { izinli: d.izinli } : {}) });
  }
  if (Object.keys(d.deger).length === 0) {
    return mobileError(400, "empty_patch", { alanlar: ARAC_IZINLI_ANAHTARLAR });
  }

  const r = await aracGuncelle({ actorId: guard.actor.worker.id, id, yama: d.deger });
  if (!r.ok) {
    if (r.error === "not_found") return mobileError(404, "not_found");
    if (r.error.endsWith("_taken")) return mobileError(409, r.error, { conflict: r.conflict });
    if (r.error.startsWith("Yönetici hesabı")) {
      return mobileError(400, "invalid_field", { alan: "soforId", sebep: "sofor_degil" });
    }
    return mobileError(500, "write_failed", { detail: r.error });
  }

  let panelTazelendi = true;
  try {
    revalidatePath("/admin/araclar");
    revalidatePath("/admin/workers");
    revalidatePath("/panel");
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    id: r.id,
    /** Hangi kolonlar GERÇEKTEN değişti — boş dizi "aynı değer gönderildi". */
    degisen: r.degisen,
    panelTazelendi,
  });
}
