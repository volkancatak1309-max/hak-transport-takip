/**
 * KURU KOŞUM YÜKLEYİCİSİ — gerçek kod, sahte veritabanı.
 *
 * `ts-server.mjs`in yaptığı her şeyi yapar (server-only / next-headers /
 * next-cache şimleri, takma ad çözümü), ÜSTÜNE `@/lib/supabase`i
 * `scripts/supabase-mock.mjs`e yönlendirir.
 *
 * ── NEDEN GEREKLİ ─────────────────────────────────────────────────────────
 * Elde yalnız İKİ CANLI MÜŞTERİ anahtarı var (HAK61, Sendigo) ve ikisine de
 * YAZMA YASAK. Yeni yazma uçlarının davranışı yine de ölçülmeli. Bu yükleyici
 * route handler'ları ve çekirdekleri AYNEN koşturur; yalnız DB katmanı kayıt
 * cihazına dönüşür.
 *
 * ── ÇİFTE EMNİYET ─────────────────────────────────────────────────────────
 *   1. `ENV_FILE` SAHTE bir env'e çevrilir (`scripts/kuru.env`) — gerçek
 *      Supabase URL/anahtarı process'e HİÇ girmez. Şim bir şekilde devre dışı
 *      kalsa bile gidecek bir adres yok.
 *   2. Şim modülü `__MOCK__` bayrağı taşır; ölçüm betikleri ilk satırda onu
 *      doğrular ve yoksa DURUR.
 *
 * Kullanım:
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./scripts/ts-server-kuru.mjs scripts/verify-mobil-uc-1.mjs
 */
import { registerHooks } from "node:module";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SAHTE_ENV = path.join(HERE, "kuru.env");
const MOCK = path.join(HERE, "supabase-mock.mjs");

// ── 1) SAHTE ENV — gerçek anahtar bu process'e girmez ──────────────────────
if (!existsSync(SAHTE_ENV)) {
  writeFileSync(
    SAHTE_ENV,
    [
      "# KURU KOŞUM — sahte değerler. Gerçek bir kuruluma bağlanmaz.",
      "NEXT_PUBLIC_SUPABASE_URL=https://kuru-kosum.invalid",
      "SUPABASE_SERVICE_ROLE_KEY=kuru-kosum-sahte-anahtar",
      "SESSION_PASSWORD=kuru-kosum-sahte-oturum-sirri-en-az-32-karakter-olmali",
      "",
    ].join("\n"),
    "utf8"
  );
}
process.env.ENV_FILE = SAHTE_ENV;

// ── 2) SUPABASE ŞİMİ — ts-server'ın hook'undan ÖNCE kaydedilir ────────────
// registerHooks zinciri son kaydedileni ÖNCE çalıştırıyor; bu yüzden şim
// kaydı `./ts-server.mjs` importundan SONRA yapılıyor (aşağıda).
function supabaseMi(spec) {
  return (
    spec === "@/lib/supabase" ||
    spec === "./supabase" ||
    spec === "../lib/supabase" ||
    /(^|\/)lib\/supabase(\.ts)?$/.test(spec)
  );
}

await import("./ts-server.mjs");

registerHooks({
  resolve(specifier, context, nextResolve) {
    // ŞİMİN KENDİSİ gerçek dosyayı içe aktarabilmeli: saf yardımcıları
    // (fetchAllRows / fetchPagesUntil / chunkIds) oradan YENİDEN İHRAÇ ediyor,
    // kopyalamıyor. Parent süzgeci olmadan bu bir döngü olurdu.
    const sim = (context.parentURL ?? "").endsWith("supabase-mock.mjs");
    if (!sim && supabaseMi(specifier)) {
      return nextResolve(pathToFileURL(MOCK).href, context);
    }
    return nextResolve(specifier, context);
  },
});

// Gerçek dosyanın da elenmesi: takma ad çözülüp mutlak yola dönerse yakala.
const GERCEK = path.join(ROOT, "lib", "supabase.ts");
registerHooks({
  resolve(specifier, context, nextResolve) {
    const r = nextResolve(specifier, context);
    if ((context.parentURL ?? "").endsWith("supabase-mock.mjs")) return r;
    // `node:` / `data:` şemalı URL'lerde fileURLToPath FIRLATIR — önce süz.
    if (r?.url?.startsWith("file:") && fileURLToPath(r.url) === GERCEK) {
      return { ...r, url: pathToFileURL(MOCK).href };
    }
    return r;
  },
});
