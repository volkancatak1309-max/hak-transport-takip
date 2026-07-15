# HAK61 Panel — UX Denetimi (FAZ 0)

**Tarih:** 15.07.2026
**Kapsam:** Admin paneli (Yönetici, Alarmlar, Araçlar, Araç Detay, Seferler, Harita, Yakıt, Masraflar, Bölgeler, Çalışanlar, Telegram). Şoför paneli ve login **kapsam dışı**.
**Metodoloji:**
- **Kod denetimi:** Sayfa başına 1 agent, toplam 12 agent (11 sayfa + 1 tasarım sistemi / kesişen desen envanteri). Kaynak kod, sorgu ve bileşen düzeyinde inceleme.
- **Görsel denetim:** Ekran görüntüsü başına 1 vision agent, toplam 15 agent. Görüntüler 15.07.2026'da canlı veriden alındı: 1440×900 masaüstü (14 ekran) + 390×844 mobil (4 ekran, tek toplu raporda). Görüntüler repoya commit edilmedi.
- **Console/hata taraması:** Playwright ile sayfa gezinerek console mesajları toplandı.

**Hedef ilke:** Yönetici her ekranda **5 saniyede doğru veriyi bulabilmeli**; tüm tasarım kararları **26-28 araçlık filo ölçeğinde** çalışmalı.

> **Gizlilik notu:** Denetim canlı müşteri verisiyle yapıldı; rapordaki plakalar anonimleştirildi (Araç-A…Araç-E gerçek plakaların yer tutucusudur, eşleme repoya yazılmadı).

---

## 1. Yönetici Özeti — En Kritik 10 Bulgu

| # | Bulgu | Etki | Kanıt |
|---|-------|------|-------|
| 1 | **Limitsiz / sessizce kesilen sorgular her yerde.** Dashboard aralık sorgusu, seferler, yakıt, masraflar, çalışanlar (aylık time_entries), harita rota noktaları limitsiz; Supabase 1000 satırda sessizce keser. Bakım `limit(100)`, dikkat listesi `limit(50)`, alarmlar `limit(100)` — hiçbirinde "daha fazlası var" göstergesi yok. | Toplam saat/km, performans skoru, Excel/PDF/CSV raporları **uyarısız eksik hesaplanır**; eski kayıtlar erişilemez olur. | `app/admin/page.tsx:76-81`, `lib/admin-dashboard.ts:137-141`, `app/actions/assignments.ts:309-315`, `app/actions/fuel.ts:203-209`, `app/admin/workers/page.tsx:23-26`, `app/admin/harita/page.tsx:63-69`, `app/actions/maintenance.ts:95-99` |
| 2 | **Dashboard ortasındaki dev 3D kaplan logosu filigranı veri kartlarının üzerine biniyor** — "Araç Durum Dağılımı" ve "Dikkat/Aksiyon" kartlarını fiziksel olarak örtüyor (1440px'te doğrulandı). | Panelin ilk ekranı veri yerine dekor gösteriyor; premium algı tek başına burada çöküyor. | Ekran görüntüsü: dashboard 1440px (görsel denetim + ana denetçi tespiti) |
| 3 | **Harita sayfasında üç çelişen sayı:** KPI "HARİTADA 0", haritada 4 araç etiketi (Araç-C, Araç-D, Araç-A, Araç-E), kart köşesinde etiketsiz "16". KPI yalnız sürücüleri sayıyor, başlık sayısı sürücü+araç toplamı. | Canlı takip ekranında sayı tutarsızlığı yöneticinin veriye güvenini kırar. | `app/admin/harita/page.tsx:140` vs `app/admin/harita/LiveTrackingClient.tsx:84-86`; ekran görüntüsü: harita 1440px |
| 4 | **Alarmlar sayfası taranamaz log duvarı:** Araç-A tek başına onlarca ardışık satır üretmiş (dakika arayla Sert Viraj/Ani Hızlanma/Sinyal Karıştırma); gruplama, filtre, sayfalama yok; sayfa 4087px. En ciddi olay (jamming) en soluk gri rozette, rutin olaylar turuncu. | Kritik güvenlik olayı gürültüde kaybolur; "kritik bir şey oldu mu?" sorusu cevaplanamaz. | `app/admin/alarmlar/page.tsx:10`, `lib/telemetry.ts:220-228`, `lib/event-ui.ts:23-28`; ekran görüntüsü: alarmlar 1440px + mobil |
| 5 | **Araçlar listesi operasyonel veri taşımıyor:** 28 satırın hepsi aynı — plaka + "Boşta" rozeti + GPS rozeti + "—" şoför; son sinyal, konum, km yok; satır ortasının ~%60-70'i boş. Liste fiilen bir plaka dizini. | Filo takip panelinin ana listesinden "hangi araç farklı/sorunlu?" sorusuna cevap alınamıyor — süre 5 sn değil, sonsuz. | `app/admin/araclar/AraclarClient.tsx:204-296`; ekran görüntüsü: araçlar 1440px |
| 6 | **Projede tek bir `loading.tsx` yok** ve tüm sayfalar force-dynamic. Araç detay/rota SSR'ı OSRM'i (chunk başına 6 sn timeout) ve tam günlük track sorgusunu bekliyor. | Her sayfa geçişi iskeletsiz "donmuş navigasyon" olarak hissedilir; veri büyüdükçe kötüleşir. | Glob `app/**/loading.tsx` → 0 sonuç; `app/admin/araclar/[id]/rota/page.tsx:10,34`, `lib/route-history.ts:52` |
| 7 | **Dashboard'da 1 saniyelik `setInterval` tüm sayfayı yeniden render ediyor** — aktif vardiya varken 13 sütunlu, sayfalamasız vardiya tablosu (ay görünümünde 700+ satır) her saniye reconcile ediliyor. | Ay görünümünde panel hissedilir derecede kasılır. | `app/admin/AdminClient.tsx:157-161, 553-689` |
| 8 | **Kırmızı/bordo renk semantiği çakışması (tüm ekranlar):** aynı ton marka logosu, birincil CTA, yıkıcı eylem (sil), etiketsiz toggle ve olumlu "Aktif" rozeti olarak kullanılıyor; neon glow'lu logo her ekranın en yüksek kontrastlı öğesi. | Kırmızı "sorun mu, marka mı?" ayrımı yapılamıyor; "Aktif" çalışan alarm gibi okunuyor; panel oyun arayüzü hissi veriyor. | Ekran görüntüleri: tüm masaüstü ekranlar; `components/admin/FleetStatus.tsx:13-14` (NO green/red kuralı) vs `components/admin/DriverReportsCard.tsx:130` |
| 9 | **Çalışanlar "Son Vardiya" kolonu yanlış veri gösteriyor:** yalnız bu ayın time_entries sorgusundan türetiliyor — ay başında herkes "—", geçen ay çalışmış biri hiç çalışmamış görünüyor. Görselde 4 satırın 4'ü "—". | Yönetici 5 saniyede **yanlış** veriyi bulur. | `app/admin/workers/page.tsx:23-26, 38-49`; ekran görüntüsü: çalışanlar 1440px |
| 10 | **Canlı haritada inceleme fiilen imkânsız:** FitBounds her 30 sn'lik refresh'te zoom/pan'ı tüm filoya sıfırlıyor; kümeleme yok (120px plaka pilleri üst üste binecek); aktif vardiyaların TÜM rota noktaları her 30 sn'de limitsiz yeniden çekiliyor. | 26-28 araçta harita hem okunamaz hem izlenemez hale gelir; DB/RSC yükü sürekli tekrarlanır. | `components/FleetMap.tsx:71-82, 96-102, 65-67, 114-123`, `app/admin/harita/page.tsx:63-69`, `app/admin/harita/LiveTrackingClient.tsx:50` |

---

## 2. Kesişen Bulgular (tüm sayfaları etkileyen)

### 2.1 Tasarım sistemi çelişkileri — DESIGN.md vs kod
Tasarım anayasası implementasyonla üç noktada çelişiyor; dokümana güvenen her yeni geliştirme yanlış renk/kural kullanır:
- **Bordo değeri:** DESIGN.md `#a01a33 / oklch(0.52 0.19 16)` diyor; kod açık temada `oklch(0.4 0.142 31)` ≈ `#750d02`, koyuda `#8a1538`. — `DESIGN.md:42` vs `app/globals.css:95,168`
- **"Gradient yok, aurora yasak"** kuralı vs kodda aurora zemin + 3 gradyan utility. — `DESIGN.md:79` vs `app/globals.css:229-241, 345-356`
- **"Açık/koyu toggle kullanıcıda"** vs tema zorla koyu (`forcedTheme="dark"`); `:root`'taki tam açık tema ölü kod. — `DESIGN.md:105` vs `components/providers.tsx:19`

### 2.2 KPI/istatistik kartı: 5 ayrı implementasyon
Ortak StatCard bileşeni yok (grep → 0 sonuç); değer tipografisi 18/24/28px ve semibold/bold arasında salınıyor:
1. `SummaryCard` — `app/admin/AdminClient.tsx:853-895` (Card, text-2xl semibold)
2. Harita `Kpi` — `app/admin/harita/LiveTrackingClient.tsx:153-183` (glass, text-[28px])
3. Araçlar `Kpi` — `app/admin/araclar/AraclarClient.tsx:429-459` (neredeyse aynı kopya + claret accent)
4. Yakıt/Masraflar inline Card — `app/admin/yakit/FuelAdminClient.tsx:180-212`, `app/admin/masraflar/ExpenseAdminClient.tsx:160-184` (text-lg bold, grid kırılımları da farklı: `grid-cols-2 md:grid-cols-4` vs `grid-cols-1 sm:grid-cols-3`)
5. Çalışan detay — `app/admin/workers/[id]/WorkerDetailClient.tsx:166-184` (text-2xl bold)

### 2.3 Üç tablo/liste deseni
Ham `<table>` hiç yok (iyi), ama üç paradigma yan yana yaşıyor:
1. **shadcn Table** — 7 dosya (AdminClient, Alarms, Expense, Telegram, Fuel, Workers, WorkerDetail). Başlık stili tekil değil: yalnız `AdminClient.tsx:555` sticky header + uppercase mikro-etiket kullanıyor.
2. **ul.divide-y cam liste** — `app/admin/araclar/AraclarClient.tsx:204-296`, `app/admin/harita/LiveTrackingClient.tsx:111-145`
3. **Satır-başına-kart yığını** — `app/admin/seferler/AdminAssignmentsClient.tsx:167-241`, `app/admin/yakit/MaintenanceAdminClient.tsx:104-131`

Boş durum da 3 çeşit (TableRow+colSpan / tablo dışı `<p>` / div p-10), satır durum şeridi 3 farklı taşıyıcıda (TableRow, li, kart).

### 2.4 İki paralel rozet sistemi
shadcn `Badge` (~10 kullanım) ile elle yazılmış `rounded-full bg-accent-*/15 text-accent-*` chip span'ları aynı anda yaşıyor; durum→stil eşlemeleri 4 ayrı lib dosyasına dağılmış ve hepsi aynı deseni kendi kopyasıyla tekrarlıyor. — `components/ui/badge.tsx` vs `app/admin/AdminClient.tsx:598-630`; `lib/status-ui.ts:3-17`, `lib/vehicle-ui.ts:33-62`, `lib/assignments-ui.ts:6-21`, `lib/event-ui.ts:23-28`

### 2.5 Konteyner genişliği kaosu
7 farklı max genişlik: max-w-5xl (alarmlar/masraflar/yakıt/telegram/seferler), max-w-6xl (workers), max-w-7xl (dashboard), 900px (bölgeler), 1000px (araç detay), 1100px (araçlar), 1400px (harita); `space-y-4/5/6` karışık; konteyner bazı sayfalarda page.tsx'te, bazılarında client bileşende. — `app/admin/page.tsx:177`, `app/admin/bolgeler/BolgelerClient.tsx:140`, `app/admin/araclar/AraclarClient.tsx:177`, `app/admin/araclar/[id]/VehicleDetailClient.tsx:102`, `app/admin/harita/LiveTrackingClient.tsx:59`, `app/admin/workers/page.tsx:66`

### 2.6 Çift h1
DashboardShell topbar'ı her sayfada h1 basıyor; buna rağmen 4 sayfa kendi ikinci h1'ini render ediyor (yakıt, masraflar, telegram, seferler) → aynı sayfada iki h1 (a11y + görsel çifte başlık: "Masraflar" + "Masraf Yönetimi", "Yakıt" + "Yakıt Takibi"). `font-bold` kullanımı DESIGN.md §3'ü de ihlal ediyor. — `components/dashboard/DashboardShell.tsx:221` vs `app/admin/yakit/FuelAdminClient.tsx:174`, `app/admin/masraflar/ExpenseAdminClient.tsx:154`, `app/admin/telegram/TelegramAdminClient.tsx:68`, `app/admin/seferler/AdminAssignmentsClient.tsx:147`

### 2.7 loading.tsx yokluğu (sistemik)
`app/` altında hiçbir loading.tsx yok (glob → 0). Tüm admin sayfaları force-dynamic + çoklu await'li Supabase sorguları; `components/ui/skeleton.tsx` mevcut ama route düzeyinde hiç kullanılmıyor. Her navigasyon boş bekleme.

### 2.8 Ölü kod
- **AppShell + Header** (eski üst-nav kabuğu): hiçbir sayfa kullanmıyor; Header'daki admin nav güncel değil (araçlar/alarmlar/bölgeler yok), içindeki ThemeToggle forcedTheme yüzünden işlevsiz. — `components/AppShell.tsx`, `components/Header.tsx:74-81`
- **cmdk kurulu, komut paleti bağlanmamış:** `command.tsx` tam yazılmış, tek import yok; `popover.tsx` ve `separator.tsx` de hiç import edilmiyor. — `package.json:21`, `components/ui/command.tsx`
- **HaritaClient.tsx** ölü dosya (eski Card-tabanlı harita varyantı). — `app/admin/harita/HaritaClient.tsx:22-56`
- Ölü importlar: `Badge`/`APPROVAL_BADGE` yakıt ve masraf admin'lerinde import edilip kullanılmıyor; `detail.recent` (son 15 vardiya) sunucuda hesaplanıp client'a taşınıyor ama render edilmiyor. — `app/admin/yakit/FuelAdminClient.tsx:10,38`, `app/admin/masraflar/ExpenseAdminClient.tsx:37`, `lib/vehicles.ts:179-187`

### 2.9 Filtre-URL tutarsızlığı
Üç farklı yaklaşım aynı panelde: **URL searchParams** (dashboard `app/admin/page.tsx:55-70`, rota `app/admin/rota/page.tsx:12-17`, araç rota `?date=`), **yalnız useState** (araçlar arama, seferler sekme, yakıt/masraf sekme, çalışanlar durum filtresi), **hiç filtre yok** (alarmlar, harita, bölgeler, telegram). Yenilemede/paylaşımda filtre kaybolur; desen altyapısı mevcut ama uygulanmamış.

### 2.10 format/eur() kopyaları
`eur()` helper'ı 4 dosyada birebir kopya; `nf = locale === "de" ? "de-AT" : "tr-TR"` kalıbı 6+ dosyada tekrar; `lib/format.ts`'te para/sayı formatlayıcı yok. Tarih/saat tarafı iyi durumda (9 merkezi formatlayıcı). — eur: `app/admin/masraflar/ExpenseAdminClient.tsx:47`, `app/admin/yakit/FuelAdminClient.tsx:49`, `app/actions/expenses.ts:16`, `app/actions/fuel.ts:18`

### 2.11 Görsel katman — her ekranda tekrarlanan kusurlar (görsel denetim)
- **Neon/glitch kırmızı HAK61 logosu** neredeyse her ekranın en yüksek kontrastlı öğesi — dikkat veriden markaya kayıyor.
- **Çift seçili nav görünümü:** sol menüde "Yönetici" açık zeminli pill + asıl aktif sayfa vurgusu aynı anda; hangi sayfada olunduğu tek bakışta okunamıyor (harita, bölgeler, çalışanlar, masraflar, yakıt, seferler ekranlarında bağımsız olarak raporlandı).
- **Etiketsiz kırmızı toggle** sağ üstte her ekranda; ne yaptığı okunamıyor ve kırmızı "tehlike" gibi görünüyor.
- **Avatar baş harfi uyuşmazlığı:** kullanıcı bloğunda "N" avatarı + kullanıcı adı (seferler, masraflar, araçlar ekranlarında bağımsız raporlandı).
- **Koyu temada açık (gündüz) harita karoları** — harita ve araç-rota ekranlarında tema bütünlüğünü kıran en büyük yüzey.
- **Slashed-zero mono KPI rakamları** terminal estetiği veriyor (harita, çalışan detay, araçlar).
- **Boş değer dili tutarsız:** aynı ekranda "0", "—", "Girilmedi" ve tam cümleler karışık.
- **Mobil:** üst bar ikonları ~30px (44px hedefin altında), çıkış ikonu dil ikonuna bitişik; tek navigasyon hamburger — alt tab bar yok; araç satırındaki sil/düzenle/chevron ~32px bitişik.

---

## 3. Sayfa Sayfa Denetim

### 3.1 Yönetici (Dashboard) — `app/admin/page.tsx` + `AdminClient.tsx`

**Amaç + veri kaynağı:** Komuta paneli: bugünün canlı özeti (8 kutucuk), filo durum donut'u, dikkat listesi, şoför bildirimleri, performans sıralaması, filtrelenebilir vardiya tablosu (Excel/PDF/AZG dışa aktarım). force-dynamic; ilk boyamadan önce ~12 Supabase sorgusu. Aralık ve vardiya sorgularında **limit yok** (1000 satır tavanı), driver_reports ve onaysız vardiyalar `limit(50)`.

**5 saniye testi:** **BAŞARISIZ.** Göz önce ortadaki dev 3D kaplan filigranına gidiyor; 8 KPI kartı eşit boyutta ve tümü 0/"—"; donut legend'ında sayı yok — "kaç araç boşta?" cevabı okunmuyor. Mobilde kritik bloklar (Dikkat/Aksiyon, Bildirimler) 3. ekranda.

| Önem | Kategori | Bulgu | Kanıt |
|------|----------|-------|-------|
| 🔴 | görsel-hiyerarşi | Dev 3D kaplan filigranı "Araç Durum Dağılımı" ve "Dikkat/Aksiyon" kartlarının üzerine biniyor; flat koyu arayüzle stil olarak da çatışıyor | Ekran görüntüsü: dashboard 1440px (ana denetçi tespitiyle doğrulandı) |
| 🔴 | ölçeklenme | Vardiya + aralık sorgularında `.limit()` yok → 1000 satırda sessiz kesme; Ay/Özel aralıkta toplam saat/km, performans skoru ve Excel/PDF **uyarısız eksik** hesaplanır | `app/admin/page.tsx:76-81`, `lib/admin-dashboard.ts:137-141` |
| 🔴 | ölçeklenme | shift_photos sorgusu ~700 UUID'yi `.in()` ile URL'e gömüyor; sınır aşılırsa fotoğraf rozetleri sessizce kaybolur | `app/admin/page.tsx:128-139` |
| 🔴 | performans | Aktif vardiya varken 1 sn'lik tick tüm AdminClient'ı (700+ satırlık tablo dahil) her saniye yeniden render ediyor | `app/admin/AdminClient.tsx:157-161, 553-689` |
| 🔴 | bilgi-hiyerarşisi | Donut legend'ında sayı/yüzde yok — filo neredeyse tamamen "Boşta" renginde ama kaç araç olduğu okunmuyor | Ekran görüntüsü: dashboard; `components/admin/FleetStatus.tsx` |
| 🔴 | tutarsızlık | Mükerrer/çelişen metrikler: "9 Saati Aşan" iki kez (OpsSummary=bugün, SummaryCard=seçili aralık — iki farklı sayı), KM de iki kez | `components/admin/OpsSummary.tsx:88` vs `app/admin/AdminClient.tsx:391-397`; ekran görüntüsü: dashboard |
| 🟡 | satır-detay | Satır→detay akışı yok: vardiya satırı tıklanamaz, şoför adları workers/[id]'ye link değil, AttentionList kalemleri araç sayfasına götürmüyor | `app/admin/AdminClient.tsx:590-685`, `components/admin/AttentionList.tsx:116-129`, `components/admin/DriverPerformance.tsx:193-198` |
| 🟡 | görsel-gürültü | ⓘ ikonu enflasyonu: ekranda ~20 adet bilgi ikonu (8 KPI + 4 kart + filtre + butonlar); boş-durum kutuları orta bandın yarısından fazlasını yiyor | Ekran görüntüsü: dashboard 1440px + mobil |
| 🟡 | ölçeklenme | `limit(50)` kesmeleri göstergesiz; 20 sn'de bir `router.refresh()` tüm 12 sorguyu yeniden koşturuyor (sekme sayısıyla çarpılır) | `app/admin/page.tsx:135`, `lib/admin-dashboard.ts:166`, `app/admin/AdminClient.tsx:167-170` |
| ⚪ | tutarsızlık | Silme onayı native `confirm()` (diğer akışlar Dialog); "Çalışılan" sütunu sola hizalı, sayısal blok ritmini bozuyor; sıralanabilir başlıklarda aria-sort yok | `app/admin/AdminClient.tsx:196-205, 561, 626-637`, `components/admin/DriverPerformance.tsx:156-175` |

**26-28 araçta ne kırılır:** Aylık aralık ~700-750 vardiya üretir ve 1000 satır tavanına dayanır — raporlar sessizce eksilir. shift_photos `.in()` sorgusu URL sınırını aşıp boş dönebilir. 700+ satır sayfalamasız DOM'a basılır ve 1 sn tick ile her saniye reconcile edilir — panel görünür şekilde kasılır. 20 sn'lik tam refresh × açık sekme sayısı DB yükünü katlar.

**Güçlü yönler:** Filtreler URL query'de (paylaşılabilir, geri tuşu çalışır — `AdminClient.tsx:172-181`); `.nums` tabular sayılar ve sağa hizalı sütunlar; canlı sayılar tek doğruluk kaynağından (`admin-dashboard.ts:143-149`); her kartta tasarlanmış boş durum; OpsSummary kutucukları klavye erişilebilir + tıklayınca detay dialogu; sticky tablo başlığı + durum şeridi; Vienna takvimine sabit aralık hesabı; Excel'de UTF-16LE BOM ile TR/DE karakter çözümü.

---

### 3.2 Alarmlar — `app/admin/alarmlar/`

**Amaç + veri kaynağı:** GPS cihaz olaylarını (çarpma, çekilme, sert fren, aşırı hız, rölanti, jamming…) tek kronolojik tabloda listeleyen salt-okunur sayfa. `listRecentEvents(100)` — sabit 100 kayıt, iki ardışık Supabase sorgusu (events + plakalar), force-dynamic.

**5 saniye testi:** **BAŞARISIZ.** Göz tek renk bloğu olan turuncu rozet sütununa gidiyor; "kaç kritik olay var, hangi araç sorunlu?" sorusu özet/sayaç/filtre olmadığı için cevapsız — kaydırma ve zihinsel sayım gerekiyor.

| Önem | Kategori | Bulgu | Kanıt |
|------|----------|-------|-------|
| 🔴 | ölçeklenme | Sabit 100 kayıt limiti; sayfalama/"daha fazla" yok ve limit kullanıcıya söylenmiyor; sayfa tek parça ~4087px (mobilde ~4100px, ~11 ekran kaydırma) | `app/admin/alarmlar/page.tsx:10`, `lib/telemetry.ts:220,228`; ekran görüntüsü: alarmlar + mobil |
| 🔴 | filtre-url | Hiçbir filtre yok (araç/tip/önem/tarih); URL query kullanılmıyor — oysa searchParams deseni projede mevcut | `app/admin/alarmlar/AlarmsClient.tsx:25-107`; karşılaştırma: `app/admin/rota/page.tsx:12-17` |
| 🔴 | bilgi-hiyerarşisi | Şiddet hiyerarşisi ters: jamming (hırsızlık göstergesi) soluk gri rozetle, rutin "Sert Viraj" turuncu; kritik olaylar gürültüyle eşit ağırlıkta kronolojik akışta | `lib/event-ui.ts:10-28`, `app/admin/alarmlar/AlarmsClient.tsx:56-99`; ekran görüntüsü: alarmlar |
| 🔴 | ölçeklenme | Olay fırtınaları gruplanmıyor: Araç-A dakika arayla onlarca ardışık satır üretmiş; diğer araçların tekil ama önemli olaylarını sayfa altına gömüyor | Ekran görüntüsü: alarmlar 1440px (ana denetçi tespitiyle doğrulandı) |
| 🟡 | bilgi-hiyerarşisi | Özet KPI şeridi yok ("son 24 saatte X kritik / Y uyarı"); olay "görüldü/işlendi" durumu da yok — liste hiç küçülmüyor | `app/admin/alarmlar/AlarmsClient.tsx:30-38`; ekran görüntüsü: alarmlar |
| 🟡 | veri-kaybı | `event_value` çekiliyor ama hiçbir yerde gösterilmiyor (aşırı hızda eşik değeri kayıp); satır tıklanabilir değil, detay paneli yok | `lib/telemetry.ts:225`, `app/admin/alarmlar/AlarmsClient.tsx:56-99` |
| 🟡 | görsel-gürültü | "Haritada gör ↗" linki 100+ kez aynen tekrarlıyor ve mavi ikinci bir renk şeridi oluşturuyor; tarih öneki (14.07.2026) onlarca satırda tekrar — gün başlığıyla gruplama yok | Ekran görüntüsü: alarmlar 1440px |
| ⚪ | görsel-gürültü | Jamming/rölanti satırlarında "0 km/h" bilgi taşımıyor; hücre "—" olmalı | Ekran görüntüsü: alarmlar |
| ⚪ | tutarsızlık | Çift başlık (topbar "Alarmlar" + kart başlığı "Alarmlar"); Araç–Olay sütunları arasında geniş ölü boşluk; aynı olay verisi araç detayında farklı görsel dille sunuluyor | Ekran görüntüsü: alarmlar; `AlarmsClient.tsx:70-77` vs `app/admin/araclar/[id]/VehicleDetailClient.tsx:484-491` |
| ⚪ | erişilebilirlik | Tekrarlanan "Haritada gör" linklerinde ayırt edici aria-label yok; gold rozet 12px metni açık temada kontrast riskli | `app/admin/alarmlar/AlarmsClient.tsx:86-94`, `lib/event-ui.ts:26` |

**26-28 araçta ne kırılır:** Olay hacmi katlanır; 100 kayıt limiti yalnız son birkaç saati kapsar hale gelir ve eski olaylar tamamen erişilemez olur. Tek bir aracın veya sadece kritik olayların izini sürmek imkânsızlaşır; kırmızı olaylar (crash/towing) gri/turuncu gürültünün içinde kaybolur.

**Güçlü yönler:** Merkezi severity sistemi tek kaynak ve dark-mode varyantlı (`lib/event-ui.ts`); hız sağa hizalı + tabular-nums, locale'e duyarlı format; tam TR/DE i18n; açıklayıcı boş durum metni; plaka → araç detay çapraz linki; migration eksikse sayfa çökmüyor; tablo kendi konteynerinde kayıyor, gövde taşmıyor; en yeni kayıt üstte (mobilde son olay hemen görünüyor).

---

### 3.3 Araçlar (liste) — `app/admin/araclar/`

**Amaç + veri kaynağı:** Filodaki araçların canlı durumunu (sevkiyatta/molada/boşta/bakımda), sürücüsünü ve GPS varlığını listeleyen sayfa; araç CRUD + detaya geçiş. Sunucuda 2 paralel sorgu + tek `.in()` isim çözümü (N+1 yok); veri tek seferlik fetch — canlı görünüm ama otomatik tazeleme yok.

**5 saniye testi:** **BAŞARISIZ.** KPI satırı (28/0/0/28) 2-3 saniyede okunuyor (iyi) ama liste çöküyor: 28 özdeş satır (aynı kamyon ikonu, aynı GPS rozeti, aynı "Boşta" rozeti, aynı "—" şoför) hiçbir ayrım sinyali vermiyor — liste fiilen plaka dizini.

| Önem | Kategori | Bulgu | Kanıt |
|------|----------|-------|-------|
| 🔴 | bilgi-hiyerarşisi | Satırlarda hiçbir operasyonel veri yok: son konum, son sinyal zamanı, hız, km görünmüyor; satır ortasının ~%60-70'i boş bant | `app/admin/araclar/AraclarClient.tsx:209-294`; ekran görüntüsü: araçlar 1440px |
| 🔴 | görsel-gürültü | 28 satırda aynı "Boşta" rozeti + kesintisiz amber sol şerit + 28 kez GPS rozeti — durum bilgisi ayrım yaratmıyor; tekdüze olan bastırılmalı, farklı olan öne çıkmalıydı | Ekran görüntüsü: araçlar (ana denetçi tespitiyle doğrulandı); `lib/vehicle-ui.ts:36,50` |
| 🔴 | filtre-url | Durum filtresi yok, KPI kartları tıklanabilir filtre değil, arama yalnız useState (URL'e yazılmıyor); sütun başlığı/sıralama da yok | `app/admin/araclar/AraclarClient.tsx:51, 73-82, 429-459` |
| 🟡 | bilgi-hiyerarşisi | Muayene (inspection_due) ve sigorta (insurance_due) formda giriliyor ama listede hiç gösterilmiyor — vade kaçırma riski araç sayısıyla lineer büyür | `AraclarClient.tsx:395-416` (formda) vs `209-294` (satırda yok); `lib/types.ts:132-133` |
| 🟡 | bayat-veri | "Canlı" durum çipleri + pulsing nokta ama veri tek seferlik fetch — sayfa açık kaldıkça bayatlıyor (araç detay 30 sn'de yenilenirken liste hiç yenilenmiyor) | `AraclarClient.tsx:261` vs `app/admin/araclar/[id]/VehicleDetailClient.tsx:93-99` |
| 🟡 | güvenli-eylem | Silme (çöp) butonu her satırda kalıcı açıkta, düzenlemenin bitişiğinde; onay native `confirm()`; mobilde üç ikon ~32px bitişik | `AraclarClient.tsx:166, 268-291`; ekran görüntüsü: araçlar + mobil (ana denetçi tespiti) |
| 🟡 | boş-durum | Arama eşleşmeyince de "Henüz araç yok" gösteriliyor — araçlar varken yanıltıcı; gerçek boş durumda "Araç Ekle" CTA'sı yok | `AraclarClient.tsx:205-206`; `messages/tr.json:426` |
| ⚪ | veri-hijyeni | Araç-B satırında marka/model "X X"; Araç-A'da "fiat ducato" küçük harf; 25 satırda model alanı boş — girişte normalizasyon yok | Ekran görüntüsü: araçlar (ana denetçi tespitiyle doğrulandı) |
| ⚪ | bilgi-hiyerarşisi | KPI satırında "Bakımda" kartı yok (sayı hesaplanıyor ama render edilmiyor); dashboard FleetStatus 4 durumu da gösteriyor | `AraclarClient.tsx:68-71` vs `179-184`; `components/admin/FleetStatus.tsx:11` |
| ⚪ | erişilebilirlik | Arama girdisinde aria-label yok; aynı detaya giden iki ayrı Link (çift tab durağı); mobilde ⓘ ikonu ekran kenarında kırpılıyor | `AraclarClient.tsx:190-195, 219-222, 285-291`; ekran görüntüsü: mobil |

**26-28 araçta ne kırılır:** Teknik olarak kırılmaz (tek sorgu, makul boyut) ama kullanılabilirlik düşer: "bakımdaki 3 aracı bul" görevi ~1700-1800px görsel taramaya döner; KPI'lardan listeye köprü yok; durumlar sayfa açıkken bayatlar; muayene/sigorta vadeleri görünmediği için kaçırma riski artar.

**Güçlü yönler:** Plaka birincil bilgi (bold, uppercase, mono/nums) — çekirdek hiyerarşi doğru; durum renk dili tek kaynaktan (`lib/vehicle-ui.ts`) ve dashboard ile tutarlı; Türkçe locale-aware arama (İ/ı sorunu çözülmüş); form erişilebilirliği (Label htmlFor, aria-label'lı ikon butonlar); verimli sunucu sorguları; mobilde kademeli sadeleşme (marka/model ve GPS rozeti gizlenir).

---

### 3.4 Araç Detay + Rota Replay — `app/admin/araclar/[id]/` (+ `/rota`)

**Amaç + veri kaynağı:** Tek aracın derin görünümü: 13 alanlık canlı telemetri (FMC003), bugünün hesaplanmış metrikleri (motor saati/mesafe/rölanti/geofence), aktif DTC'ler, son 10 olay, sürücü/vardiya/ceza/belge. 6 paralel Supabase sorgusu (Promise.all); cezalar **limitsiz**, olaylar sabit 10. Rota sayfası 3 günlük UTC pencereden track çekip (gereken verinin ~3 katı) OSRM demo sunucusuyla yol eşliyor; 30 sn'de bir görünürlük-duyarlı `router.refresh()`.

**5 saniye testi:** Detay **teknik olarak geçiyor ama yalnız sayfa boş olduğu için** — 4 tam genişlik boş kart üst üste, gerçek veri fold altında. Rota replay **BAŞARISIZ:** "Bu tarihte cihaz verisi yok" mesajı açık harita üzerinde neredeyse görünmez; oynatma çubuğu aktifmiş gibi durduğundan ekran "yükleniyor" hissi veriyor.

| Önem | Kategori | Bulgu | Kanıt |
|------|----------|-------|-------|
| 🔴 | boş-durum | "Boş durum duvarı": 4 tam genişlik kart (Canlı Konum, Arıza, Bölge olayları, Son Olaylar) tek satırlık "yok" cümleleri için ilk ~550px'i işgal ediyor; gerçek veri (plaka, durum, belgeler) fold altına itilmiş; hiçbirinde sonraki adım önerisi yok | Ekran görüntüsü: araç detay 1440px |
| 🔴 | yükleme | loading.tsx yok + rota SSR'ı OSRM map-matching'i (chunk başına 6 sn timeout) ve tam günlük track'i bekliyor → listeden detaya/rotaya geçiş saniyelerce donmuş navigasyon | `app/admin/araclar/[id]/rota/page.tsx:10,34`, `lib/route-history.ts:52`, `app/admin/araclar/[id]/page.tsx:21,33-40` |
| 🟡 | bilgi-hiyerarşisi | Detayda harita yok — anlık konum ham koordinat metni (`toFixed(5)`); "araç şu an nerede?" 5 saniyede cevaplanamıyor; rota linki sayfanın en dibinde | `VehicleDetailClient.tsx:195-197, 602-612` |
| 🟡 | bilgi-hiyerarşisi | 13 telemetri alanı eşit görsel ağırlıkta (hız/kontak ile GSM sinyali/akü voltajı aynı boyutta); sayfa üstünde KPI şeridi yok — günün özet metrikleri "Canlı Konum" içine gömülü | `VehicleDetailClient.tsx:147-259, 266-337` |
| 🟡 | ölçeklenme | 30 sn'de bir refresh her seferinde tam günlük track'i (gün sonuna doğru binlerce satır) çekip 4 metriği sıfırdan hesaplıyor; rota sayfası gün başına ~3 günlük satır transfer ediyor | `VehicleDetailClient.tsx:93-99`, `lib/telemetry.ts:388-428`, `lib/route-history.ts:119-126, 259-268` |
| 🟡 | dış-bağımlılık | Yol eşleme halka açık OSRM demo sunucusuna bağlı; hız sınırında sessizce düz çizgiye düşüyor, UI'da hiçbir gösterge yok | `lib/route-history.ts:32-34, 46-67` |
| 🟡 | görsel | Rota ekranında koyu temaya açık (gündüz) harita karosu gömülü — ekranın ~%60'ı parlak beyaz; boş-durum baloncuğu bu zeminde okunmuyor; oynatma çubuğu veri yokken aktif görünüyor, "önceki güne git / son aktif güne atla" aksiyonu yok | Ekran görüntüsü: araç-rota 1440px |
| 🟡 | risk-görünürlüğü | "§57A MUAYENE (PİCKERL): Girilmedi" ve "SİGORTA: Girilmedi" nötr gri metin — yasal uyum riski taramada tamamen kayboluyor | Ekran görüntüsü: araç detay |
| 🟡 | filtre-url | Detay metrikleri "bugüne" kilitli — tarih seçimi yok (dünün rölantisi/ihlali görülemez); kardeş rota sayfası ise `?date=` destekliyor | `app/admin/araclar/[id]/page.tsx:31-36` vs `rota/page.tsx:17,31` |
| ⚪ | tekrar/tutarsızlık | Plaka 3 kez, "Boşta" durumu 2 kez, "Rota Geçmişi" etiketi 2 kez tekrar; boş değer dili tutarsız ("—" / "Girilmedi" / tam cümle); cezalar limitsiz tek liste; olaylar 10 ile sabit ve "tümünü gör" yok; yüzde "%85" TR önekiyle DE'de de sabit | `VehicleDetailClient.tsx:605,610, 203-256`, `lib/vehicles.ts:190-196`, `app/admin/araclar/[id]/page.tsx:38`; ekran görüntüsü: araç detay |

**26-28 araçta ne kırılır:** Yöneticiler birden çok detay sekmesi açık tutar — her sekme 30 sn'de bir tam günlük track sorgusu koşturur; DB/SSR yükü sekme×araç ile çarpılır. Filo genelinde düzenli rota izleme OSRM demo sunucusunun hız sınırına takılır ve rota kalitesi sessizce bozulur. Cezalar/geofence olayları zamanla sınırsız uzar; 10 olaylık sabit pencere kör nokta üretir. loading.tsx olmadığından bu ağırlaşan SSR süreleri doğrudan donmuş navigasyon olarak hissedilir.

**Güçlü yönler:** 6 sorgu tek Promise.all; DTC sözlüğü (335 kod) sunucuda eşleşiyor, client'a yalnız aktif kodlar iniyor; boş durumlar ayrışık ve bilgilendirici (geofence'te üçlü ayrım + CTA, DTC'de yeşil "arıza yok"); "~ tahmini" belirsizlik rozeti veri uydurmuyor; DTC akordeonu erişilebilir (aria-expanded/controls); rota tarihinde URL query; 30 sn refresh yalnız sekme görünürken; replay 900 noktaya örnekleniyor ve notu gösteriliyor.

---

### 3.5 Seferler — `app/admin/seferler/`

**Amaç + veri kaynağı:** Sefer oluşturma/atama/iptal ve durum izleme (atandı/başladı/tamamlandı/iptal); Telegram bildirimi tetikler. `getAssignments()` **limitsiz**, sıralama `scheduled_at ASC`; filtreleme tamamen istemcide (useMemo), 4 tarih sekmesi yalnız useState'te.

**5 saniye testi:** **BAŞARISIZ (boş durumda).** "Bugün sefer var mı?" cevabı tek satırlık düşük kontrastlı gri metinde; sekmelerde sayaç olmadığı için "hiç sefer yok" ile "bugün yok" ayırt edilemiyor; ekranın ~%80'i boş.

| Önem | Kategori | Bulgu | Kanıt |
|------|----------|-------|-------|
| 🔴 | ölçeklenme | getAssignments LIMIT'siz — geçmiş dahil TÜM seferler her sayfa yüklemesinde çekiliyor; "Tümü" sekmesi hepsini tek düz kart listesi olarak render ediyor; sayfalama/sanal liste yok | `app/actions/assignments.ts:309-315`, `app/admin/seferler/AdminAssignmentsClient.tsx:70-91, 167-241` |
| 🔴 | boş-durum | Boş durum tek satır gri "Henüz sefer atanmamış" — ikon, açıklama, inline CTA yok; "+ Yeni Sefer" butonu sağ üst köşede kopuk; metin dikeyde ortalanmamış | `AdminAssignmentsClient.tsx:162-165`; ekran görüntüsü: seferler 1440px |
| 🔴 | tarama-hızı | Sekmelerde (Bugün/Yarın/Hafta/Tümü) sayaç rozeti yok — yönetici her sekmeye tıklamadan veri olup olmadığını bilemiyor | Ekran görüntüsü: seferler; `AdminAssignmentsClient.tsx:153-160` |
| 🟡 | ölçeklenme | `scheduled_at ASC`: "Tümü" sekmesi en ESKİ seferle açılıyor; gün başlığıyla gruplama yok | `app/actions/assignments.ts:312`, `AdminAssignmentsClient.tsx:71,168` |
| 🟡 | filtre-url | Sürücü/durum/kategori filtresi ve arama yok; sekme durumu URL'e yazılmıyor (yenilemede "Bugün"e döner) | `AdminAssignmentsClient.tsx:62, 153-160` vs `app/admin/page.tsx:56-69` |
| 🟡 | bilgi-hiyerarşisi | Özet KPI satırı yok (bugün kaç sefer / kaç aktif / kaç tamamlandı) — masraflar aynı konumda 3'lü istatistik grid'i gösteriyor | `AdminAssignmentsClient.tsx:146-166` vs `app/admin/masraflar/ExpenseAdminClient.tsx:159-186` |
| 🟡 | tarama-hızı | Kart düzeni sütun hizası sunmuyor: saat/paket/km her kartta farklı pozisyonda — dikey karşılaştırma yavaş; paket sayısı tabular değil | `AdminAssignmentsClient.tsx:176-207` |
| 🟡 | satır-detay | Detaya erişim 2 tık (kebab → "Detay" → modal); kart tıklanabilir değil; detay modalında started_at/completed_at hiç gösterilmiyor | `AdminAssignmentsClient.tsx:169-175, 217-219, 305-340` |
| ⚪ | erişilebilirlik | Kebab menü tetikleyicisi aria-label'sız (satır aksiyonlarına tek erişim yolu); AssignmentForm'da `aria-label="remove"` İngilizce sabit | `AdminAssignmentsClient.tsx:210-215`, `AssignmentForm.tsx:215` |
| ⚪ | tutarsızlık | completed ve cancelled aynı "outline" rozet varyantı (ayrım yalnız 3px şerit rengi); modaldaki km ham sayı, karttaki yerelleştirilmiş; hafta sınırları istemci yerel saatinden hesaplanıyor | `lib/assignments-ui.ts:19-20`, `AdminAssignmentsClient.tsx:328 vs 200-205, 72-83` |

**26-28 araçta ne kırılır:** Günde ~30-60 seferle yılda on binli kayıt sayısına ulaşılır; her sayfa açılışı tüm tabloyu çeker ve "Tümü" binlerce DOM kartı render eder — TTFB ve istemci belleği birlikte kırılır. "Hafta" sekmesi bile 200-400 karta çıkar ve gruplama olmadığından taranamaz. ASC sıralama + arama yokluğu belirli seferi bulmayı pratikte imkânsızlaştırır.

**Güçlü yönler:** Durum görselleştirmesi merkezi (`lib/assignments-ui.ts`, panel ve takvimle paylaşımlı); kart düzeni mobilde tablodan dayanıklı (flex-wrap, truncate); tam i18n + sürücünün dilinde Telegram bildirimi; mutasyon UX'i sağlam (busy + toast + refresh, tamamlanan/iptal edilende menü disabled); iş kuralları düşünülmüş (geçmişe sefer engeli, 2-10 durak, iptal nedeni, yarışa dayanıklı bildirim claim'i).

---

### 3.6 Harita (Canlı Takip) — `app/admin/harita/`

**Amaç + veri kaynağı:** İki katman: telefon-GPS'li aktif vardiya sürücüleri (10 dk tazelik) + donanım-GPS'li araçlar (flespi/Teltonika, 60 dk) Leaflet+MapLibre üzerinde; 4 KPI + aktif şoför listesi. 5 sorgu; aktif vardiyaların rota noktaları **limitsiz ve örneklemesiz**; 30 sn'de `router.refresh()`, 1 sn'lik süre tick'i.

**5 saniye testi:** **BAŞARISIZ.** "Araçlar nerede?" 2-3 saniyede cevaplanıyor ama "her şey yolunda mı?" cevaplanamıyor: 0 / 4 / 16 sayı çelişkisi ilk 5 saniyede güveni kırıyor; kırmızı Araç-E rozetinin anlamı (alarm mı, çevrimdışı mı?) hiçbir yerde açıklanmıyor.

| Önem | Kategori | Bulgu | Kanıt |
|------|----------|-------|-------|
| 🔴 | tutarsızlık | Üç çelişen sayı: KPI "HARİTADA 0" (yalnız sürücüler) vs haritada 4 araç etiketi vs kart köşesinde etiketsiz "16" (sürücü+araç toplamı) | `app/admin/harita/page.tsx:140` vs `LiveTrackingClient.tsx:84-86`; ekran görüntüsü: harita (ana denetçi tespitiyle doğrulandı) |
| 🔴 | ölçeklenme | Rota polyline için TÜM driver_locations noktaları limitsiz/örneklemesiz çekiliyor (26-28 sürücüde ~15 bin satır) ve 30 sn'lik refresh döngüsüyle sürekli tekrarlanıyor | `app/admin/harita/page.tsx:63-69, 94`, `LiveTrackingClient.tsx:50`; karşılaştırma: `lib/route-history.ts:105-116` (örnekleme deseni var, burada kullanılmamış) |
| 🔴 | etkileşim | FitBounds her 30 sn'lik refresh'te haritayı yeniden çerçeveliyor — bir araca zoom yapılmışken görünüm tüm filoya geri sıçrıyor; canlı izlemede inceleme fiilen engelli | `components/FleetMap.tsx:71-82, 96-102` + `LiveTrackingClient.tsx:50` |
| 🔴 | ölçeklenme | Kümeleme yok; araç marker'ı 120px plaka pili — depo/şehir yoğunluğunda üst üste biner; tüm rota polyline'ları aynı renkte, seçim/vurgu yok → 26-28 rotada spagetti | `components/FleetMap.tsx:65-67, 114-123`; ekran görüntüsü: harita |
| 🟡 | performans | 1 sn'lik tick tüm istemci ağacını her saniye render ediyor; FleetMap memoize değil — marker DOM'u her saniye yeniden kuruluyor, nabız animasyonu hiç tamamlanamıyor (etiket zaten dakika hassasiyetinde) | `LiveTrackingClient.tsx:51`, `components/FleetMap.tsx:93, 129-132, 161-165` |
| 🟡 | bilgi-hiyerarşisi | Araç katmanının liste karşılığı yok (yan panel yalnız telefon-GPS'li şoförleri listeliyor); plaka/isim araması yok; araç popup'ında sürücü bilgisi yok; ~550px'lik "Aktif Şoförler" paneli boş durumda tek satır taşıyor | `LiveTrackingClient.tsx:100-147`, `components/FleetMap.tsx:167-193`; ekran görüntüsü: harita (ana denetçi tespiti: panel bomboş) |
| 🟡 | boş-durum | Yanıltıcı kopya: "Şu an aktif vardiya bulunmuyor" — aktif vardiya olsa bile son 10 dk'da GPS ping'i yoksa gösteriliyor; KPI "Aktif Vardiya: 3" ile yan yana çelişebilir; doğru mesaj "konum sinyali yok" | `LiveTrackingClient.tsx:90-96, 106-109`, `page.tsx:11, 46-54, 80-96` |
| 🟡 | görsel | Koyu temada açık harita karoları — ekranın en büyük/parlak yüzeyi; kırmızı rozet semantiği için lejant yok; harita dar kart içinde, altında ~140px ölü şerit | Ekran görüntüsü: harita (ana denetçi tespiti: harita dar kartta) |
| ⚪ | tutarsızlık | Aynı sayfanın üç adı: nav "Harita", shell başlığı "Canlı Takip", kart başlığı "Filo Haritası"; ölü `HaritaClient.tsx` dosyası; sorgular gereksiz seri (Promise.all yok); prod'da console.log | `page.tsx:133`, `LiveTrackingClient.tsx:81`, `messages/tr.json:38,322,336`; `HaritaClient.tsx:22-56`; `page.tsx:30-99, 101-110` |
| ⚪ | mobil | Tam genişlik harita scroll edilebilir sayfada — parmak kaydırması harita pan'ine yakalanıyor (scroll trap); harita viewport altında kesiliyor; marker'larda görünür odak stili yok | Ekran görüntüsü: mobil; `components/FleetMap.tsx:105-110, 48-59` |

**26-28 araçta ne kırılır:** Her 30 sn'de ~15 bin driver_locations satırı DB'den çekilip RSC payload'ı olarak taşınır — yenilemeler görünür şekilde yavaşlar, maliyet artar. 120px plaka pilleri kümeleme olmadan üst üste biner; 28 aynı renkli polyline okunamaz. Araç listesi/arama olmadığından belirli aracı bulmak gözle taramaya döner. FitBounds sorunu tek aracı izlemeyi imkânsızlaştırır; saniyelik tick düşük donanımda jank üretir.

**Güçlü yönler:** KPI satırı doğru metrikleri gösteriyor ve 9h AZG aşımı hem KPI'da hem listede vurgulu; `.nums` tipografisi tutarlı; renk dili proje kuralına sadık ve iki GPS katmanını ayrıştırıyor (yorumla belgelenmiş); marker HTML'inde XSS escape; OSM attribution korunmuş; refresh yalnız sekme görünürken; tazelik pencereleri (10 dk / 60 dk) gerekçeli.

---

### 3.7 Yakıt — `app/admin/yakit/`

**Amaç + veri kaynağı:** Yakıt fişi onay kuyruğu (bekleyen/onaylı/reddedilen) + aylık istatistik kartları + araç bazlı tüketim + CO₂ raporu; aynı rotada ikinci modül olarak bakım kayıtları. `getFuelEntries` **limitsiz** `select("*")` + HER fiş için signed URL; her onay/red `router.refresh()` ile limitsiz sorguyu baştan koşturuyor; bakım `limit(100)`.

**5 saniye testi:** **BAŞARISIZ.** İlk KPI doğru yerde ama "0,00 € · 0,00 L" gösterirken hemen altındaki Araç Tüketimi tablosunda 65,00 L görünüyor — anında güven sorusu. Varsayılan "Onay Bekliyor" sekmesi boş açıldığından ekranın en değerli alanı ölü.

| Önem | Kategori | Bulgu | Kanıt |
|------|----------|-------|-------|
| 🔴 | ölçeklenme | Limitsiz fuel_entries + tüm fişlere URL imzalama her sayfa açılışında ve HER onay/red sonrasında tekrarlanıyor; tabloda sayfalama/sanal liste yok | `app/actions/fuel.ts:203-209, 220-225`, `app/admin/yakit/FuelAdminClient.tsx:142, 150, 246` |
| 🔴 | tutarsızlık | KPI kapsam çelişkisi: kartlar "bu ay onaylı" sayarken tabloda 65 L kayıt görünüyor; stat kartlarında zaman çerçeveleri karışık (bu ay / anlık / tüm zamanlar) ve etikette ayrım yok | `FuelAdminClient.tsx:100-119` (satır 109 all-time); ekran görüntüsü: yakıt 1440px |
| 🔴 | filtre-url | Plaka/sürücü/tarih filtresi, arama ve sayfalama yok; tek filtre useState'teki durum sekmesi; Araç Tüketimi tablosunda sıralama yok ("en yakıcı araç" bulunamaz) | `FuelAdminClient.tsx:58, 142`; ekran görüntüsü: yakıt |
| 🟡 | bilgi-hiyerarşisi | Onay kararı için kritik alanlar tabloda yok: odometer_km, fuel_type, station_name, notes toplanıyor ama hiçbir yerde gösterilmiyor — admin km makullüğünü göremeden onaylıyor; satır→detay akışı da yok | `app/actions/fuel.ts:103-117` vs `FuelAdminClient.tsx:227-235, 262-270` |
| 🟡 | veri-girişi | Bakım formu plaka tuzağı: seçenekler mevcut kayıtlardan türetiliyor — filoya yeni katılan aracın ilk bakım kaydı girilemiyor | `app/admin/yakit/MaintenanceAdminClient.tsx:143-156`, `page.tsx:21-26` |
| 🟡 | ölçeklenme | Bakım listesi `limit(100)` ile sessizce kesiliyor (~1 yılda dolar); toplu onay yok, tek global busy tüm satırları kilitliyor, optimistic update yok | `app/actions/maintenance.ts:95-99`, `FuelAdminClient.tsx:61, 144-154, 276-287` |
| 🟡 | bilgi-mimarisi | Bakım modülü "Yakıt Takibi" sayfasına gömülü ikinci modül — odağı bölüyor; diğer modüller kendi rotasına sahip; bakımda cost/description toplanıp listede gösterilmiyor | `page.tsx:38-41`, `MaintenanceAdminClient.tsx:184-190 vs 106-114`; ekran görüntüsü: yakıt |
| 🟡 | görsel | Sütun dağılımı dengesiz: başlıklar 940px'e gerilmiş, solda geniş boşluklar, sağda €/L–L/100–Fiş yapışık; bölüm başlıkları içerikten soluk | Ekran görüntüsü: yakıt 1440px |
| ⚪ | boş-durum | Varsayılan "Bekleyen" sekmesi iş kuyruğu için doğru tercih, ama kuyruk boşken yönlendirme yok ("son onaylananlar için Onaylandı sekmesine bak") ve sekmelerde sayaç rozeti yok | `FuelAdminClient.tsx:215-219, 239-244`; ekran görüntüsü: yakıt |
| ⚪ | erişilebilirlik | Onay/red ikon butonlarının aria-label'ları İngilizce sabit ("approve"/"reject"); 9 kolonlu tablo mobilde aksiyon kolonu ekran dışında; CO₂ butonunda emoji-görünümlü çift ikon | `FuelAdminClient.tsx:276, 284, 223-236`; ekran görüntüsü: yakıt |

**26-28 araçta ne kırılır:** Yılda ~3.000+ fiş satırının tamamı her açılışta ve her onay sonrasında yeniden çekilip imzalanır — onay kuyruğu ekranı giderek yavaşlar ve loading.tsx olmadığından bekleme boş ekranda geçer. 20-30 bekleyen fişi tek tek, her seferinde tam refetch bekleyerek onaylamak gerekir. Bakım limiti ~1 yılda dolar ve eski kayıtlar uyarısız kaybolur; yeni aracın plakası formda seçilemez.

**Güçlü yönler:** Stat kartları mevcut ve doğru öncelikte; sayısal kolonlar sağa hizalı + `.nums`; fiş URL'leri tek toplu istekle imzalanıyor; ReceiptThumb lightbox bağlam bilgisiyle; onay akışı deseni masraflarla birebir tutarlı (öğrenilebilirlik); L/100km sunucuda ardışık dolumdan hesaplanıyor; requireAdmin her katmanda.

---

### 3.8 Masraflar — `app/admin/masraflar/`

**Amaç + veri kaynağı:** Fiş fotoğraflı masraf onay kuyruğu + aylık bordro CSV (DATEV/BMD tarzı). `getExpenseEntries({withUrls:true})` **limitsiz** — tüm geçmiş her yüklemede çekiliyor ve HER kaydın fiş URL'i yeniden imzalanıyor; force-dynamic + onay sonrası `router.refresh()`.

**5 saniye testi:** **Teknik olarak geçiyor — yalnız veri sıfır olduğu için.** "Onay bekleyen" bilgisi ortadaki kartta "0 · 0,00 €" biçiminde bulunuyor ama format kendini açıklamıyor; en parlak öğeler yine logo ve toggle.

| Önem | Kategori | Bulgu | Kanıt |
|------|----------|-------|-------|
| 🔴 | ölçeklenme | Limitsiz sorgu + tüm fişlere signed URL her ziyarette ve her onay sonrası tekrar; tabloda sayfalama/gruplama yok — "Onaylandı" sekmesi sınırsız büyüyen düz tablo | `app/actions/expenses.ts:186-192, 203-208`, `app/admin/masraflar/page.tsx:8,13`, `ExpenseAdminClient.tsx:107, 115, 216-260` |
| 🔴 | filtre-url | Ay, sürücü, kategori, tutar filtresi hiç yok; arama ve tarih aralığı yok; tek filtre useState'teki durum sekmesi (URL'e yazılmıyor — yenilemede "pending"e döner) | `ExpenseAdminClient.tsx:67, 107`; ekran görüntüsü: masraflar 1440px |
| 🟡 | bilgi-hiyerarşisi | "Reddedildi" sekmesinde rejection_reason, "Onaylandı"da approved_at/approved_by gösterilmiyor — kolon seti üç sekmede aynı; sürücü panelinde ret nedeni görünürken admin göremiyor | `ExpenseAdminClient.tsx:197-260`, `lib/types.ts:310-312` |
| 🟡 | bilgi-hiyerarşisi | vehicle_plate toplanıyor ama tabloda gösterilmiyor — "diesel" masrafının hangi araca ait olduğu görülemiyor (yakıt sayfası plaka kolonunu gösteriyor) | `lib/types.ts:306`, `app/actions/expenses.ts:105-107` vs `ExpenseAdminClient.tsx:197-206` |
| 🟡 | güvenli-eylem | Onay tek tık, onaysız ve geri alınamaz; onay/ret ikon butonları bitişik (gap-1); tek global busy tüm satırları kilitliyor, hangi satırın işlendiği belli değil | `ExpenseAdminClient.tsx:109-119, 243-256, 70` |
| 🟡 | boş-durum | Boş durum tek satır gri "Kayıt yok" — ikon/bağlam/aksiyon yok; KPI "0 · 0,00 €" formatı açıklamasız; "En çok masraf" kartındaki "—" neyi ölçtüğünü söylemiyor | `ExpenseAdminClient.tsx:209-214`; ekran görüntüsü: masraflar |
| ⚪ | kopya | Sağ üstteki tek eylem "Bordro Excel" — masraf ekranında "bordro" (maaş) kelimesi kafa karıştırıcı; hangi dönemi aktardığı belirsiz | Ekran görüntüsü: masraflar |
| ⚪ | tarama-hızı | Sekme başlıklarında adet rozeti yok; kategori kolonu emoji kullanıyor (🛣🍽🅿⛽) — lucide ikon diline aykırı; filtrelenen görünümün altında toplam satırı yok | `ExpenseAdminClient.tsx:186-192, 221` |
| ⚪ | erişilebilirlik | aria-label'lar İngilizce sabit ("approve"/"reject"); 7 kolonlu tablo mobilde yalnız yatay kaydırma; açıklama tooltip'i (title) dokunmatikte erişilemez | `ExpenseAdminClient.tsx:244, 252, 195, 223` |
| ⚪ | diğer | SelectValue'ya `as never` cast'li fonksiyon child (tip güvenliği kapalı, yakıttan kopya); approve() çağrısında try/catch yok | `ExpenseAdminClient.tsx:292-295, 109-119` |

**26-28 araçta ne kırılır:** "Onaylandı" sekmesi birkaç ayda binlerce satıra çıkar: her sayfa yüklemesi tüm geçmişi çekip her fiş için signed URL üretir — TTFB, payload ve DOM birlikte şişer; her onay sonrası bu maliyet tekrarlanır ve onay kuyruğu ekranı yavaşlar.

**Güçlü yönler:** Varsayılan sekme "Bekleyen" — onay kuyruğu önde; üç özet kart doğru metriklerde; tutarlar sağa hizalı tabular; fiş URL'leri tek toplu çağrıyla imzalanıyor; çifte onay yarışı sunucuda `.eq('status','pending')` ile engellenmiş; CSV Excel uyumlu (BOM + CRLF + alan kaçışlı) ve bordro formatında; ReceiptThumb klavye erişilebilir; yakıt sayfasıyla güçlü desen birliği.

---

### 3.9 Bölgeler — `app/admin/bolgeler/`

**Amaç + veri kaynağı:** Dairesel geofence CRUD ("yasak" / "sadece burada" kuralları); ihlal tespitinde kullanılıyor. `getGeofences()` limitsiz (bölge sayısı düşük olduğundan pratik risk az); harita yalnız oluştur/düzenle diyaloğu içinde.

**5 saniye testi:** **Değerlendirme boş durumda yapıldı.** "Henüz bölge tanımlanmamış" mesajı 2-3 saniyede bulunuyor ama sayfa neredeyse boş olduğu için — tasarım sayesinde değil; boş durum bir sonraki adıma taşımıyor. Dolu-durum görüntüsü alınamadı; dolu durum tarama hızı **[VARSAYIM]** kod bulgularından çıkarılmıştır.

| Önem | Kategori | Bulgu | Kanıt |
|------|----------|-------|-------|
| 🔴 | boş-durum | Boş durum kutusunun İÇİNDE eylem yok — CTA ("Bölge ekle") sağ üst köşede kopuk; kutu üstte demirlemiş, viewport'un ~%65-70'i boş; geofence ekranı için en doğal boş-durum zemini olan harita hiç kullanılmamış | `app/admin/bolgeler/BolgelerClient.tsx:148-152`; ekran görüntüsü: bölgeler 1440px |
| 🟡 | bilgi-hiyerarşisi | Tüm bölgeleri birlikte gösteren genel bakış haritası yok — çakışma/kapsama ancak her bölgenin diyaloğu tek tek açılarak görülebilir | `BolgelerClient.tsx:230-237` (harita yalnız Dialog içinde) |
| 🟡 | bilgi-hiyerarşisi | Bölge→ihlal bağlantısı yok: ihlaller yalnız araç detayında ve "bugün" kapsamında; bölge başına ihlal sayısı/son olay bu sayfadan denetlenemiyor | `BolgelerClient.tsx:183-186`; karşılaştırma: `VehicleDetailClient.tsx:394-424` |
| 🟡 | filtre-url | İsim araması, kural türü ve aktif/pasif filtresi yok; KPI/özet satırı da yok (toplam/aktif/kural dağılımı) | `BolgelerClient.tsx:140-207` |
| 🟡 | hata | Enlem/boylam inputlarında eksik koordinat 0'a düşüyor — önce enlem yazılırsa önizleme dairesi Gine Körfezi açıklarına atlıyor; alan silinince koordinat sessizce 0 oluyor | `BolgelerClient.tsx:130-137` |
| ⚪ | geri-bildirim | toggle() başarıda toast yok, busy/optimistic yok; remove() busy korumasız — çift tık iki DELETE atabilir | `BolgelerClient.tsx:110-128` |
| ⚪ | tutarsızlık | Yarıçap doğrulaması istemci/sunucu tutarsız (istemci yalnız min 50 m; sunucu max 100 km) — aşımda jenerik "Kaydedilemedi" toast'ı | `BolgelerClient.tsx:82-86, 97-101`, `lib/validation.ts:206` |
| ⚪ | tarama-hızı | Kural/yarıçap/koordinat tek meta satırında birleşik — yarıçaplar dikey taranamıyor; 5 haneli koordinat insan okuması için düşük değerli | `BolgelerClient.tsx:183-186` |
| ⚪ | tutarsızlık | Native `confirm()` ile silme; aynı sayfada karışık köşe yarıçapı (`rounded-[var(--radius)]` vs `rounded-[16px]`); araçlardaki HelpTip burada yok | `BolgelerClient.tsx:111, 149, 158` |

**26-28 araçta ne kırılır:** Bölge sayısı araç sayısıyla değil operasyon alanıyla büyür (muhtemel 10-40 kayıt) — liste teknik olarak taşır. Asıl kopukluk: araç sayısı arttıkça geofence ihlalleri 26-28 aracın tek tek detay sayfalarına dağılır ve "bugün"le sınırlı kalır — bölge yönetimi ile ihlal izleme arasındaki kopukluk filoyla birlikte büyür.

**Güçlü yönler:** İkon-butonlarda aria-label; `.nums` sayı dizilimi; haritaya klavye alternatifi (lat/lng inputları); Leaflet dinamik import + Skeleton; kural türü ikon+renk kodlaması net (yasak=kırmızı Ban, sadece-burada=mavi ShieldCheck); min 50 m kuralı dedektörün 25 m histerezisine dayalı ve belgelenmiş; requireAdmin + revalidatePath; harita remount sorunu `key` ile doğru çözülmüş.

---

### 3.10 Çalışanlar (+ Çalışan Detayı) — `app/admin/workers/` (+ `[id]`)

**Amaç + veri kaynağı:** Sürücü roster'ı: listeleme, ekleme, PIN sıfırlama, aktif/pasif. Detay: aylık KPI kartları, bugünkü rota haritası, son 200 vardiya, PDF raporu. Liste: tüm workers (limitsiz) + bu ayın time_entries (limitsiz). Detay: bu ayın entries + `limit(200)` vardiya + bugünün driver_locations (limitsiz), Promise.all.

**5 saniye testi:** **Kısmen başarısız.** Durum bilgisi bulunuyor ama yanlış sinyalle: bordo/kırmızı "Aktif" rozetleri alarm gibi okunuyor; 7 sütunun 3'ü şu an sıfır bilgi taşıyor ("Son Vardiya" hepsi "—", "Bu Ay Saat" hepsi "0s 00dk"). Detayda yöneticinin asıl sorusu ("şu an vardiyada mı, hangi araçta, en son nerede?") ekranda hiç yok.

| Önem | Kategori | Bulgu | Kanıt |
|------|----------|-------|-------|
| 🔴 | yanlış-veri | "Son Vardiya" yalnız bu ayın sorgusundan türetiliyor — ay başında herkes "—"; geçen ay çalışan hiç vardiyasız görünüyor: yönetici 5 saniyede YANLIŞ veriyi bulur | `app/admin/workers/page.tsx:23-26, 38-49`; ekran görüntüsü: çalışanlar |
| 🔴 | ölçeklenme | Aylık time_entries limitsiz (28 çalışan × ~25 vardiya ≈ 700 satır → 1000 tavanına yaklaşır; aşılırsa saatler sessizce eksik); detaydaki driver_locations da limitsiz — rota sessizce kırpılabilir | `app/admin/workers/page.tsx:23-26`, `app/admin/workers/[id]/page.tsx:57-62` |
| 🔴 | renk-semantiği | Olumlu "Aktif" durumu marka bordo/kırmızısıyla dolu rozet — alarm dili; aynı ton logo, filtre hapı, ekle butonu ve avatarlarda da olduğundan vurgu hiçbir şeyi vurgulamıyor; filtre hapı ile durum rozeti ayırt edilemiyor | Ekran görüntüsü: çalışanlar 1440px |
| 🟡 | güvenli-eylem | Her satırda kalıcı "PIN Sıfırla" + "Pasifleştir" butonları (yarı-yıkıcı eylem açıkta, hover/kebab yok); onaylar native `confirm()`; tek pending tüm satırları kilitliyor | `WorkersClient.tsx:59-67, 80, 175-195, 47`; ekran görüntüsü: çalışanlar |
| 🟡 | filtre-url | İsim araması, sütun sıralaması, satır sayacı yok; durum filtresi yalnız useState'te (URL'e yazılmıyor) | `WorkersClient.tsx:53-56, 94-135` |
| 🟡 | bilgi-hiyerarşisi | Liste üstünde KPI/özet yok (toplam/aktif/şu an vardiyada); detay KPI kartlarında dönem etiketi yok — "VARDİYA 0 / SAAT / KM / KARGO" bu aya ait ama "Bu Ay" ibaresi kullanılmamış (tr.json'da anahtar hazır) | `WorkersClient.tsx:94-122`, `WorkerDetailClient.tsx:160-197`, `messages/tr.json:848`; ekran görüntüsü: çalışan detay |
| 🟡 | ölçeklenme | "Tüm Vardiya Geçmişi" başlığına rağmen `limit(200)` — kesinti kullanıcıya görünmez; boş durum metni "Bu filtrede vardiya bulunmuyor" görünmez bir filtreye referans veriyor | `app/admin/workers/[id]/page.tsx:51-56`, `WorkerDetailClient.tsx:241-296`; ekran görüntüsü: çalışan detay |
| 🟡 | tutarsızlık | PIN sıfırlama listede özenli Dialog, detayda ham `window.alert()`; detayda aksiyon satırı (PIN/Pasifleştir/PDF) profil kartından kopuk yüzüyor ve hiyerarşi ters (PDF primary, Pasifleştir nötr) | `WorkerDetailClient.tsx:93` vs `WorkersClient.tsx:205-227`; ekran görüntüsü: çalışan detay |
| ⚪ | tarama-hızı | Sayısal kolonlar (`Bu Ay Saat`, çalışılan/mola/km) `.nums` alıyor ama sağa hizalı değil; telefon numaraları gruplamasız tek blok; satır tıklama hedefi yalnız ad hücresi | `WorkersClient.tsx:132, 160-174`, `WorkerDetailClient.tsx:277-284` |
| ⚪ | veri-hijyeni | "deneme1" test kaydı gerçek verilerle yan yana; pasif satırlarda opacity-60 kontrastı düşürüyor; PIN Sıfırla butonu dar ekranda salt ikon + aria-label'sız | Ekran görüntüsü: çalışanlar; `WorkersClient.tsx:145, 177-185` |

**26-28 araçta ne kırılır:** Aylık time_entries sorgusu ay sonunda ~700+ satıra ulaşıp 1000 tavanına dayanır — "Bu Ay Saat" ve "Son Vardiya" sessizce eksik hesaplanır. Detaydaki driver_locations 1000'i aşarsa günlük rota haritası sessizce kırpılır. Arama/sıralama olmadan 28+ satırda belirli çalışanı bulmak yavaşlar; 200 kayıtlık kesinti veri kaybı algısı yaratır.

**Güçlü yönler:** Server component + Promise.all, istatistikler sunucuda tek geçişte; `.nums` tutarlı; AddWorkerDialog iki yüzeyde paylaşımlı + PIN tek seferlik gösterim ve must_change_pin akışı; varsayılan filtre "aktif" (pasif roster listeyi kirletmiyor); RouteMap dinamik import + Skeleton; aktif vardiya satırı border ile ayrışıyor; tam TR/DE i18n + Vienna saat dilimi.

---

### 3.11 Telegram — `app/admin/telegram/`

**Amaç + veri kaynağı:** Telegram entegrasyon yönetimi: admin bağlantısı, webhook sağlığı, bağlı çalışanlar tablosu, test mesajı. Yalnız `telegram_chat_id` dolu workers sorgulanıyor; `getWebhookInfo` her açılışta api.telegram.org'a **timeout'suz** canlı fetch; üç await seri.

**5 saniye testi:** **BAŞARISIZ.** Kritik bilgi (webhook çalışmıyor) turuncu düz metin olarak 3-4 saniyede fark ediliyor ama banner değil dipnot gibi; "kaç şoför bağlı / kim bağlı DEĞİL" sorusuna ekranda hiç cevap yok; durum hikayesi çelişkili (bağlan butonu + yapılandırılmamış webhook + tabloda 2 bağlı kullanıcı + nedeni belirsiz soluk test butonu).

| Önem | Kategori | Bulgu | Kanıt |
|------|----------|-------|-------|
| 🔴 | bilgi-hiyerarşisi | Yalnız BAĞLI çalışanlar sorgulanıyor; bağlı olmayan sürücüler ve "X bağlı / Y toplam" özeti hiç yok — sayfanın asıl sorusu "kim bildirim ALMAYACAK" cevapsız | `app/admin/telegram/page.tsx:12-16`; ekran görüntüsü: telegram |
| 🔴 | durum-iletişimi | "Webhook yapılandırılmamış (token veya secret eksik)" kritik hatası çerçevesiz turuncu düz metin — aksiyon butonu yok; ekranın durum hikayesi çelişkili, hangi adımın eksik olduğu çıkarılamıyor | Ekran görüntüsü: telegram 1440px; `TelegramAdminClient.tsx:81-84` |
| 🟡 | yükleme | getWebhookInfo timeout'suz dış fetch (AbortSignal yok) + loading.tsx yok — Telegram API yavaşlarsa sayfa iskeletsiz asılı kalır; üç await seri (Promise.all yok) | `lib/telegram.ts:105`, `app/admin/telegram/page.tsx:12-31` |
| 🟡 | hata-ayrımı | "Token yok" ile "fetch hatası" aynı `{ok:false}` — geçici ağ hatasında yönetici yanlış yere (env config) yönlendiriliyor | `lib/telegram.ts:103, 116` + `TelegramAdminClient.tsx:81-84` |
| 🟡 | erişilebilirlik | Satır-içi test butonu yalnız ikon, aria-label yok; Textarea ve Select'in görünür label'ı yok | `TelegramAdminClient.tsx:190-201, 140-145` |
| ⚪ | tekrar | "Test Mesajı Gönder" ekranda 3 kez (kart başlığı, buton, sütun başlığı); "Telegram" kelimesi 4 kez; ilk kart en değerli alanı tek butona harcıyor | Ekran görüntüsü: telegram |
| ⚪ | tutarsızlık | Ham `text-amber-600` (proje token'ı accent-gold yerine); tarih hücresi nums'suz; form Select'i h-10 (diğer formlar h-11); çalışan adı workers/[id]'ye linklenmiyor | `TelegramAdminClient.tsx:82, 186-188, 123, 184` |
| ⚪ | hata-yönetimi | send()'de catch yok — ağ hatasında toast gösterilmiyor; Textarea'da Telegram'ın 4096 karakter limiti için sayaç yok | `TelegramAdminClient.tsx:52-64, 140-145` |

**26-28 araçta ne kırılır:** Tablo hacmi (~28-35 satır) sorun değil; asıl kırılganlık timeout'suz dış API çağrısının sayfayı asması ve isim araması/"bağlı değil" görünümü olmadan kapsama boşluğunun görünmez kalması. Select açılırında aramasız ~30 öğe taramayı yavaşlatır.

**Güçlü yönler:** Satır bazlı busy state (yalnız tıklanan satır spinner'a döner — panelde tek doğru örnek); tablo overflow-x-auto; boş durum metinleri mevcut; test mesajı sunucuda HTML-escape; QR polling interval'ı temizleniyor; başlık ve aksiyon kolonu hizası tutarlı.

---

## 4. Console / Runtime Hataları

Playwright ile canlı gezinme sırasında toplandı (15.07.2026):

1. **Dashboard (masaüstü + mobil):** Recharts uyarısı — `The width(-1) and height(-1) of chart should be greater than 0` (donut grafiği ölçüm sorunu).
2. **Araç detay:** Base UI erişilebilirlik hatası — `nativeButton expected native <button>` (button olmayan öğeye buton davranışı atanmış).
3. **/admin/rota:** 404 dönen kaynak + `script tag inside React component` hatası + `logo.png` aspect-ratio uyarısı. Görsel denetimde de "Eski rota sayfası" ekran görüntüsü 404 sayfası olarak yakalandı ve Next.js dev overlay'inde "2 Issues" rozeti görünüyordu. **[VARSAYIM]** Kod denetimi `app/admin/rota/page.tsx`'e atıf yapıyor (dosya mevcut görünüyor) — 404, yanlış URL'den veya route'un kaldırılmış/taşınmış olmasından kaynaklanabilir; doğrulanmalı.
4. **Dev overlay sızıntıları:** Araç detay ekran görüntüsünde kırmızı "1 Issue" rozeti sidebar içeriğini örtüyor; mobil ekran görüntülerinde yüzen "N" (Next.js) rozeti donut grafiğin, bir liste satırının ve Leaflet atıf yazısının üstüne biniyor.
5. **Prod'da debug logu:** Harita sayfası her istekte `console.log` basıyor (kodda bilinçli olduğu yorumlanmış; kalıcı çözüm structured logging olmalı). — `app/admin/harita/page.tsx:101-110`

---

## 5. FAZ 2-4 İçin Çıkarımlar

**Kurulacak ortak bileşenler** (bu denetimde her biri en az 3 sayfada eksikliğiyle bulgu üretti):

- **DataTable** — sticky başlık, uppercase mikro-etiket başlık stili (AdminClient'taki desen standart alınabilir), sütun sıralama, sağa hizalı `.nums` sayı kolonları, sayfalama/"daha fazla yükle", satır sayacı, boş-durum slotu, mobil sütun önceliklendirme. 3 liste paradigmasını (Table / ul-glass / kart yığını) bilinçli iki desene indirger: DataTable + ListRow.
- **StatCard** — 5 kopyanın birleşimi: tek değer tipografisi, **kapsam etiketi zorunlu** ("Bu Ay", "Bugün"), boş değer sözlüğü, opsiyonel tıklanabilir-filtre davranışı (KPI → liste köprüsü).
- **FilterBar** — URL searchParams senkronlu (dashboard'daki desen standart); arama + durum + tarih aralığı + sürücü/araç seçici; sekmelere sayaç rozeti.
- **DetailDrawer** — satır→detay akışı için (alarmlar, seferler, yakıt, masraflar, dashboard vardiya tablosu); tam sayfa navigasyonun harita/zoom durumunu kaybettirdiği harita için de popup yerine yan panel.
- **EmptyState** — ikon + açıklama + inline CTA + (varsa) "neden boş" ayrımı ("hiç yok" vs "bu filtrede yok" vs "sinyal yok"); 3 farklı elle yazılmış boş-durum stilini birleştirir.
- **Skeleton / loading.tsx** — her route'a; `components/ui/skeleton.tsx` zaten mevcut, hiç bağlanmamış.
- **PageHeader** — tek h1 kuralı (DashboardShell mi sayfa mı — biri seçilmeli), sağda aksiyon slotu; çift başlık/çift h1 sorununu bitirir.
- **StatusChip** — shadcn Badge + 4 lib dosyasındaki (status-ui, vehicle-ui, assignments-ui, event-ui) el yapımı chip'lerin tek kaynağa indirilmesi.
- **ConfirmDialog** — native `confirm()`/`alert()` kullanımlarının (araçlar, bölgeler, çalışanlar, dashboard, cezalar) yerine.
- **Komut paleti** — cmdk kurulu ve `command.tsx` yazılmış ama bağlanmamış; ⌘K ile araç/çalışan/sayfa araması 28 araçlık filoda "5 saniyede bul" hedefinin en ucuz kazanımı.

**Standartlaşacak desenler:**

- **Sunucu tarafı limit + sayfalama her listede**; sessiz kesme yasak — kesilen her listede "X kayıttan Y gösteriliyor" göstergesi.
- **Filtre durumu daima URL'de** (paylaşılabilir link, yenilemeye dayanıklı).
- **Renk semantiği ayrımı:** kırmızı/bordo yalnız alarm/yıkıcı eylem; marka vurgusu ve birincil CTA ayrı tona; "Aktif" gibi olumlu durumlar nötr/sky. DESIGN.md kodla eşitlenmeli (bordo değeri, aurora, tema kararı).
- **Koyu harita karoları** (harita + rota ekranları) ve haritada kümeleme + lejant.
- **Formatlayıcı merkezileştirme:** `eur()` ve `nf` kalıbı `lib/format.ts`'e; tarih tarafındaki mevcut disiplin örnek alınmalı.
- **Gruplama desenleri:** alarmlar için gün başlığı + olay-fırtınası kümeleri ("Araç-A: 12 olay"), seferler için gün başlıkları.
- **Boş değer sözlüğü:** "0" vs "—" vs "Girilmedi" vs tam cümle — tek kural.
- **Mobil:** alt tab bar (Harita/Alarmlar/Araçlar), 44px dokunma hedefleri, harita scroll-trap koruması, yıkıcı eylemlerin kebab menüye taşınması.
- **Ölü kod temizliği:** AppShell/Header, HaritaClient, popover/separator, ölü importlar — FAZ 2 refactor'una başlamadan silinmeli (yanlış dosyayı düzenleme riski).
