import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * SORGU SAYACI — #84'ün Adım 0'ı (18.08.2026).
 *
 * ── NEDEN ÖNCE BU ──────────────────────────────────────────────────────────
 * #84'ün hedefi "tur başına ~221 sorgu → ~43". Bu iddia ancak ÖNCE rakamı
 * ölçülmüşse doğrulanabilir. Kasadaki kural açık: değişen sayının gerçekten
 * değiştiğini ölç, tahmin etme. Bu yüzden ilk adım optimizasyon değil, ÖLÇÜ.
 *
 * ── NEDEN AsyncLocalStorage (modül seviyesinde sayaç DEĞİL) ────────────────
 * `supabaseAdmin` paylaşılan tek bir istemci. Modül seviyesinde bir sayaç
 * tutsaydık aynı lambda örneğinde eşzamanlı çalışan BAŞKA bir istek de sayaca
 * yazardı ve taban rakamı sessizce şişerdi — yani ölçmek için eklediğimiz araç
 * ölçümü bozardı. ALS her isteği kendi kabında tutar; tur dışındaki hiçbir
 * sorgu bu sayaca değmez.
 *
 * `node:async_hooks` yalnız Node runtime'da var. Bu depoda edge runtime
 * kullanan HİÇBİR rota yok (denetlendi) ve `lib/supabase.ts` zaten
 * `server-only`; yani bu import yeni bir kısıt getirmiyor.
 *
 * ── KAPALIYKEN BEDELİ SIFIR ────────────────────────────────────────────────
 * Kap yoksa `getStore()` undefined döner ve fonksiyon ilk satırda çıkar.
 * Turun dışındaki sorgular ölçülmez ve yavaşlamaz.
 */
export type SorguSayaci = {
  /** Toplam PostgREST çağrısı (from + rpc). */
  toplam: number;
  /** Tablo/fonksiyon bazında döküm — hangi adımın ne kadar düşürdüğü görünsün. */
  kaynak: Record<string, number>;
  /** Tur içi memoizasyon (#84 Adım 4) — bkz. `turMemo`. */
  memo: Map<string, Promise<unknown>>;
};

const depo = new AsyncLocalStorage<SorguSayaci>();

/**
 * Verilen işi sayaç kabı içinde çalıştırır. `oku()` iş bittikten SONRA
 * çağrılırsa o turun toplamını verir.
 */
export function sayacIle<T>(
  is: (oku: () => SorguSayaci) => Promise<T>
): Promise<T> {
  const sayac: SorguSayaci = { toplam: 0, kaynak: {}, memo: new Map() };
  return depo.run(sayac, () => is(() => sayac));
}

/** Tek bir PostgREST çağrısını kaydeder. Kap yoksa hiçbir şey yapmaz. */
export function sorguKaydet(kaynak: string): void {
  const s = depo.getStore();
  if (!s) return;
  s.toplam++;
  s.kaynak[kaynak] = (s.kaynak[kaynak] ?? 0) + 1;
}

/**
 * TUR İÇİ MEMOİZASYON (#84 Adım 4).
 *
 * Aynı tur boyunca DEĞİŞMEYEN bir okumayı bir kez yapıp tekrar kullanmak için.
 * İlk kullanan: `activeDepotZones()` — depo bölgeleri tur içinde değişmez ama
 * fonksiyon 7 ayrı yerden çağrılıyor ve her çağrı DB'ye gidiyordu
 * ([[Bekleyen-Isler]] #83, ölçüldü: tur başına 6-7 `geofences` sorgusu).
 *
 * ── NEDEN React `cache()` DEĞİL ────────────────────────────────────────────
 * Depoda `cache()` deseni var (`lib/session.ts:342 isOwnerCached`) ama o
 * Server Component bağlamında çalışıyor. Senkron turu bir Route Handler ve
 * orada React istek kapsamının varlığı garanti değil; olmayınca `cache()`
 * ya hiç dedupe etmez ya da davranışı sürprizli olur. Bu kap ise turu
 * BİZİM açtığımız `sayacIle()` sağlıyor — garantili.
 *
 * ── KAP YOKSA DAVRANIŞ DEĞİŞMEZ ────────────────────────────────────────────
 * Tur dışındaki her çağrı (panel sayfaları, diğer rotalar) doğrudan `uret()`e
 * düşer, yani BUGÜNKÜ davranış. Önbellek yalnız tek bir senkron turu kadar
 * yaşar; iki tur arasında taşınmaz, bayat veri riski yoktur.
 *
 * Promise saklanır (değer değil): aynı tur içinde eşzamanlı iki çağrı tek
 * sorguya iner, ikincisi ilkinin sonucunu bekler.
 */
export function turMemo<T>(anahtar: string, uret: () => Promise<T>): Promise<T> {
  const s = depo.getStore();
  if (!s) return uret();
  const mevcut = s.memo.get(anahtar);
  if (mevcut) return mevcut as Promise<T>;
  const p = uret();
  s.memo.set(anahtar, p as Promise<unknown>);
  return p;
}
