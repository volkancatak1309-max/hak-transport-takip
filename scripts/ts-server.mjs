/**
 * SUNUCU MODÜLÜ KOŞUCUSU — canlı doğrulama betikleri için.
 *
 * `scripts/ts-alias.mjs`in yaptığı her şeyi yapar, ÜSTÜNE iki şey:
 *   1. `server-only` boş modüle yönlendirilir (Next'in derleme-anı takma adı,
 *      node_modules'da yok) → `lib/supabase.ts`, `lib/telemetry.ts`,
 *      `lib/route-history.ts` ve route.ts dosyaları Node'da AYNEN çalışır;
 *   2. `.env.local` (ya da `ENV_FILE`) `process.env`e yüklenir — `lib/supabase.ts`
 *      içe aktarıldığı ANDA anahtarları okuyup yoksa fırlatıyor, bu yüzden
 *      yükleme betikten ÖNCE olmak zorunda (`--import` bunu garanti eder).
 *
 * ── NEDEN ts-alias.mjs'E EKLENMEDİ ─────────────────────────────────────────
 * `scripts/check-*.mjs` muhafızları `server-only` çözülemediği için SAF katmana
 * mahkûmdur — ve bu bir ÖZELLİKTİR: saf katmana bir DB çağrısı sızarsa muhafız
 * çalışmaz olur ve bunu hemen görürüz. Stub'ı oraya koymak o emniyeti kaldırırdı.
 *
 * Kullanım:  node --import ./scripts/ts-server.mjs scripts/verify-ariza-bildir.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = path.resolve(HERE, "..");
const STUB = path.join(HERE, "server-only-stub.mjs");

// ── env: lib/supabase.ts'ten ÖNCE ──────────────────────────────────────────
const ENV_FILE = path.resolve(ROOT, process.env.ENV_FILE ?? ".env.local");
if (!existsSync(ENV_FILE)) {
  console.error(`✗ env dosyası yok: ${ENV_FILE}`);
  process.exit(1);
}
for (const satir of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
  if (!satir.includes("=") || satir.trim().startsWith("#")) continue;
  const i = satir.indexOf("=");
  const ad = satir.slice(0, i).trim();
  // Kabuktan gelen değer KAZANIR — betik `ENV=x node …` ile ezilebilsin.
  if (process.env[ad] === undefined) process.env[ad] = satir.slice(i + 1).trim();
}

function uzantiEkle(dosya) {
  if (/\.[cm]?[jt]sx?$|\.json$/i.test(dosya)) return existsSync(dosya) ? dosya : null;
  for (const aday of [`${dosya}.ts`, `${dosya}.tsx`, `${dosya}.js`, `${dosya}/index.ts`]) {
    if (existsSync(aday)) return aday;
  }
  return existsSync(dosya) ? dosya : null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // node_modules'a HİÇ dokunma (ts-alias.mjs ile aynı gerekçe).
    const parent = context.parentURL ?? "";
    if (parent.includes("/node_modules/")) return nextResolve(specifier, context);

    if (specifier === "server-only") return nextResolve(pathToFileURL(STUB).href, context);
    if (specifier.startsWith("@/")) {
      const hedef = uzantiEkle(path.resolve(ROOT, specifier.slice(2)));
      if (hedef) return nextResolve(pathToFileURL(hedef).href, context);
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      parent &&
      !/\.[cm]?[jt]sx?$|\.json$/i.test(specifier)
    ) {
      const hedef = uzantiEkle(fileURLToPath(new URL(specifier, parent)));
      if (hedef) return nextResolve(pathToFileURL(hedef).href, context);
    }
    try {
      return nextResolve(specifier, context);
    } catch (e) {
      /**
       * `next/headers` gibi uzantısız Next alt yolları: paket bunları kendi
       * bundler'ı için dışa açıyor, düz Node ESM çözemiyor ("Did you mean
       * next/headers.js?"). Uzantıyı ekleyip GERÇEK modüle gidiyoruz — stub
       * DEĞİL, çünkü `lib/session.ts` yalnızca içe aktarılıyor, çerez okuyan
       * fonksiyonları bu yolda hiç çağrılmıyor.
       */
      if (e?.code === "ERR_MODULE_NOT_FOUND" && /^next\/[^.]+$/.test(specifier)) {
        return nextResolve(`${specifier}.js`, context);
      }
      throw e;
    }
  },
});
