/**
 * ORAN KÜMESİ — DERLEME ANI TESTİ. Çalışma zamanında hiçbir işi yok.
 *
 * Bu dosya `npx tsc --noEmit` her koştuğunda sınanır. `@ts-expect-error`
 * TERSİNE çalışır: altındaki satır hata VERMEZSE derleme kırılır. Yani
 * kuralın delindiği gün bu dosya kırmızıya döner.
 *
 * ── NEDEN VAR: muhafızın göremediği vaka ──────────────────────────────────
 * `scripts/check-oran-kume.mjs` `reduce(… ?? 0)` kalıbını arar. Aşağıdaki
 * `muhafizinKacirdigiVaka` fonksiyonu o kalıbı HİÇ KULLANMIYOR — iki ayrı
 * `filter` + iki ayrı `reduce`, `?? 0` yok, sözdizimsel olarak tertemiz.
 * Muhafız sessiz kalır. Tip kırar.
 *
 * Ayrıntı: `docs/ORAN-KUME-KURALI.md` § 6.
 */
import { kume, topla, oran, oranOlcekli } from "./oran-kume";

type Arac = { plaka: string; kg: number | null; km: number | null };

// ── 1) DOĞRU KULLANIM — tek küme, iki uç ─────────────────────────────────
export function dogruKullanim(araclar: Arac[]): number | null {
  const oranK = kume(
    "kg+km",
    araclar.filter((a) => a.kg !== null && a.km !== null)
  );
  return oranOlcekli(
    topla(oranK, (a) => a.kg),
    topla(oranK, (a) => a.km),
    1000
  );
}

// ── 2) 🔴 MUHAFIZIN KAÇIRDIĞI VAKA — tip yakalıyor ───────────────────────
/**
 * İki ayrı filtre, iki ayrı toplam, `?? 0` YOK. `check-oran-kume.mjs` bu
 * kodda hiçbir bulgu üretmez; ölçüm de üretmez (gün/hafta/ay pencerelerinde
 * kg kümesi ⊆ km kümesi olduğu için sayı tesadüfen doğru çıkar). Kusur
 * yalnız km'si ölçülemeyen araç olduğunda görünür — 31.08'de tam bu oldu.
 */
export function muhafizinKacirdigiVaka(araclar: Arac[]): number | null {
  const kgK = kume("kg", araclar.filter((a) => a.kg !== null));
  const kmK = kume("km", araclar.filter((a) => a.km !== null));
  return oran(
    topla(kgK, (a) => a.kg),
    // @ts-expect-error — pay "kg" kümesinden, payda "km" kümesinden: FARKLI KÜME
    topla(kmK, (a) => a.km)
  );
}

// ── 3) Etiket birleşimi de geçmemeli ─────────────────────────────────────
/**
 * `NoInfer` olmasaydı TypeScript `K`'yı iki argümandan çıkarsayıp
 * `"kg" | "km"` birleşimini kabul ederdi. Bu test o kapıyı kapalı tutuyor.
 */
export function birlesimGecmemeli(araclar: Arac[]): number | null {
  const a = kume("litre", araclar.filter((x) => x.kg !== null));
  const b = kume("saat", araclar.filter((x) => x.km !== null));
  return oran(
    topla(a, (x) => x.kg),
    // @ts-expect-error — "saat" ≠ "litre"
    topla(b, (x) => x.km)
  );
}

// ── 4) Aynı etiket, farklı alan — SERBEST ────────────────────────────────
/**
 * Aynı kümeden iki farklı alanı bölmek meşrudur (kg/km, litre/km…).
 * Kural kümeyle ilgili, alanla değil. Bu satır hata VERMEMELİ.
 */
export function ayniKumeFarkliAlan(araclar: Arac[]): number | null {
  const k = kume("kg+km", araclar.filter((a) => a.kg !== null && a.km !== null));
  return oran(
    topla(k, (a) => a.kg),
    topla(k, (a) => a.km)
  );
}
