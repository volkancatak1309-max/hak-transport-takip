# Faz D-1 — Kârlılık modülü kaldırıldı + üç mobil rapor ucu

Dal: `feat/karlilik-kaldir-ve-rapor-uclari` · Ölçüm: **22.09.2026**
Taban: `main e8133e0` (üç kiracıda da READY)

---

## 1 · Kârlılık modülü üründen kalktı

**Volkan kararı: sefer başına gelir diye bir şey olmayacak.**

### Silinen kod

| dosya | ne idi |
|---|---|
| `app/admin/karlilik/{page,KarlilikClient}.tsx` | Kârlılık ekranı |
| `app/actions/karlilik.ts` | müşteri CRUD · gelir ekle/düzelt/sil · sefere müşteri atama |
| `lib/karlilik.ts` | gelir modelleri, katkı payı hesabı, zarar eşikleri |
| `lib/karlilik-db.ts` | `musteriler` / `sefer_gelirleri` okuma, `seferKmOlc`, `zararEdenMusteriler` |
| `scripts/verify-sefer-karlilik.mjs` + `package.json` betiği | o turun muhafızı |

### Kaldırılırken kırılan üç tüketici — ve ne yapıldı

1. **Menü** (`DashboardShell.tsx`) — yönetici ve şef kollarında iki kalem +
   `Euro` ikon importu.
2. **CO₂ panosunun MÜŞTERİ EKSENİ** (`lib/co2-db.ts` `musteriKirilimi`,
   `lib/co2.ts` `CO2MusteriSatiri`, `CO2Client.tsx` `MusteriTablosu`,
   `GET /api/mobile/analytics/co2` → `pano.musteriler`).
   Sefere müşteri atayan bir yol kalmadığı için bu eksen **kalıcı olarak boş**
   olurdu: duran bir sekme değil, yalan söyleyen bir sekme. Kaldırıldı.
   Varsayılan eksen `musteri` → **`arac`**.
3. **Haftalık aksiyonun `musteri_zarar` kuralı** (084/085 köprüsü) — kural,
   `MusteriZararGirdi`, `TABAN` girdisi ve **üçüncü özne ekseni** (`musteriId`)
   kaldırıldı. `ozneKimligi` artık şoför → araç sırasını kullanıyor.

### Veritabanına DOKUNULMADI

`musteriler` ve `sefer_gelirleri` tabloları, migration 085, ve
`haftalik_aksiyonlar.musteri_id` kolonu **yerinde duruyor**. Migration yok,
DROP yok, `gen-install-sql.mjs` listesinde 085 kaldı.

**Ölçüldü (22.09.2026, üç kiracı):** kaldırma tek bir canlı satıra dokunmuyor.

| kiracı | `musteri_id` dolu sefer | `kural='musteri_zarar'` aksiyon | toplam aksiyon |
|---|---|---|---|
| HAK61 | **0** / 11 sefer | **0** | 25 |
| Sendigo | **0** / 0 | **0** | 0 |
| galzura-demo | **0** / 3 sefer | **0** | 0 |

`musteriler` ve `sefer_gelirleri` üçünde de **0 satır**dı.

### `tenant_cost_rates` KALDI

076/077 maliyet motoru dokunulmadan duruyor — rölanti ve yakıt € hesabı ona
bağlı (`lib/cost-rates-db.ts`, `lib/cost-model.ts`). Kaldırılan şey **gelir**
tarafıydı, maliyet değil.

### ⚠️ "müşteri" kelimesi ≠ kârlılık müşterisi

Kaldırma sırasında **DOKUNULMAYAN** iki ayrı kavram var, ikisi de yaşıyor:

- **Müşteri BÖLGESİ** (`geofences.purpose='customer'`,
  `lib/zone-visits.ts` `aktifMusteriBolgeleri`, `MusteriKapaliHatasi`,
  `err_musteri_kapali`) — bölge sistemi, kârlılıkla ilgisi yok.
- Prose'daki "müşteri" = **ürünün müşterisi** (HAK61, Sendigo).

Kalıntı taraması bu ikisini ayırt ederek yapıldı; kârlılık kimlikleri
(`karlilik` · `musteriler` · `musteri_id` · `sefer_gelirleri` · `gelir*`)
**0 sonuç** döndürüyor.

---

## 2 · Üç yeni mobil rapor ucu

| uç | biçim | kaynak | panelde karşılığı |
|---|---|---|---|
| `GET /api/mobile/reports/speed.csv` | `;` + UTF-8 BOM | `buildSpeedReport` | Raporlar › Hız — **düğme YOK** (ölçüldü) |
| `GET /api/mobile/reports/zone-durations.csv` | `;` + UTF-8 BOM | `buildZoneVisitReport` | Raporlar › Bölge Süreleri — **CSV düğmesi var** |
| `GET /api/mobile/reports/co2.pdf` | PDF, 3 sayfa | `co2PanosuOzet` | CO₂ — **üç dil PDF düğmesi var** |

Üçü de kardeş uçların aralık dilini konuşuyor:
`?range=gun|hafta|ay|tumzaman|ozel` (+`?from=&to=`), `?dil=tr|de|en`.

### Biçim kararları — panelden kopyalandı, "düzeltilmedi"

- **`zone-durations.csv`** panelin `exportCsv`inin birebir ikizi: sekiz sütun,
  aynı sıra. Açık ziyaret **boş** kalır (0 yazmak Excel'de "hiç durmadı" diye
  okunur) ve iki belirsizlik sebebi (`sinyal` = cihaz sustu · `bolge` = ölçümü
  BİZ durdurduk) CSV'ye de taşınır — bu dosya müşteri faturasının ekine giriyor.
- **`speed.csv`** panelden kopyalanamadı çünkü **panelde o düğme yok**
  (`SpeedClient.tsx` içinde `csv`/`EXPORT_ENABLED` geçmiyor). Ekranın
  TABLOSUNDAN türetildi: aynı beş sütun, aynı sıra. `per100Km === null` ise
  hücre boş bırakılmaz, panelin ekrana yazdığı gerekçe (`ratio_reason_*`)
  yazılır.
- **`co2.pdf`** için `components/pdf/server/CO2Doc.tsx` yazıldı — panelin
  istemci belgesinin sunucu ikizi (`AZGDoc`/`SchichtberichtDoc` deseni).
  Aynı üç sayfa, aynı sözlük, aynı sütunlar.

### 🔴 Görevden İKİ SAPMA — ikisi de ölçümle

**1) Kapı `requireMobileFleetView` değil `requireMobileAdmin`.** İki sebep:

- **Panelde bu sayfalar şefe zaten kapalı.** `raporlar/hiz/page.tsx:22` ve
  `raporlar/bolge-sureleri/page.tsx:26` `requireAdmin()` çağırıyor. (CO₂ sayfası
  `requireFleetView()` — istisna.)
- **Kapsam süzgeci hiçbir kurucuda yok.** `buildSpeedReport(range)`,
  `buildZoneVisitReport(range)` ve `co2PanosuOzet(bas, bit)` filo parametresi
  almıyor. Şefe açıp kapsam uygulamamak, kendi filosu dışındaki araçların
  plakalarını ve ihlallerini ona vermek olurdu — **sessiz kapsam sızıntısı**.

Mevcut beş rapor ucunun (`azg` · `schichtbericht` · `distance` · `fuel` ·
`shifts`) beşi de `requireMobileAdmin`. Şefe açmak AYRI bir karardır ve önce
rapor kuruculara filo kapsamı eklenmesini gerektirir.

**2) `EXPORT_ENABLED` yalnız iki CSV ucunda, PDF'te YOK.** `_rapor/pdf.ts`
başlığında yazılı karar (18.08.2026, Volkan): panelde o bayrak **yalnız CSV
düğmelerini** kapatıyor, PDF düğmelerinde hiç okunmuyor. Bayrak PDF uçlarına
eklenmişti ve KALDIRILDI — mobilin panelden katı olması, panelde açık olan bir
belgeyi telefonda "kapalı" göstermek demekti. Bugün yeniden ölçüldü:
`CO2Client.tsx` içinde `EXPORT_ENABLED` geçmiyor. Yani "mevcut desen" = CSV'de
kapı var, PDF'te yok — uçlar o desene uydu.

### Boş belge üretilmez

`co2.pdf`, dönemde ölçülebilir tüketim yoksa (`pano.yakitYok`) **409
`yakit_yok`** döner. Her hücresi "—" olan üç sayfalık bir beyan belgesi
üretmek, kullanıcıya boş kâğıt satmak olurdu.

---

## 3 · Doğrulama

| adım | sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| `npm run build` | **0 hata**; üç yeni rota çıktıda, `/admin/karlilik` YOK |
| ESLint | **43 problem — 28 hata, 15 uyarı** (belgedeki taban ile BİREBİR aynı) |
| 21 muhafız | 20 ✓ · `lint:test-filters` ✗ — **tek bulgu `lib/auto-shift.ts:825`**, turdan ÖNCE de aynıydı |
| `lint:tenant-defaults` | ✓ |

⚠️ ESLint sayımı bir ara **44**'e çıkmıştı: `MusteriTablosu` silinince
`CO2Client.tsx`teki `Info` ikonu kullanılmaz kaldı. İmport kaldırıldı, sayım
tabana döndü. Kaldırma turlarında bu kalıp kolayca gözden kaçar.
