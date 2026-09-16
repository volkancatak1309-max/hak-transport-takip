import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/secure-compare";
import { supabaseAdmin } from "@/lib/supabase";
import { TENANT_TZ } from "@/lib/tz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Backfill'de tek çağrı çok gün kapsayabiliyor. Kardeş cron'ların hepsi 300
 * bildiriyor (aylik-metrik, skor-donem, haftalik-aksiyon, mevzuat-tarama).
 */
export const maxDuration = 300;

/**
 * YAKIT SERİSİ ETİKETİ — gece cron'u. `fuel_seri` (migration 101).
 *
 * ═══ 🔴 NE YAZAR, NE YAZMAZ ════════════════════════════════════════════════
 *
 * YAZAR : `fuel_seri` — okuma başına `bwd_max`/`fwd_max` (±30 komşudaki en
 *         yüksek yakıt seviyesi). Yazma **upsert**, `(vehicle_id, recorded_at)`.
 * YAZMAZ: `device_telemetry`ye, yakıt raporuna, hiçbir ekrana DOKUNMAZ.
 *         Hiçbir şey SİLMEZ. Bu uç kapalı kalsa bile yakıt raporu doğru
 *         çalışır — yalnız yavaş çalışır (bkz. lib/tenant.ts
 *         `YAKIT_OZET_ENABLED` başlığındaki üç geri düşüş katmanı).
 *
 * ═══ NEDEN VAR — ÖLÇÜLDÜ (16.09.2026) ══════════════════════════════════════
 *
 * `report_fuel_stats_vehicle` araç başına çağrılıyor ve aralıktaki bütün
 * yakıt okumalarını 31 satırlık iki kayan maksimumdan geçiriyor:
 *
 *     29 araç × 30 gün, mapBounded(6):  HAK61 4,3 sn · demo 7,7 sn
 *     soğuk ≈ sıcak (7.725 vs 7.567 ms) → disk değil CPU; indeks çözmez
 *
 * Bu iki sayı satırın KENDİ komşuluğundan gelir, sorulan pencereden değil.
 * Yani bir kez hesaplanıp saklanabilir. Bu cron onu yapar.
 *
 * ═══ 🔴 NEDEN GÜNLÜK ÖZET DEĞİL — 090'IN ÖLÇÜMÜ ════════════════════════════
 *
 * 090 (26.08.2026) günlük yakıt ÖZETİNİ ölçtü ve REDDETTİ: 28 günlük gerçek
 * 2.602,6 L, günlük parçaların toplamı 3.009,9 L = **+%15,6**. Bu cron günlük
 * özet YAZMIYOR; satır başına, zamandan bağımsız bir ara değer yazıyor.
 * Etiketleme işi gün gün koşar ama okuma gün gün TOPLANMAZ — pencere
 * fonksiyonları okuma anında bütün aralık üzerinde çalışmaya devam eder.
 * PGlite'ta ölçüldü (`verify:yakit-seri-etiket`): aynı veride günlük
 * parçalama %7,7 sapma üretiyor, bu yol %0,000000.
 *
 * ═══ GÜN SINIRI KIRPILMIYOR ════════════════════════════════════════════════
 *
 * `yakit_seri_etiketle` aralığın iki yanından araç başına TAM 30 SATIR
 * genişleyerek okur, yazmayı yine yalnız aralık içine yapar. Bu yüzden gün
 * gün çağrılması, aralığı gün gün parçalamakla AYNI ŞEY DEĞİLDİR.
 *
 * ═══ NEDEN "DÜN + BUGÜNÜN KAPANMIŞ KISMI" ══════════════════════════════════
 *
 * Serinin en yeni 30 satırının ileri penceresi henüz dolmamıştır; o satırlar
 * geçici değer taşır. İki koruma var ve İKİSİ DE gerekli:
 *   · bu cron her koşuda DÜNÜ de yeniden yazar (upsert) — geç gelen telemetri
 *     (flespi kesinti sonrası geriye yazabiliyor, 28.08'de 11.455 satır) ve
 *     geçici uç değerler böyle düzelir;
 *   · okuma yolu (v2) son 30 etiketli satırı zaten CANLI yeniden hesaplar.
 *
 * ═══ KULLANIM ══════════════════════════════════════════════════════════════
 *
 *   GET /api/cron/yakit-etiket
 *   Authorization: Bearer <CRON_SECRET>          ← kayıt BÖYLE kurulur
 *
 *   &gun=YYYY-MM-DD   → yalnız o takvim gününü etiketle (parçalı backfill)
 *   &gun=A..B         → A'dan B'ye (dâhil) her günü ayrı ayrı
 *   &arac=<uuid>      → yalnız o araç
 *   &kuru=1           → HİÇBİR ŞEY YAZMAZ, ne yapacağını söyler
 *
 * Varsayılan (parametresiz): DÜN 00:00'dan ŞİMDİ'ye kadar — yani dün + bugünün
 * kapanmış kısmı. Sıklık: **günde 1 · 03:15 Europe/Vienna** (03:00 saklama ile
 * 03:30 aylık-metrik arasına, ikisiyle aynı dakikaya binmesin).
 *
 * ⚠️ İDEMPOTENT: aynı günü ikinci kez çağırmak aynı satırları aynı değerlerle
 * yeniden yazar (PGlite'ta ölçüldü). Tekrar çalıştırmak güvenlidir; backfill
 * yarıda kalırsa kaldığı yerden değil, baştan da koşturulabilir.
 *
 * ⚠️ BACKFILL PARÇALI KOŞULUR. Ölçüm: HAK61'de 78 günlük veri × 30 araç;
 * araç-gün birimi ~156 ms ve bu uç günleri SIRAYLA işler. Tek çağrıda 78 gün
 * `maxDuration`ı aşar — `?gun=A..B` ile 10'ar günlük dilimler hâlinde koşun.
 */

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  // ⚠️ Sorgu dizesi biçimi elle teşhis için DURUYOR ama kayıt kurarken
  // kullanılmaz: sorgu dizesi erişim kayıtlarına düz metin düşer
  // (docs/CRON-KAYITLARI.md'deki kuralın aynısı).
  const qs = req.nextUrl.searchParams.get("secret");
  if (safeEqual(qs, expected)) return true;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return safeEqual(auth.slice(7), expected);
  return false;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Kiracının takvim gününün [başlangıç, bitiş] anları.
 *
 * ⚠️ GÜN KİRACININ SAAT DİLİMİNDE (TENANT_TZ). UTC günü kullanılsaydı Viyana
 * saatiyle 00:00–02:00 arası okumalar bir önceki güne yazılır, "dünü yeniden
 * yaz" kuralı o dilimi hiç kapsamazdı. Sınır yine de kritik DEĞİL — etiket
 * değeri satırın komşuluğundan gelir, hangi gün paketinde yazıldığından
 * bağımsızdır; bu yalnız işin bölünme biçimi.
 */
function gunAraligi(ymd: string): { bas: string; bit: string } | null {
  const t = Date.parse(`${ymd}T12:00:00Z`);
  if (Number.isNaN(t)) return null;
  const ogle = new Date(t);
  const bicim = new Intl.DateTimeFormat("en-CA", {
    timeZone: TENANT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // Öğlen UTC'nin kiracı takviminde hangi güne düştüğü — DST'de bile aynı gün.
  const yerel = bicim.format(ogle);
  // Kiracı gününün UTC karşılığını iki denemeyle bul (DST kayması ±1 saat).
  for (const kayma of [0, -1, 1, -2, 2, -3, 3]) {
    const bas = new Date(t - 12 * 3600_000 + kayma * 3600_000);
    if (bicim.format(bas) === yerel && bicim.format(new Date(bas.getTime() - 1)) !== yerel) {
      const bit = new Date(bas.getTime() + 24 * 3600_000 - 1);
      return { bas: bas.toISOString(), bit: bit.toISOString() };
    }
  }
  return null;
}

type GunSonucu = { gun: string; yazilan: number | null; hata?: string };

async function etiketle(bas: string, bit: string, arac: string | null): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("yakit_seri_etiketle", {
    p_from: bas,
    p_to: bit,
    p_vehicle_id: arac,
  });
  if (error) throw new Error(`${error.code ?? ""} ${error.message}`.trim());
  return Number(data ?? 0);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const kuru = sp.get("kuru") === "1";
  const arac = sp.get("arac");
  if (arac !== null && !/^[0-9a-f-]{36}$/i.test(arac)) {
    return NextResponse.json(
      { ok: false, error: "invalid_arac", hint: "uuid bekleniyor" },
      { status: 400 }
    );
  }

  const gunParam = sp.get("gun");

  // ── Aralık çözümü ────────────────────────────────────────────────────────
  const gunler: string[] = [];
  let varsayilan: { bas: string; bit: string } | null = null;

  if (gunParam) {
    const [a, b] = gunParam.includes("..") ? gunParam.split("..") : [gunParam, gunParam];
    if (!YMD.test(a) || !YMD.test(b)) {
      return NextResponse.json(
        { ok: false, error: "invalid_gun", hint: "YYYY-MM-DD ya da YYYY-MM-DD..YYYY-MM-DD" },
        { status: 400 }
      );
    }
    const ilk = Date.parse(`${a}T12:00:00Z`);
    const son = Date.parse(`${b}T12:00:00Z`);
    if (Number.isNaN(ilk) || Number.isNaN(son) || son < ilk) {
      return NextResponse.json({ ok: false, error: "invalid_gun", hint: "sıra" }, { status: 400 });
    }
    // Tavan: tek çağrı maxDuration'ı aşmasın (ölçüm: araç-gün ~156 ms).
    const adet = Math.round((son - ilk) / 86_400_000) + 1;
    if (adet > 31) {
      return NextResponse.json(
        {
          ok: false,
          error: "aralik_cok_genis",
          gun: adet,
          hint: "en fazla 31 gün — backfill'i 10'ar günlük dilimlerle koşun",
        },
        { status: 400 }
      );
    }
    for (let i = 0; i < adet; i++) {
      gunler.push(new Date(ilk + i * 86_400_000).toISOString().slice(0, 10));
    }
  } else {
    /**
     * VARSAYILAN: dün 00:00 → ŞİMDİ. Tek çağrı, iki günü birden kapsar.
     * Gün gün bölmeye gerek yok: etiketleme fonksiyonu zaten aralığın iki
     * yanından 30 satır genişliyor, yani aralığın uzunluğu doğruluğu
     * ETKİLEMİYOR — yalnız tek ifadenin süresini etkiliyor ve iki gün
     * (~29 araç × 2 gün) bu tavanın çok altında.
     */
    const simdi = new Date();
    const dun = new Date(simdi.getTime() - 86_400_000).toISOString().slice(0, 10);
    const d = gunAraligi(dun);
    if (!d) {
      return NextResponse.json({ ok: false, error: "gun_cozulemedi" }, { status: 500 });
    }
    varsayilan = { bas: d.bas, bit: simdi.toISOString() };
  }

  if (kuru) {
    return NextResponse.json({
      ok: true,
      kuru: true,
      arac: arac ?? "hepsi",
      ...(varsayilan
        ? { mod: "varsayilan", bas: varsayilan.bas, bit: varsayilan.bit }
        : { mod: "gun", gunler }),
    });
  }

  const t0 = Date.now();
  const sonuclar: GunSonucu[] = [];
  let toplam = 0;

  try {
    if (varsayilan) {
      const n = await etiketle(varsayilan.bas, varsayilan.bit, arac);
      toplam += n;
      sonuclar.push({ gun: `${varsayilan.bas.slice(0, 10)}→şimdi`, yazilan: n });
    } else {
      for (const g of gunler) {
        const d = gunAraligi(g);
        if (!d) {
          sonuclar.push({ gun: g, yazilan: null, hata: "gun_cozulemedi" });
          continue;
        }
        try {
          const n = await etiketle(d.bas, d.bit, arac);
          toplam += n;
          sonuclar.push({ gun: g, yazilan: n });
        } catch (e) {
          // Bir günün düşmesi turu bitirmez; hangi günün düştüğü SÖYLENİR.
          sonuclar.push({ gun: g, yazilan: null, hata: String(e).slice(0, 160) });
        }
      }
    }
  } catch (e) {
    const msg = String(e);
    const yok = /PGRST202|42883|could not find the function|does not exist/i.test(msg);
    return NextResponse.json(
      {
        ok: false,
        error: yok ? "migration_101_yok" : "db_error",
        hint: yok ? "db/migrations/101_yakit_seri_etiket.sql çalıştırılmadı" : msg.slice(0, 200),
      },
      { status: 503 }
    );
  }

  // Kapsama: teşhis için, hangi araç nereye kadar etiketli.
  let kapsama: { arac: number; enEski: string | null; enYeni: string | null } | null = null;
  const { data: kap } = await supabaseAdmin
    .from("fuel_seri_kapsama")
    .select("vehicle_id, ilk_an, son_an");
  if (kap) {
    const satirlar = kap as { vehicle_id: string; ilk_an: string; son_an: string }[];
    kapsama = {
      arac: satirlar.length,
      enEski: satirlar.length ? satirlar.map((r) => r.ilk_an).sort()[0] : null,
      enYeni: satirlar.length ? satirlar.map((r) => r.son_an).sort().slice(-1)[0] : null,
    };
  }

  const dusenGun = sonuclar.filter((s) => s.hata).length;
  return NextResponse.json({
    ok: dusenGun === 0,
    yazilan: toplam,
    gun: sonuclar.length,
    dusenGun,
    ms: Date.now() - t0,
    sonuclar,
    kapsama,
  });
}

export const POST = GET;
