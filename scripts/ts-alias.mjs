/**
 * Node için `@/…` yol takma adı + `.ts` uzantı çözümleyicisi.
 *
 * NEDEN VAR: muhafız ve doğrulama betikleri uygulamanın GERÇEK kodunu
 * çalıştırmalı — kopyasını değil. Depo kaynağı `@/lib/format` gibi tsconfig
 * takma adı kullanıyor; Next/Turbopack bunu çözer, Node ESM çözmez. Kaynağa
 * dokunup importları görelileştirmek yerine çözümleme burada tamamlanıyor.
 *
 * Node 24 `.ts` dosyalarındaki tipleri kendi soyuyor (type-stripping), yani
 * `import type` satırları çalışma anında YOK. Bu sayede saf modüller
 * (lib/vehicle-day.ts, lib/metrics-*.ts) `server-only` zincirine hiç girmeden
 * içe aktarılabiliyor.
 *
 * Kullanım:  node --import ./scripts/ts-alias.mjs scripts/check-arac-uclari.mjs
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** `dosya` → var olan ilk aday (uzantı eklenerek). */
function uzantiEkle(dosya) {
  if (/\.[cm]?[jt]sx?$|\.json$/i.test(dosya)) return existsSync(dosya) ? dosya : null;
  for (const aday of [`${dosya}.ts`, `${dosya}.tsx`, `${dosya}.js`, `${dosya}/index.ts`]) {
    if (existsSync(aday)) return aday;
  }
  return existsSync(dosya) ? dosya : null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // node_modules'a HİÇ dokunma: oradaki CJS paketleri kendi çözümleyicisini
    // ister ve araya girmek onları bozar (@supabase/functions-js ile ölçüldü).
    const parent = context.parentURL ?? "";
    if (parent.includes("/node_modules/")) return nextResolve(specifier, context);

    if (specifier.startsWith("@/")) {
      const hedef = uzantiEkle(path.resolve(ROOT, specifier.slice(2)));
      if (hedef) return nextResolve(pathToFileURL(hedef).href, context);
    }
    // Yalnız UZANTISIZ göreli import — uzantılıyı Node zaten çözer.
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      parent &&
      !/\.[cm]?[jt]sx?$|\.json$/i.test(specifier)
    ) {
      const hedef = uzantiEkle(fileURLToPath(new URL(specifier, parent)));
      if (hedef) return nextResolve(pathToFileURL(hedef).href, context);
    }
    return nextResolve(specifier, context);
  },
});
