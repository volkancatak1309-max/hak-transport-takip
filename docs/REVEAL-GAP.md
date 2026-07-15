# HAK61 — Reveal Gap & Yeniden Yapım Planı

**Tarih:** 15.07.2026 · **Statü:** Volkan onayı bekliyor — bu plan onaylanmadan iki sayfada kod yazılmayacak.
**Kapsam:** Yalnız Alarmlar + Yönetici. Diğer 8 sayfaya bu iki sayfa onaylanana kadar dokunulmaz.

**Bugatti testi (yeni):** "Bu ekranı Reveal'ın yanına koysam utanır mıyım?" Utanıyorsak bitmemiştir.

---

## 0. Yöntem ve kaynaklar

Her görsel karar bir kaynağa dayanır. Üç kaynak katmanı:

1. **Verizon Connect Reveal** — 4 gerçek ekran görüntüsü (Alerts Overview, Dashboard, Notifications, Live Map) doğrudan incelendi + ekran-ekran derin araştırma (Alert Summary/Rank, Alert Log, alarm detay penceresi, bildirim çekmecesi). Referanslar `reveal-help.verizonconnect.com` yardım makaleleri.
2. **Refero (gerçek ürün ekranları)** — panel/analytics kategorisinden gerçek ekranlar; her birinin UUID + canlı URL'i aşağıda. En değerlileri (Resend koyu analytics, Dub analytics) **gerçek görsel olarak** incelendi; diğerleri Refero metadata'sından.
3. **Awwwards 279-bileşen paketi** — değerlendirildi; sonuç Bölüm 4'te (özetle: panele uygun **veri bileşeni içermiyor**, gerekçesiyle reddedildi; 1 ince motion disiplini alındı).

**Teşhis (bağımsız denetçi ajanının kararı):** *"Altyapı doğru, davranış eksik."* Primitiflerimiz (StatCard, DataTable, FilterBar, DetailDrawer) kaliteli; sorun **birbirine bağlanmamaları** — kartlar drill'siz, özet katmanı yok, görselleştirme yok. Yani sıfırdan atmıyoruz; **bağlıyoruz + görselleştiriyoruz**.

---

## 1. Asıl mesele: yaklaşım farkı

| | **Reveal** | **Biz (şu an)** |
|---|---|---|
| Zihinsel model | **Özet → drill hunisi**: Overview tile → Alert Summary (trend + Rank) → olay detayı | Düz kronolojik olay dökümü; özet katmanı yok |
| Kartlar | Her tile bir **giriş kapısı** (tıkla → trend + o alarmı en çok tetikleyen araçlar) | "En Çok Alarm"/"En Sık Tip" kartları **ölü** — tıklanınca hiçbir şey olmuyor |
| Yoğunluk | "Most triggered" sıralama + benchmark renk → önemli 5'i öne taşır | 159 olay eşit ağırlıkta gri chip; kritikler ayrışmıyor |
| Görsel | Baştan sona **yatay bar chart** (karşılaştırma, ranking) | Donut + 3 boş kutu; tek grafik yok → "koyu temaya boyanmış tablo" |
| Filtre | Net tek eksen; seçili değer okunur | "Tümü" görünmüyor; Şiddet+Tip mükerrer |

**Sonuç:** Müşterinin "amatör / koyu temaya boyanmış tablo" cümlesi bu 5 satırın tam karşılığı. Çözüm koyu temayı değil, **etkileşim + görselleştirme + özet-drill hiyerarşisini** getirmek.

---

## 2. Volkan'ın 4 somut hatası — her biri kaynakla çözülüyor

| # | Hata | Kök neden (kod) | Kaynak-temelli çözüm |
|---|------|-----------------|----------------------|
| 1 | Filtrede "Tümü" yok | `FilterBar.tsx:87` — value boşken trigger alan adını ("Şiddet") gösteriyor, "Tümü"yü değil | **Dub filter-chip modeli** (Refero `eb41f99a`): aktif filtreler × ile kaldırılabilir çip olarak görünür + "Clear Filters"; boş = çip yok. "Tümü" kavramı çipin yokluğuyla ifade edilir — Reveal Alert Log filtre bandındaki "All alerts/All types" mantığının çip hali. |
| 2 | Şiddet dropdown'ı Tip ile mükerrer | `AlarmsClient.tsx:78` — şiddet zaten `eventTone(event_type)`'dan türüyor, bağımsız eksen değil | **Şiddet dropdown'ı SİLİNİR.** Tek eksen: tip filtresi (çip). Şiddet renkte + "Sadece kritik" tek toggle'ında yaşar (Reveal "Order by Status → acil üstte" + tek "Priority" filtresi). |
| 3 | "En Çok Alarm" kartı ölü | `AlarmsClient.tsx:164` — StatCard'a href/onClick yok; `topVehicle` sadece `[0]` alınıyor | **Dub breakdown kartı** (`eb41f99a`) + **Reveal "Rank"**: kart → **"Araca göre" sekmeli breakdown paneli**: top-5 araç sıralı bar + sayı; plakaya tıkla → o araca filtreli log. `byVehicle` Map zaten var, `.slice(0,5)` yeter. |
| 4 | "En Sık Tip" kartı ölü | `AlarmsClient.tsx:172` — aynı | **Dub breakdown kartı** "Tipe göre" sekmesi: top-5 tip sıralı bar + sayı; tipe tıkla → o tipe filtreli log. |

---

## 3. Bileşen referans tablosu — her bileşen 2-3 gerçek referans

> Kural: aşağıdaki her bileşen bu referanslara dayanacak. "Bence güzel" yok.

### 3.1 KPI / özet başlık
| Referans | Kaynak | Ne alıyoruz |
|---|---|---|
| Resend Metrics (koyu) | Refero `ff328c72` · resend.com/metrics · **görsel incelendi** | Büyük ince KPI sayısı (`8 EMAILS`, `100%`), üstte hizalı; sağ üstte tek satır filtre grubu (All Domains · Last 7 days · All Events). Koyu zeminde yüksek kontrast = premium referansımız. |
| Dub Analytics | Refero `eb41f99a` · app.dub.co/analytics · **görsel incelendi** | 3 büyük KPI kartı yan yana; **aktif olanın altında ince accent çizgi** (seçili sekme hissi). Sayı > etiket ölçek farkı net. |
| Reveal Alerts Overview tile | Reveal ekran görüntüsü | Tile = ad + tip + "Last triggered" + sayı + **okunmamış kırmızı rozet**. Bizim özet kartlarımıza "son tetiklenme + okunmamış" bilgisini ekleteceğiz. |

### 3.2 Filtre
| Referans | Kaynak | Ne alıyoruz |
|---|---|---|
| Dub filter chips | `eb41f99a` · **görsel** | `Tag is refero ×`, `Country is United States ×`, `Device is Mobile ×` + **"Clear Filters"**. Aktif filtre daima görünür çip; "Tümü" = çip yokluğu. (Volkan hata #1) |
| Gladia (koyu admin) | Refero `d7c5e5e0` · app.gladia.io | Koyu zeminde filtre çipleri + durum dropdown'ı + toplu işlem; düşük kontrast profesyonel ton. Koyu tabuda çip stili referansı. |
| Reveal Alert Log filtre bandı | Reveal araştırma | "Show alerts triggered: Today" + "Sort by: Most triggered" — **tek anlamlı eksen**, seçili değer trigger'da okunur. |

### 3.3 Breakdown / drill kartı (Volkan #3-4'ün kalbi)
| Referans | Kaynak | Ne alıyoruz |
|---|---|---|
| Dub breakdown cards | `eb41f99a` · **görsel** | 2×2 ızgara; her kartın üstünde **sekmeler** (Countries/Cities/Regions/Continents), sağda "CLICKS" etiketi; gövdede **sıralı liste + satır arkasında yatay bar + sağda sayı**. Bu birebir "Araca göre / Tipe göre" breakdown'ımız. |
| Reveal Alert Summary → Rank | Reveal araştırma | "Rank" = alarmı en çok tetikleyen araçların sıralı listesi; segment'e tıkla → o dönemin rank'i. Drill mantığımızın omurgası. |
| Stellate | Refero `efd65c62` · stellate.co | Metriğe tıkla → **side-sheet** ile detay (operations summary). Drawer-tabanlı drill deseni. |

### 3.4 Veri tablosu (Alarm Log)
| Referans | Kaynak | Ne alıyoruz |
|---|---|---|
| Gladia koyu tablo | `d7c5e5e0` | Koyu, düşük kontrast, 7 kolon, satır aksiyonları, toplu seçim — bizim DataTable zaten buna yakın; renk/kontrast kalibrasyonu referansı. |
| Enode koyu gruplu tablo | Refero `5b7b3988` · enode.com | **Marka-gruplu satırlar** + durum rozetleri; bizim storm-gruplamamızın görsel dili. |
| Reveal Alert Log | Reveal | Kolonlar (Vehicle/Driver/Alert/Type/Date/Priority), **bold=okunmamış**, satır→detay, "Items per page 1-10 of 500" sayfalama. |

### 3.5 Trend grafiği (yeni — "boyanmış tablo" itirazının panzehiri)
| Referans | Kaynak | Ne alıyoruz |
|---|---|---|
| Resend trend | `ff328c72` · **görsel** | Çok-çizgili trend + **zengin hover tooltip** (Mar 09 · Delivered 3 · Opened 2, renk noktalı). Alarm trendimiz: seçili aralıkta gün/gün olay sayısı. |
| Exa bar chart | Refero `ccc4661c` · dashboard.exa.ai | Bar'a hover → tam değer tooltip. Reveal Alert Summary bar grafiğinin karşılığı. |
| Reveal Alert Summary bar | Reveal | Aylık tek-bar trend + "segmenti seç → rank". Bizde: tarih segmentine tıkla → o günün olayları. |

### 3.6 Detay drawer / side-sheet
| Referans | Kaynak | Ne alıyoruz |
|---|---|---|
| Reveal alarm detay | Reveal ekran araştırma | Breadcrumb + iki sütunlu alan gridi + **mini-harita + kırmızı pin + adres**. Bizim drawer'a **mini-harita** eklenecek (şu an sadece koordinat + link). |
| Stellate side-sheet | `efd65c62` | Sağdan detay paneli, bağlam kaybı yok. |
| Bizim DetailDrawer | mevcut | prev/next gezinme + footer aksiyonları — audit "Reveal seviyesinde temiz, koru" dedi. Korunuyor. |

### 3.7 Dashboard ranked-bar tile (Yönetici)
| Referans | Kaynak | Ne alıyoruz |
|---|---|---|
| Reveal Dashboard | Reveal ekran görüntüsü | 6 tile hepsi **yatay bar ranking** (Harsh Driving/araç `0/9/32`, Distance, Stop Duration); benchmark renkli, aykırı tek bakışta. "Şoför Performans Sıralaması"nı ve "en çok alarm üreten araç"ı bar ranking yapacağız. |
| Shopify Analytics | Refero `4df8dcdc` · admin.shopify.com/analytics | KPI tile ızgarası + özelleştirilebilir; boş-durum ekonomisi referansı. |

---

## 4. Awwwards paketi — dürüst değerlendirme

`C:\Users\90553\Desktop\awwwards\300-bilesen\` (279 bileşen, KATALOG.md okundu).

**Karar: panel için kullanılmıyor — 1 istisna.** Paket **baştan sona landing-page motion efekti**: Background/Grid/Physics/SVG/Text animasyonları, WebGL-ThreeJS, Hero/Scroll animasyonları, Mouse efektleri. İçinde **tek bir veri bileşeni yok** (tablo/KPI kartı/filtre/drawer yok). Neredeyse tamamı bizim tasarım sistemimizin **§12 yasaklarını** (neon, glow, bounce/spring, parallax, gradyan animasyonu) ve Volkan'ın "abartısız, veri-dostu" talimatını ihlal eder. Reveal'ın yanına konulacak bir filo panelinde parçacık/sıvı-metal/scramble efekti **Bugatti testinden geçmez**.

- **Reddedilenler (gerekçeli):** tüm Background/Physics/SVG/WebGL/Hero/Scroll/Text kategorileri — landing-page gösterisi; veri panelinde dikkat dağıtır, yasak motion sınıfına girer.
- **Alınan tek disiplin:** `+10 Grid Animations / 8` (Metalab tarzı **hover-reveal**) — satır üstüne gelince aksiyonların/detayın açığa çıkması fikri; **efekt olarak değil, zamanlama disiplini olarak** (bizim 140-200ms Apple-curve hover kuralıyla). Zaten opacity-hover yapıyoruz; bunu satır aksiyonlarında tutarlı uygulayacağız.

> Not: Bu görev için doğru cephanelik awwwards değil, **Refero gerçek ürün ekranları + Reveal**. Awwwards paketi Galzura'nın landing/marketing işleri için değerli; veri paneli için değil. Bunu net söylemek, panele flashy efekt sokup Bugatti testinde çakılmaktan iyidir.

---

## 5. Sayfa yeniden yapım planı

### 5.1 ALARMLAR (vitrin) — "özet → drill" hunisi

**Yeni yerleşim (yukarıdan aşağı):**

1. **Başlık şeridi:** "Alarmlar" + tarih aralığı SegmentedControl (Bugün/7g/30g) — korunuyor. Sağına "Sadece kritik" toggle (Reveal Priority filtresi).
2. **KPI şeridi (4 kart, Resend/Dub):** Toplam olay · Kritik · **Bugün vs dünkü değişim** (yeni, trend hissi) · En yeni kritik olay zamanı. Sayılar büyük, kapsam etiketli.
3. **Trend + Breakdown satırı (YENİ — asıl fark):**
   - Sol: **alarm trendi bar/çizgi grafiği** (Resend/Exa) — seçili aralıkta gün/gün olay; bar'a hover → o günün sayısı; bar'a tıkla → o güne filtre.
   - Sağ: **Breakdown kartı** (Dub `eb41f99a`), üstte iki sekme **"Araca göre" / "Tipe göre"**; sıralı top-5, her satır: ad + arkada yatay bar (max'a göre) + sayı; **satıra tıkla → aşağıdaki log o araca/tipe filtrelenir** (Volkan #3-4). Kritik olanlar renkli.
4. **Filtre çipi bandı (Dub):** aktif filtreler çip (× ile) + "Temizle". Şiddet dropdown YOK (Volkan #2). Arama plaka **+ sürücü + adres** (audit: tek eksen zayıf).
5. **Alarm Log (DataTable):** varsayılan sıralama **önce kritik, sonra en yeni** (Reveal "Most triggered/Order by Status"); storm gruplama korunur ama bir üst katmana bağlı; kritik satır görsel olarak yükseltilir (güçlü stripe). Kolon: Zaman · Araç · Olay (renkli chip) · Hız/bağlam · (Uzun Rölanti'de "0 km/h" yerine süre gösterilir — audit).
6. **Satır → DetailDrawer:** mevcut + **mini-harita** eklenir (Reveal alarm detayı: pin + adres).

**Böylece:** ölü kartlar → drill kapısı; düz firehose → özet+drill+trend; "Tümü yok" ve mükerrer filtre → tek çip sistemi.

### 5.2 YÖNETİCİ — görselleştirme + boş-durum ekonomisi

1. **Operasyon şeridi:** 8 tile'ın 6'sı "—"/0 (audit). **Boş metrikleri tek "Bugün henüz sevkiyat yok" özet satırına indir**; dolu olanları öne çıkar (Reveal "her zaman dolu" ekonomisi).
2. **Filo durumu:** 28 araç hepsi "Boşta" → tek renk donut sıfır bilgi. **Yatay bar** (Reveal dashboard) veya durum başına tıklanabilir sayı-satırı; tek renkse donut yerine "28 araç · hepsi boşta" özet.
3. **Şoför Performans Sıralaması → gerçek ranked-bar** (Reveal Harsh Driving tile / Shopify): her sürücü satırı arkasında bar; en çok alarm/km/aşım bar uzunluğuyla. Bu tam Reveal'ın ranked-bar yeri; şu an boş liste.
4. **3 dev boş kutu → birleştir/gizle:** veri yoksa panel tek satıra iner veya gizlenir (audit: ekranın yarısı boş kutu).
5. **Vardiya DataTable + drawer:** audit "gerçekten iyi, koru" dedi — **korunuyor**, sadece üstündeki bölüm görselleştiriliyor.

---

## 6. Koruduklarımız (audit'in "güçlü yönler"i)

- Storm/gruplama mantığı (10 dk pencere) — Reveal "15 more" roll-up'ının karşılığı; özet katmanının çekirdeği olacak.
- Sol renkli stripe + StatusChip tonlama — doğru; kritik için güçlendirilecek.
- DetailDrawer (prev/next + Düzenle/Sil) — Reveal seviyesinde temiz.
- Vardiya DataTable (yoğun, sıralanabilir, .nums, 9h+ rozet, satır menüsü) — "boyanmış tablo" değil, düzgün tablo.
- Tasarım sistemi primitifleri tek kaynaktan — sağlam; sorun bağlanmamaları, o düzeltilecek.

---

## 7. Volkan'a onay soruları

1. **Trend grafiği:** Alarmlar'a gün/gün alarm trendi bar grafiği ekleyelim mi (Resend/Reveal deseni), yoksa breakdown kartları + log yeterli mi? (Grafik "boyanmış tablo" itirazının en doğrudan panzehiri.)
2. **Breakdown yerleşimi:** "Araca göre / Tipe göre" tek breakdown kartında **sekme** mi (Dub), yoksa iki ayrı kart mı olsun?
3. **Yönetici kapsamı:** Bu turda Yönetici'de performans-ranking-bar + boş-durum temizliği yapalım; OpsSummary'nin tamamen yeniden kurgusu (8→daha az, ranked) bu tura mı, ayrı tura mı?
4. **Mini-harita drawer'da:** Alarm detay drawer'ına Leaflet mini-harita (Reveal deseni) — onaylıyor musun? (Harita altyapısı mevcut, ek bağımlılık yok.)

Onay + bu 4 soruya cevap sonrası kod yazımına başlanır. Kod turunda her commit yine canlı veriyle Playwright'la doğrulanıp preview'a çıkar.
