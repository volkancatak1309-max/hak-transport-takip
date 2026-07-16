# HAK61 — Reveal Klon Spesifikasyonu (piksel düzeyi)

**Tarih:** 15.07.2026 · **Amaç:** Verizon Connect Reveal'ın Alerts + Dashboard ekranlarını **yerleşim/etkileşim düzeyinde birebir** klonlamak; yalnız veri (HAK61) ve renk paleti (koyu zemin + bordo) bizim. Bu turda özgün tasarım kararı YOK — Reveal'da ne varsa o.

**Yasal not:** Reveal'ın **yerleşim ve etkileşim düzeni** klonlanır (fikri mülkiyet açısından meşru); logosu, markası ("Verizon Connect"/"Reveal+"), ikon seti veya kodu KOPYALANMAZ. Telifli Reveal ekran görüntüleri herkese açık repoya konmaz; yan yana kanıt yerel `scratchpad/clone-proof/` altında üretilir.

**Kaynak:** 4 gerçek Reveal ekran görüntüsü (`scratchpad/competitor-shots/`: alerts-overview, reveal-dashboard, notification-panel, fleet-status-location) + FAZ 1/klon-öncesi derin araştırma. Ölçüler görüntülerden ~1180px içerik genişliğine oranlanarak çıkarıldı.

---

## A. ALERTS ekranı

### A0. Genel kabuk
- Reveal: üst yatay nav. **Bizde: mevcut sol sidebar kabuğu KORUNUR** (nav değişimi tüm sayfaları etkiler, kapsam dışı). Klon = içerik alanı.

### A1. Alt sekme şeridi (sub-tabs)
- Yükseklik ~44px. Sola hizalı. Sekmeler: **"Genel Bakış" · "Alarm Kaydı"** (Reveal: Overview · Alert log · My alerts — "My alerts" bizde yok, atlanır).
- Aktif sekme: alt **2px bordo çizgi** (Reveal kırmızı → bizde `--accent-claret`), metin **font-semibold**, renk `--foreground`.
- Pasif: `--muted-foreground`, normal ağırlık. Sekme arası boşluk ~28px. Metin ~14px.
- Şeridin altında 1px `--border` tam-genişlik ayraç.

### A2. Başlık bloğu
- H1 ~28-30px **font-semibold**, mt ~20px. Alt açıklama ~14px `--muted-foreground`, mt ~6px.
- Reveal sağ üstte siyah "CREATE ALERT". **Bizde alarm OLUŞTURULMAZ** (cihaz-üretimi olaylar) → buton yok; sağ üst boş bırakılır (spec'e sadık kalıp uydurma buton koymuyoruz).

### A3. Filtre bandı (Volkan: "basit, tek satır, Reveal neyse o")
- Full-genişlik **hafif tint band** (Reveal açık gri → bizde `--surface-2`), py ~16px px ~16px, radius ~10px.
- **İki etiketli dropdown, tek satır** (Reveal Overview birebir):
  - "Gösterilen" (Show alerts triggered): **Bugün / 7 gün / 30 gün** dropdown ~200px.
  - "Sırala" (Sort by): **En çok tetiklenen / En yeni** dropdown ~200px.
- Etiket dropdown'un ÜSTÜNDE ~12px `--muted-foreground`. Dropdown h ~38px, radius ~8px, sağda chevron.
- **ÇİP YOK, breakdown kartı YOK, trend grafiği YOK** (önceki turların hepsi kaldırıldı — Volkan kararı).

### A4. Genel Bakış sekmesi — tile ızgarası (Reveal Overview birebir)
- 3 kolon, gap ~20px, mt ~20px. (Mobilde 1 kolon.)
- **Tile = olay TİPİ** (Reveal'da alarm policy; bizde device olay tipi). Anatomi:
  - Kart: `--card`, 1px `--border`, radius ~8px, padding ~18px, min-h ~120px, dikey flex.
  - Üst: **tip adı** bold ~16px `--foreground` (ör. "Sinyal Karıştırma"); altında **kategori** ~13px `--muted-foreground` (kritik/uyarı/rutin).
  - Alt satır: iki stat kolonu — sol "Son tetiklenme" (etiket ~12px gri + değer ~13px), sağ "Alarm" (etiket + **sayı ~14px**).
  - Sağ-alt köşe: **kritik rozeti** — Reveal kırmızı okunmamış rozeti → bizde `--status-critical-fill` dolu daire ~22px, içinde beyaz kritik sayısı (yalnız kritik>0 ise).
  - Tile hover: `--surface-2`. **Tıkla → "Alarm Kaydı" sekmesine geç, o tipe filtreli.**
- Sıralama: "Sırala" dropdown (En çok tetiklenen = sayıya göre azalan).

### A5. Alarm Kaydı sekmesi — tablo (Reveal Alert Log birebir)
- Üstte Reveal'ınkine benzer **tek satır dropdown filtre bandı**: Araç · Olay tipi · Şiddet (Reveal: Vehicles/Alert type/Priority). + sağda "CSV" (opsiyonel, sonraki tur).
- Tablo kolonları (Reveal: Vehicle · Driver · Alert Name · Alert Type · Date Triggered · Priority): **Araç · Olay · Zaman · Hız/bağlam · Şiddet**. Başlıklar ~11px uppercase gri, sıralanabilir.
- Satır yüksekliği ~44px (rahat) / ~36px (sıkı). Bold satır = kritik (Reveal bold=okunmamış). Sol renk şeridi = şiddet.
- Satır → detay drawer (mini-harita — Reveal alarm detay penceresi deseni; bu korunuyor çünkü Reveal'da da var).
- Sayfalama: "Sayfa başına 50 · 1-50 / N" (Reveal "Items per page 1-10 of 500").

---

## B. DASHBOARD ekranı (Reveal Dashboard birebir)

### B1. Araç çubuğu (toolbar)
- ~56px. Sol: **dashboard/aralık seçici** (Reveal "Operations ▾" + "Entire Fleet ▾") → bizde **aralık dropdown** (Bugün/Hafta/Ay/Özel). Sağ: mevcut export butonları (Excel/PDF/AZG).
- Full-genişlik alt 1px `--border`.

### B2. Tile ızgarası — 6 tile, 3 kolon × 2 satır (Reveal birebir)
- Gap ~16px. Her tile: `--card`, 1px `--border`, radius ~10px, padding ~14px, height ~230px, dikey flex.
- **Tile başlığı:** bold ~15px `--foreground` sol; sağda grafik-tipi ikonu + (opsiyonel) dişli.
- **Gövde = yatay bar ranking** (Reveal Vehicle Activity / Harsh Driving / Distance deseni):
  - Her satır: **etiket** (~11px, sol, sabit ~90px kolon, sağa hizalı), **bar** (flex, yükseklik ~14px, radius 2px), **değer** (~11px bold, sağ, ~64px kolon). Satır yüksekliği ~20px, ~8-9 satır.
  - Bar rengi (Reveal yeşil-iyi/kırmızı-kötü yerine BİZİM palet): tek-metrik = `--accent-sky` dolu; iki-tonlu (ör. çalışma saati normal+9h aşan) = sky + gold; alarm/ihlal = `--status-critical`.
- **Footer:** ~11px `--muted-foreground` scope etiketi (Reveal "Vehicles: Average per day (Previous week)") → bizde "Sürücü · seçili aralık" vb.; üstte 1px ayraç.
- **6 tile (bizim veri):**
  1. **Çalışma Saati** (sürücüye göre) — yatay bar, saat
  2. **Kat Edilen KM** (sürücüye göre) — yatay bar
  3. **En Çok Alarm** (araca göre) — yatay bar, kritik kırmızı
  4. **Teslimat** (sürücüye göre) — yatay bar
  5. **Performans Puanı** (sürücüye göre) — yatay bar
  6. **Alarm Trendi** (zaman) — dikey bar trend (Reveal "Wasted Fuel" tile tipi)

### B2b. Performans penceresi (Volkan onayı, 17.07.2026)
- Tile'lar vardiya tablosunun aralığından **BAĞIMSIZ**: sabit kayan **son 7 gün** (`PERF_WINDOW_DAYS`). Reveal de tile'larını sabit pencerede tutar ("Previous week").
- Tile footer'ı pencereyi açıkça yazar: **"Şoför · Son 7 gün"** — tablodaki aralıkla karışmasın.
- Gerekçe: tile'lar aralığa bağlıyken "Bugün" seçilince hepsi boşalıyordu.

### B4. Filo arıza özeti (DTC) — Reveal'da doğrudan karşılığı YOK
- Reveal'ın Dashboard'unda arıza tile'ı yok; **tile dili** (sabit başlık + satırlar + `border-t` scope şeridi) aynen uygulanır, içerik bizim.
- Yeri: tile ızgarasının ALTINDA, Operasyon Özeti'nin ÜSTÜNDE (filo sağlığı → günlük operasyon sırası).
- Satır: **plaka** (mono `.nums`, 92px) · **aktif arıza sayısı rozeti** (3+ = `--destructive`, 1-2 = `--accent-gold`) · **en uzun süredir açık kod** + gün + tarih · chevron. Satır → `/admin/araclar/{id}#dtc`.
- **ŞİDDET GÖSTERİLMEZ — veri yok:** `vehicle_dtc`'de severity kolonu yok; `lib/dtc-codes.ts` sözlüğü yalnız düz metin `title/part/symptoms/risk` tutuyor, karşılaştırılabilir seviye alanı yok. "En kritik kod" uydurulmadı; yerine veriden gerçekten türeyen aciliyet sinyali kullanıldı: **en eski `first_seen`** (= en uzun ihmal edilmiş arıza). Renk yalnız arıza SAYISINA bağlı (bu da veri).
- Aktif arızası olan araç yoksa kart hiç render edilmez (boş-durum ekonomisi).

### B3. Dikkat/Aksiyon + Vardiya kayıtları
- Reveal dashboard'da yok ama bizim çekirdek işlev. Tile ızgarasının ALTINDA: kompakt "Dikkat/Aksiyon" şeridi (varsa) + mevcut Vardiya KPI + filtre + DataTable (korunur).

---

## E. ARAÇLAR ekranı (Reveal: Live Map araç paneli)

**Referans:** `competitor-shots/fleet-status-location.png` — Reveal'ın canlı-harita sol paneli. Satır anatomisi: **ad/plaka bold** + sinyal ikonu + kebab; altında durum noktası + "Stopped"; "Last Movement 21/07 13:03"; adres; grup.

### E1. Başlık bloğu
- A2 ile aynı ölçü: H1 ~28px semibold + açıklama ~14px `--muted-foreground`.
- Kabuğa `title` prop'u geçilmez (prop yokken kabuk nav'daki aktif etiketi kullanır — aynı sonuç).

### E2. KPI şeridi
- 4 kart (Toplam · Sevkiyatta · Molada · Boşta). Reveal panelinde KPI yok; bizim çekirdek işlev, **StatCard dili** korunur.

### E3. Filtre bandı (A3 dili birebir)
- Tek satır tint band: **"Durum"** (Tümü/Sevkiyatta/Molada/Boşta/Bakımda) + **"Sırala"** (Plaka/Şoför/Durum) dropdown'ları solda; **arama + "Araç Ekle"** sağda (`right` slot).
- Reveal'ın "Order by Driver" tek dropdown'ı + arama ikonu deseninin karşılığı. Çip YOK.

### E4. Liste satırı
- Sol renk şeridi = canlı durum (`STATUS_STYLE.stripe`). İkon kutusu + **plaka** (mono `.nums`, bold, uppercase) + marka/model + GPS rozeti; altında şoför satırı.
- Sağda: durum çipi (canlı nokta) + düzenle + sil + chevron → araç detayı.

### E5. Bilinçli sapma — "Son hareket" YOK
- Reveal satırında "Last Movement" + adres var; bizde **eklenmedi**. Gerekçe: `listLatestVehiclePositions` sayfalanmıyor (60 dk penceresinde filo geneli 1000 satır tavanını aşabilir → bazı araçların son sinyali sessizce düşer), araç başına sorgu ise 28 tur demek. Uydurma/eksik veri göstermektense hiç göstermiyoruz. Doğru çözüm ayrı bir iş: `vehicle_id`'ye göre `distinct on` view'ı veya sayfalı toplu okuma.

---

## F. SEFERLER ekranı (Reveal'da birebir karşılığı yok → klon dili uygulanır)

- **F1.** A2 başlık bloğu (H1 28px semibold + açıklama).
- **F2. Sekme şeridi KALDIRILDI → filtre bandı.** Eski `Tabs` (Bugün/Yarın/Bu hafta/Tümü) A3 dilinde **"Gösterilen"** dropdown'ına taşındı. Gerekçe: Reveal tarih kapsamını sekmeyle değil filtre bandındaki dropdown ile seçer (Alerts "Show alerts triggered" birebir). Sekme şeridi Reveal'da **görünüm** değiştirir (Overview vs Alert log), **kapsam** değil.
- **F3.** İkinci dropdown **"Durum"** (Tümü/Atandı/Başladı/Tamamlandı/İptal) — Reveal Alert Log'un Priority filtresinin karşılığı. Sağda "Yeni Sefer".
- **F4.** Sefer kartları korunur (sol renk şeridi = durum).

## G. HARİTA ekranı (Reveal: Live Map — birebir referans)

**Referans:** `competitor-shots/fleet-status-location.png`.

- **G1.** A2 başlık bloğu.
- **G2.** Harita + sağda 360px panel düzeni (Reveal: harita + sol panel; bizde sidebar zaten solda olduğu için panel sağda — kabuk kararı, kapsam dışı).
- **G3. Panel sekme şeridi (Reveal birebir).** Reveal panelinde grup/araç ikon sekmeleri var → bizde **"Şoförler (n) · Araçlar (n)"** (SubTabs, A1 dili).
  - **Kapatılan gerçek boşluk:** araçlar haritada görünüyordu ama panelde **listelenmiyordu**; Reveal paneli araçları listeler.
- **G4. Araç satırı:** plaka (mono `.nums`, bold) + kontak durum noktası (açık=sky / kapalı=gri) + "Kontak açık/kapalı"; altında hız (km/h) + son sinyal saati. Satır → araç detayı. Tüm alanlar `ActiveVehicle`'dan gerçek veri (uydurma yok).
- **G5.** Reveal satırındaki **adres** yok: ters-jeokodlama servisimiz yok, uydurulmaz.

---

## C. Ortak stil (her iki ekran)
- Palet: koyu zemin (`#0a0d16` + aurora), yüzey `--card`, vurgu **bordo** `--accent-claret`/`#8a1538` (Reveal kırmızısının yerini alır), bilgi `--accent-sky`, kritik `--status-critical`.
- Tipografi: Reveal ölçekleriyle eşleşir (H1 ~28px semibold, tile başlık ~15-16px bold, etiket ~11-12px, değer ~13-14px, sayısal `.nums`).
- Reveal'ın **beyaz zemini yerine koyu**; **kırmızı vurgusu yerine bordo**; gerisi (yerleşim, bar ranking, tile ızgarası, sekme+filtre düzeni, satır yükseklikleri) birebir.

---

## D. Kanıt yöntemi
- Klon sonrası her ekran 1440px'de screenshot; Reveal referansıyla **yan yana** `scratchpad/clone-proof/`'ta birleştirilir (HTML+Playwright kompozit). Fark görülürse kapatılıp tekrar çekilir. Repoya yalnız BİZİM ekranlar; Reveal görüntüleri yerelde kalır (telif).
