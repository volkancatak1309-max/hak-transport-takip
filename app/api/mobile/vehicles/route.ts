import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { listVehiclesWithStatus } from "@/lib/vehicles";
import { parsePage, pageInfo } from "@/lib/mobile-list";
import { fleetLabeller } from "@/lib/mobile-labels";
import { vehicleSchema } from "@/lib/validation";
import { aracOlustur, type AracYama } from "@/lib/vehicle-update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/vehicles — araç listesi.
 *
 * KAPI: requireMobileAdmin ↔ /admin/araclar sayfasının requireAdmin()'i.
 * Filo şefi panelde bu sayfaya giremiyor; mobilde de 403 alır (bilinçli parite).
 *
 * VERİ: listVehiclesWithStatus() — panelin okuduğu fonksiyonun aynısı; test
 * araçlarının elenmesi de onun içinde (dropTestRows). Burada hiçbir durum ya da
 * sayı yeniden türetilmiyor.
 *
 * Sayfalama bellekte: listVehiclesWithStatus zaten tüm filoyu (≈30 araç) tek
 * seferde okuyor ve canlı durumu açık vardiyalardan türetiyor — sorguyu bölmek
 * durum hesabını bozardı. Filo ölçeği bunu güvenli kılıyor.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const page = parsePage(url);
  const filo = url.searchParams.get("filo");
  const durum = url.searchParams.get("durum");

  const fleetName = await fleetLabeller();
  let all = await listVehiclesWithStatus();
  if (filo) all = all.filter((v) => v.fleet === filo);
  if (durum) all = all.filter((v) => v.live_status === durum);

  const slice = all.slice(page.offset, page.offset + page.limit);

  return Response.json({
    ok: true,
    page: pageInfo(page, all.length),
    araclar: slice.map((v) => ({
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
        /** Cihazlı araç tanımı auto-shift ile aynı: device_id VEYA imei dolu. */
        var: v.flespi_device_id != null || !!v.imei,
      },
      depoLitre: v.tank_capacity_l,
    })),
  });
}

/**
 * ═══ ARAÇ YAZMA SÖZLEŞMESİ — TEK YERDE (19.09.2026) ════════════════════════
 *
 * POST (yeni araç) ve PATCH (`[id]/route.ts`) AYNI çeviriyi ve AYNI sınırları
 * kullanır. Bölge uçlarındaki (`bolgeAlanlariniDogrula`) desenin aynısı ve aynı
 * gerekçeyle: oluştururken kabul edilen bir depo hacmi düzenlerken
 * reddedilirse, kullanıcı hangi ekranın doğru olduğunu bilemez.
 *
 * ── SINIRLAR KOPYALANMADI ─────────────────────────────────────────────────
 * Doğrulama `vehicleSchema.partial()` ile yapılıyor — panelin formunun geçtiği
 * ŞEMANIN TA KENDİSİ (lib/validation.ts). Yıl aralığı, IMEI biçimi, 1.500 L
 * depo tavanı, tarih deseni ve yakıt türü kümesi tek yerde duruyor. İkinci bir
 * sınır listesi yazılsaydı `errTank` panelde 1.500'de, mobilde başka bir sayıda
 * patlardı.
 *
 * ── BEYAZ LİSTE, KARA LİSTE DEĞİL ─────────────────────────────────────────
 * Gövdede tanınmayan bir anahtar varsa istek REDDEDİLİR; alan sessizce
 * yutulmaz. Listede olmayan bir kolon (ör. `is_test`, `vin`, `flespi_device_id`)
 * bu uçtan YAZILAMAZ — yenisi eklendiğinde de varsayılan KAPALI gelir.
 *
 * ⚠️ `is_test` ÖZELLİKLE DIŞARIDA: test bayrağı, verinin raporlardan elenmesini
 * belirleyen anahtar. Telefondan yazılabilseydi gerçek bir aracı tek dokunuşla
 * bütün ölçümlerden düşürmek mümkün olurdu.
 *
 * ── `aktif` NEDİR ─────────────────────────────────────────────────────────
 * Araçta `is_active` diye bir kolon YOK; durum üç değerli (`status`). `aktif`
 * bu üçlünün kısayolu: true → "active", false → "inactive". Silme ucu bilerek
 * açılmadı (araç satırı vardiya/olay/yakıt kayıtlarının bağlandığı yer);
 * pasife alma aynı işi GERİ ALINABİLİR biçimde yapıyor. `maintenance` için
 * `durum` alanı kullanılır — `aktif` onu ifade edemez ve etmeye çalışmamalı.
 */
export const ARAC_ALAN_HARITASI: Record<string, keyof AracYama> = {
  plaka: "plate",
  marka: "make",
  model: "model",
  yil: "year",
  durum: "status",
  soforId: "assigned_worker_id",
  muayeneSon: "inspection_due",
  sigortaSon: "insurance_due",
  depoLitre: "tank_capacity_l",
  yakitTuru: "fuel_type",
  notlar: "notes",
};

/** `aktif` bir kolon değil, `status`un kısayolu — haritada yeri yok. */
export const ARAC_IZINLI_ANAHTARLAR = [...Object.keys(ARAC_ALAN_HARITASI), "aktif"];

export type AracAlanHatasi = { alan: string; sebep: string };

export function aracAlanlariniDogrula(
  g: Record<string, unknown>,
  zorunlu: boolean
):
  | { ok: true; deger: AracYama }
  | { ok: false; hata: AracAlanHatasi; izinli?: string[] } {
  const izinsiz = Object.keys(g).filter((k) => !ARAC_IZINLI_ANAHTARLAR.includes(k));
  if (izinsiz.length > 0) {
    return {
      ok: false,
      hata: { alan: izinsiz.join(","), sebep: "izinsiz" },
      izinli: ARAC_IZINLI_ANAHTARLAR,
    };
  }

  const ham: Record<string, unknown> = {};
  for (const [mobil, kolon] of Object.entries(ARAC_ALAN_HARITASI)) {
    if (g[mobil] !== undefined) ham[kolon] = g[mobil];
  }

  // `aktif` → `status`. İkisi birlikte gelip ÇELİŞİRSE reddedilir: hangisinin
  // kazandığını sessizce seçmek, istemcinin yazdığını sandığı değerden başkasını
  // yazmaktır.
  if (g.aktif !== undefined) {
    if (typeof g.aktif !== "boolean") {
      return { ok: false, hata: { alan: "aktif", sebep: "boolean_degil" } };
    }
    const durumdan = g.aktif ? "active" : "inactive";
    if (ham.status !== undefined && ham.status !== durumdan) {
      return { ok: false, hata: { alan: "aktif|durum", sebep: "celisiyor" } };
    }
    ham.status = durumdan;
  }

  if (zorunlu) {
    for (const [alan, kolon] of [
      ["plaka", "plate"],
      ["marka", "make"],
      ["model", "model"],
    ] as const) {
      const v = ham[kolon];
      if (typeof v !== "string" || !v.trim()) {
        return { ok: false, hata: { alan, sebep: "zorunlu" } };
      }
    }
  }

  const parsed = vehicleSchema.partial().safeParse(ham);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return {
      ok: false,
      hata: {
        alan: String(i?.path?.[0] ?? "?"),
        sebep: i?.message ?? "validation",
      },
    };
  }
  // `partial()` verilmeyen alanı çıktıya koymaz; `undefined` olanları da atıyoruz
  // ki çekirdekteki "alan YOK = dokunma" sözü bozulmasın.
  const deger = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  ) as AracYama;
  return { ok: true, deger };
}

/**
 * POST /api/mobile/vehicles — YENİ ARAÇ.
 *
 * ── KAPI ──────────────────────────────────────────────────────────────────
 * requireMobileAdmin ↔ /admin/araclar `requireAdmin()`. Şef ve şoför 403.
 *
 * ── ZORUNLU ALANLAR ───────────────────────────────────────────────────────
 * `plaka` + `marka` + `model`. Plaka tekil ve zaten zorunlu; marka/model
 * bilerek zorunlu tutuldu: plakadan ibaret bir araç kaydı listede, raporda ve
 * bakım ekranında ayırt edilemez ve sonradan kimse doldurmaz.
 *
 * ── VERİLMEYENLER ─────────────────────────────────────────────────────────
 * `filo` gövdede YOK → kolon varsayılanına düşer ('mavi'). Filo ayrımı görsel
 * ve raporsal bir karar; telefondan ilk kayıtta seçtirmek yerine panelde
 * düzeltmek daha az hatalı. Cihaz kimlikleri (`imei`, `flespi_device_id`) de
 * bu uçtan YAZILMAZ: cihaz eşleme akışı ayrı ve tekillik çakışmalarını orada
 * çözmek gerekir.
 *
 * ── HATA KODLARI ──────────────────────────────────────────────────────────
 *   401 missing_token / invalid_token …     403 admin_required
 *   400 invalid_body · invalid_field (alan + sebep; izinsiz alanda `izinli`)
 *   409 plate_taken (çakışan aracın PLAKASI `conflict` alanında)
 *   500 write_failed
 */
export async function POST(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  let govde: Record<string, unknown> | null = null;
  try {
    const j = await req.json();
    govde = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    govde = null;
  }
  if (!govde) return mobileError(400, "invalid_body", { bicim: "json_nesne" });

  const d = aracAlanlariniDogrula(govde, true);
  if (!d.ok) {
    return mobileError(400, "invalid_field", { ...d.hata, ...(d.izinli ? { izinli: d.izinli } : {}) });
  }

  const r = await aracOlustur({
    actorId: guard.actor.worker.id,
    alanlar: { ...d.deger, plate: d.deger.plate as string },
  });
  if (!r.ok) {
    if (r.error.endsWith("_taken")) {
      return mobileError(409, r.error, { conflict: r.conflict });
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

  return Response.json({ ok: true, id: r.id, yazilan: r.degisen, panelTazelendi }, { status: 201 });
}
