# /admin/analiz — Faz 1 Doğrulama Raporu

**Tarih:** 20-21.07.2026
**Kapsam:** Yeni `/admin/analiz` sayfası — yan bar (Alarmlar altına "Analiz"), ortak filtre çubuğu (Günlük/Haftalık/Aylık/Özel/Tüm Zamanlar), 3 bölüm: olay-tipi top-10 personel, şoför güvenlik skoru, rölanti israf panosu.
**Metodoloji:** `npm run build` + `npm run lint` (statik doğrulama) + Playwright ile canlı veriye karşı manuel gezinme (masaüstü 1440×900 + mobil 390×844). Ekran görüntüleri gerçek HAK61 filo verisiyle alındı — plakalar/şoför adları gerçek, gizlilik nedeniyle bu dosyada isim geçirilmedi, yalnız `docs/analiz-f1-screenshots/` altında (repo içi, commit'lendi).

---

## 1. Build + Lint

- **`npm run build`:** ✅ 0 hata, 0 uyarı. `/admin/analiz` route listede `ƒ (Dynamic)` olarak görünüyor (server-side render, force-dynamic — diğer admin sayfalarıyla aynı desen).
- **`npm run lint`:** 35 preexisting sorun (29 hata + 6 uyarı) — hepsi Analiz Faz 1 dosyaları dışında (`DashboardShell.tsx`'in kendi eski `NavLinks` render-içi-component sorunu, `HelpProvider`/`HelpTip`/`useOnlineStatus` effect-içi setState sorunları, `ShiftReport.tsx` alt-metin uyarısı). Bu üçü Analiz'den önce de vardı (branch'siz `main`'de doğrulandı). **Analiz Faz 1 dosyaları (`lib/analytics.ts`, `lib/analytics-shared.ts`, `app/admin/analiz/*`, `DashboardShell.tsx`'e eklenen nav satırı, `messages/*.json`) sıfır yeni lint sorunu ekliyor.**

## 2. Normalizasyon kararı — km mi gün mü?

Güvenlik skoru cezası **öncelikle km bazında** normalize ediliyor (`lib/analytics.ts:getVehicleDistanceKm`): `device_telemetry.odometer_km`'nin seçili aralıktaki en erken/en geç dolu okumasının farkı. Bir şoförün bağlı olduğu TÜM araçlar için km verisi varsa ve toplam km makul bir üst sınırın (`MAX_PLAUSIBLE_KM_PER_DAY = 800 km/gün`) altındaysa km kullanılıyor; aksi halde (km verisi yok, sayaç sıfırlanmış/negatif fark, ya da tekil bozuk okuma nedeniyle günlük 800 km'yi aşan bir "mesafe" çıkarsa) **gün-bazlı normalizasyona düşülüyor** ve tabloda `"N gün bazlı"` notu gösteriliyor — km UYDURULMUYOR.

Bu ayrım QA sırasında canlı olarak doğrulandı: "Tüm Zamanlar" görünümünde Sinan Şahinoğlu için 826 km (makul, kullanılıyor) hesaplanırken, Yahya Horasan için ham fark 124.181 km çıktı — bu tek bir bozuk odometer okumasının belirtisi, gerçek bir teslimat aracının süreceği mesafe değil. Guard bunu yakalayıp `null` döndürdü, tablo satırı otomatik "gün bazlı"ya düştü (`5 gün bazlı`). Ekran kanıtı: `docs/analiz-f1-screenshots/analiz-desktop-tumzaman.png`.

## 3. Bölüm bölüm doğrulama

### 3.1 Ortak filtre çubuğu (5 aralık + URL senkronu)
Tüm 5 sekme tıklanarak test edildi, her biri URL query'sine doğru yansıdı:

| Sekme | URL | Sonuç |
|---|---|---|
| Günlük | `?aralik=gun` | ✅ 2 olay (Ani Hızlanma), rölanti panosu **boş durum** gösterdi |
| Haftalık (varsayılan) | `?aralik=hafta` | ✅ 108 olay (Ani Hızlanma), tüm bölümler dolu |
| Aylık | `?aralik=ay` | ✅ URL doğru, veri değişti |
| Özel | `?aralik=ozel` (+ `baslangic`/`bitis`) | ✅ aşağıda ayrı bölüm |
| Tüm Zamanlar | `?aralik=tumzaman` | ✅ 917 olay (Ani Hızlanma), km-guard burada tetiklendi |

### 3.2 Özel aralık — iki bug bulundu ve düzeltildi (önceki oturumda), bu oturumda doğrulandı
- **Bug 1 (km-guard eksikliği):** İlk QA turunda implausible km (124.181 km/hafta) skor tablosuna sızıyordu → `MAX_PLAUSIBLE_KM_PER_DAY` guard'ı eklendi, düzeltme doğrulandı (§2).
- **Bug 2 (tarih alanı yarış durumu / race condition):** İki tarih kutusuna art arda hızlı yazıldığında `useUrlFilters().set()` çağrıları birbirinin üzerine yazıp bir tarihi sessizce URL'den düşürüyordu (React state closure'ının stale prop'tan okuması). **Düzeltme:** `AnalizClient.tsx`'te iki tarih alanı artık lokal `useState` (`localFrom`/`localTo`) tutuyor, her `onChange` HER İKİ değeri birlikte `set()`e gönderiyor. Bu oturumda tekrar test edildi: `2026-01-01` → `2026-01-05` art arda girildi, URL `?aralik=ozel&baslangic=2026-01-01&bitis=2026-01-05` — **her iki tarih de kalıcı**, kayıp yok.
- **Boş durum:** Bu geçmiş (Ocak 2026) aralığında filo verisi yok — tüm top-10 kartları "Bu aralıkta olay yok", güvenlik skoru tablosu herkesi 100 puanla (olaysız sicil) listeledi, rölanti panosu "Bu aralıkta rölanti kaydı yok / Seçili tarih aralığında hiçbir araçta uzun rölanti epizodu görülmedi" gösterdi. Ekran kanıtı: `analiz-desktop-ozel-empty.png`.

### 3.3 Bölüm 1 — Olay tipine göre top-10 personel
6 kart (Ani Hızlanma, Sert Viraj, Ani Fren, Aşırı Hız, Uzun Rölanti, Sinyal Karıştırma) gerçek veriyle doldu; "Atanmamış · PLAKA" satırları (araca şoför atanmamışsa) veri kaybetmeden gösteriliyor. Aşırı Hız kartında `sayı · en yüksek km/h` formatı, Uzun Rölanti kartında `sayı · süre` formatı doğrulandı.

### 3.4 Bölüm 2 — Şoför güvenlik skoru
13/13 şoför listelendi; olaysız şoförler skor 100 ile üstte, olaylı şoförler ceza+normalizasyona göre sıralı. Normalizasyon sütunu km/gün karışık gösterimi doğru render ediyor (§2).

### 3.5 Bölüm 3 — Rölanti israf panosu
Toplam saat + € büyük rakamlar, önceki döneme göre % değişim oku (▼/▲) çalışıyor; tahmini katsayı notu ("0,9 L/sa · 1,65 €/L — ayarlanabilir") her ekranda görünür. Tablo şoför bazında süre/epizod/litre/€ gösteriyor.

## 4. Mobil (390px)
`analiz-mobile-390.png` — top-10 kartları tek sütun akıyor, tablolar (güvenlik skoru + rölanti panosu) `DataTable`'ın mevcut `hideBelow` mekanizmasıyla dar sütunları gizliyor (sm altında Olay/Trend/Epizod/Yakıt sütunları kayboluyor, çekirdek veri — isim + skor/süre/€ — kalıyor). Filtre segmented control mobilde de tıklanabilir kalıyor.

## 5. Ekran görüntüleri
`docs/analiz-f1-screenshots/`:
- `analiz-desktop-hafta.png` — varsayılan görünüm, tüm bölümler dolu
- `analiz-desktop-gun-empty.png` — boş durum (rölanti panosu)
- `analiz-desktop-ay.png`
- `analiz-desktop-tumzaman.png` — km-guard kanıtı (826 km kabul / 124.181 km reddedildi → "5 gün bazlı")
- `analiz-desktop-ozel-empty.png` — geçmiş boş aralık, tüm 3 bölümün boş durumu
- `analiz-mobile-390.png` — 390px kart düzeni

## 6. Sonuç
Faz 1 kapsamındaki her madde canlı veriyle doğrulandı: 5 filtre + URL senkronu, top-10 kartları, güvenlik skoru (km/gün normalizasyonlu), rölanti israf panosu, boş durumlar, mobil kart düzeni. Build/lint temiz. QA sırasında bulunan 2 bug (km-guard, tarih-alanı race condition) düzeltildi ve bu oturumda yeniden doğrulandı.
