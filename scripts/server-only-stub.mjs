/**
 * Boş modül — `server-only` yerine geçer.
 *
 * `server-only` Next.js'in DERLEME ANI takma adıdır; node_modules'da YOKTUR
 * (`require.resolve` MODULE_NOT_FOUND verir). Canlı doğrulama betikleri sunucu
 * modüllerini Node'da çalıştırabilsin diye bu boş modüle yönlendirilir.
 * Yalnız `scripts/ts-server.mjs` tarafından kullanılır.
 */
export {};
