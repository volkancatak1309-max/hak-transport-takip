# HAK61 — çalışma kuralları

## Doğrulama: standart yol varsayılandır

Normal işlerde **standart doğrulama yeterlidir**:

1. `npx tsc --noEmit` — 0 hata
2. `npm run build` — 0 hata
3. Muhafızlar — `node scripts/check-test-filters.mjs` (test verisi + şoför + filo kapsamı)
4. **Canlıda kanıt** — değişen sayının gerçekten değiştiğini göster

4. madde en önemlisi ve atlanamaz. Bu projede kimlik doğrulamalı Playwright QA
bloklu (seal-mint ve test-admin oluşturma sınıflandırıcıca reddediliyor), bu
yüzden kanıt yöntemi **UI-path proof**: sayfanın çalıştırdığı Supabase sorgu
yolunu canlı veritabanında birebir tekrarlayan küçük bir script yaz, ÖNCE/SONRA
sayılarını bas. Tahmin etme, ölç.

`npm run verify` şu anda **kırmızı** ve bu mevcut duruma ait: ESLint 37 problem
(28 hata — `Date.now()` sunucu bileşeninde, `set-state-in-effect`). Yeni iş bu
sayıyı **artırmadığı sürece** sorun değil; commit öncesi önce/sonra karşılaştır.

## Çok-ajanlı adversaryal inceleme VARSAYILAN DEĞİL

10+ ajanlı derin inceleme / ultracode iş akışı **yalnızca Volkan açıkça
"derin incele" (ya da eşdeğeri) derse** kullanılır.

Kendiliğinden başlatma. İşin büyük, riskli ya da çok dosyaya dokunuyor olması
tek başına gerekçe değil. Gerekli olduğunu düşünüyorsan **öner ve sor**, sonra
bekle — çalıştırma.

**Neden:** pahalı ve yavaş. Normal işlerde standart doğrulama zaten hatayı
yakalıyor; derin inceleme onu ikame etmez, üstüne biner. Değerli olduğu yer dar:
çok sayıda yüzeye yayılan kapsam/filtre değişiklikleri, geriye dönük sessiz
regresyon riski taşıyan işler, "hangi ekranlar etkilenir" sorusunun cevabı
belirsizse.

Bu kural doğruluk çıtasını düşürmez — yalnızca hangi aracın varsayılan olduğunu
belirler. Standart doğrulamanın dördü de her işte geçerlidir.
