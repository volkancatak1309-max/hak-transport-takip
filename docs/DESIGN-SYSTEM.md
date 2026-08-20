# HAK61 — Tasarım Sistemi v2 (FAZ 2)

**Tarih:** 15.07.2026 · **Statü:** UI V2 redesign'ın tasarım anayasası.
**İlişki:** Kök dizindeki `DESIGN.md`'nin (v1) yerine geçer. v1 ile kod arasındaki üç çelişki (bkz. `docs/UX-AUDIT.md` §2.1) burada karara bağlanmıştır. Girdiler: FAZ 0 denetimi (`docs/UX-AUDIT.md`) + FAZ 1 rakip DNA'sı (`docs/COMPETITOR-DNA.md`, özellikle §5'teki 15 karar).

**Korunan kimlik (görev şartı):** koyu zemin · bordo vurgu · mono plaka fontu · OpenFreeMap liberty harita stili.

---

## 0. v1 çelişkilerinin kararları

| Konu | DESIGN.md v1 | Koddaki gerçek | **KARAR (v2)** |
|---|---|---|---|
| Tema | "Açık/koyu toggle kullanıcıda" | `forcedTheme="dark"` (providers.tsx:19) | **Zorla koyu resmîdir.** Koyu zemin kimliğin parçası; açık tema token'ları FAZ 3'te ölü koddan temizlenene kadar dokunulmaz ama hiçbir yeni bileşen açık tema için test edilmez. |
| Bordo değeri | `#a01a33` | Koyuda `#8a1538`, açıkta `#750d02` | **`#8a1538` tek standarttır** (koyu tema tek tema olduğu için). v1'deki `#a01a33` geçersiz. |
| Aurora/gradyan | "Gradient yok, aurora yasak" | Aurora zemin + 3 gradyan utility | **Aurora zemin kalır** (bilinçli kimlik kararı, `body::before` — sabit, scroll'da repaint yok). Sınır: aurora yalnız ZEMİNDE yaşar; hiçbir veri yüzeyinin (kart, tablo, drawer) İÇİNE dekoratif görsel/gradyan girmez. Mevcut 3 utility (`.nav-active`, `.btn-primary`, `.card-kpi::after`) meşrudur; yenisi eklenmez. |

**Ek karar — filigran:** Dashboard'daki dev 3D kaplan logosu veri kartlarının üzerine biniyor (FAZ 0 kritik bulgu #2). **Veri yüzeylerinden kaldırılır.** Marka görseli yalnız sidebar logosu, login ve splash'ta yaşar.

---

## 1. İlkeler

1. **5 saniye:** Yönetici her ekranda en kritik veriyi 5 saniyede bulur. Özet üstte, istisna öne, detay drawer'da.
2. **28 araç ölçeği:** Her liste sayfalama/gruplama/filtreyle tasarlanır; "düz uzun tablo" yasak. Sessiz veri kesme yasak — kesilen listede "X kayıttan Y gösteriliyor" zorunlu.
3. **Bugatti testi:** "Bu bileşen Linear/Stripe panelinde durur mu?" Hayırsa girmez. Neon, glow, konfeti, oyuncak hissi yasak.
4. **Tek birincil eylem:** Ekran başına bir birincil buton; ikincil her şey menüye/drawer'a.
5. **Renk anlamdır:** Renk süs değil sinyal. Aksanlar yüzeyin >%10'unu kaplamaz.
6. **Veri uydurulmaz:** Boş veri tasarlanmış boş durumla gösterilir, asla sahte örnekle değil.

---

## 2. Renk Sistemi

Tek kaynak `app/globals.css`. Bileşenlerde ham hex/oklch/Tailwind palet rengi (`text-amber-600` vb.) **yasak** — her renk semantik token üzerinden.

### 2.1 Zemin katmanları (Geist iki-katman modeli)

| Token | Değer | ~Hex | Kullanım |
|---|---|---|---|
| zemin (html) | `#0a0d16` | `#0a0d16` | Sayfa zemini + aurora yıkaması |
| `--card` | `oklch(0.205 0.007 256)` | `#15171a` | Kart, tablo, drawer |
| `--surface-2` | `oklch(0.245 0.008 256)` | `#1e2124` | **Hover** zemini, seçili satır |
| `--surface-3` **(yeni)** | `oklch(0.285 0.009 256)` | ≈`#26292d` | **Active/pressed** zemini |

Kural (Geist'ten): hover = bir üst katman, active = iki üst katman. `hover:bg-white/5` gibi ham beyaz katmanlar FAZ 3'te `--surface-2`'ye taşınır.

### 2.2 Metin

| Token | Değer | Kart üstünde kontrast* | Kural |
|---|---|---|---|
| `--foreground` | `oklch(0.975 0.003 256)` | **16.7:1 ✓** | Başlık, değer, gövde |
| `--muted-foreground` | `oklch(0.72 0.012 256)` | **7.3:1 ✓** | İkincil metin, **tablo kolon başlıkları, mikro-etiketler** |
| `--text-tertiary` | `oklch(0.55 0.012 256)` | 3.7:1 (AA-normal ✗) | **Yalnız** disabled/placeholder ve ≥18px büyük metin. Mikro-etiketlerde YASAK (FAZ 0'da 10px etiketler bu tondaydı — okunmuyor). |

*Oranlar bu doküman için hesaplandı (OKLCH→sRGB→WCAG, script: FAZ 2 çalışması); göz kararı değildir.

### 2.3 Bordo (marka) kullanım yasaları

Ölçüm: bordo `#8a1538` kart üstünde metin olarak **1.9:1 — FAIL**. Buradan üç yasa:

1. Bordo koyu temada **asla metin/ikon rengi olmaz.** Yalnız: dolgu (üzerine beyaz metin, 9.4:1 ✓), sol durum şeridi, aktif nav vurgusu, grafik serisi.
2. Bordo zeminli chip'in metni için **yeni token `--accent-claret-text` = `oklch(0.78 0.10 12)`** (≈`#f09da6`, kart üstünde **8.6:1 ✓**). Mevcut `text-accent-claret` chip'leri (örn. "Molada") FAZ 3'te buna taşınır.
3. Bordo = **marka + birincil eylem, BAŞKA HİÇBİR ŞEY.** Yıkıcı eylem (sil) ve kritik alarm bordoyu KULLANAMAZ (FAZ 0 bulgu #8: "kırmızı marka mı sorun mu?" karmaşası). Sil butonları `--destructive`, kritik alarmlar §2.4'teki kritik token'ları kullanır.

### 2.4 Semantik durum paleti (kritik / uyarı / bilgi / nötr)

Görev şartı. Tümü ölçülmüş, WCAG AA, neon değil:

| Rol | Token (yeni) | Değer | ~Hex | Kontrast (kart) | Kullanım |
|---|---|---|---|---|---|
| **Kritik** (metin/ikon/rozet) | `--status-critical` | `oklch(0.70 0.18 28)` | `#fa695c` | **6.2:1 ✓** | Çarpma, jamming, panik, arıza (DTC), 10s+ ihlal |
| **Kritik** (dolgu) | `--status-critical-fill` | `oklch(0.55 0.20 27)` | `#cc2827` | beyaz metin **5.4:1 ✓** | Kritik banner/buton dolgusu |
| **Uyarı** | `--accent-gold` (mevcut) | `oklch(0.76 0.105 78)` | `#d6a960` | **8.3:1 ✓** | Aşırı hız, 9s+ uyarı, bekleyen onay, muayene yaklaşıyor |
| **Bilgi** | `--accent-sky` (mevcut) | `#5b93cf` | `#5b93cf` | **5.6:1 ✓** | Canlı/aktif, link, odak halkası, rutin bilgi |
| **Nötr** | `--muted-foreground` | `oklch(0.72 0.012 256)` | `#a0a5ac` | **7.3:1 ✓** | Rutin sürüş olayları, pasif durumlar |

- `--destructive` (koyu: `oklch(0.62 0.2 25)`) yalnız **yıkıcı eylem UI'ı** (sil butonu, onay dialogu) için kalır; olay şiddeti anlatmaz.
- `--accent-green` mevcut sözleşmesini korur: **yalnız donanım sinyali** (kontak açık). Operasyonel durum yeşil/kırmızı kullanmaz (mevcut bilinçli kural, korunuyor).
- **Soft varyantlar (tek karar):** globals.css'teki mevcut soft token'lar değerleriyle korunur (`claret-soft` 22% · `sky-soft` 18% · `gold-soft` 18%); yeni eklenen kritik için **`--status-critical-soft` = %15**. StatusChip daima bu adlandırılmış token'ları kullanır, yüzdeyi kendisi hesaplamaz.
- **Uyarı dolgusu:** gold zeminli banner/buton gerekirse metin rengi zemin tonudur (`#0a0d16` — gold üstünde **9.0:1 ✓**); beyaz metin gold üstünde yasak.

### 2.5 Operasyonel vardiya durumları (değişmiyor)

`aktif=sky · molada=bordo(claret) · boşta=gold · bakımda=nötr` eşlemesi ve harita pin renkleri **aynen korunur** — tek düzeltme: bordo chip metinleri `--accent-claret-text`'e geçer (§2.3).

### 2.6 Olay şiddeti eşlemesi (Alarmlar sayfasının renk anahtarı)

FAZ 0 kritik bulgusu: jamming soluk gri, rutin sert viraj turuncuydu. Yeni eşleme (`lib/event-ui.ts` FAZ 3'te buna taşınır):

| Şiddet | Olaylar | Renk |
|---|---|---|
| Kritik | çarpma, çekilme (towing), sinyal karıştırma (jamming), panik | `--status-critical` |
| Uyarı | aşırı hız, uzun rölanti, 9s+ vardiya | `--accent-gold` |
| Rutin | sert viraj, ani hızlanma, ani fren | **nötr** (`--muted-foreground` rozet) — §2.4'teki "bilgi/sky" rolü olay şiddeti için KULLANILMAZ; sky canlılık/link demektir |

Tabloda satır başına **tek rozet**: bir kümede birden çok şiddet varsa en yükseği gösterilir (COMPETITOR-DNA §5 karar #4).

Kural: rutin olaylar renkle BAĞIRMAZ; kritik olan tek başına parlar (Samsara kırmızı→turkuaz şiddet skalası deseni, COMPETITOR-DNA §2.1).

### 2.7 Grafik renkleri

`--chart-1..5` mevcut sırayla korunur (bordo, sky, yeşil, mor, turuncu). Donut/legend'da **her dilimin yanında sayı zorunlu** (FAZ 0 bulgu #5'in kuralı).

---

## 3. Tipografi

- **Aileler:** Geist Sans (gövde/başlık), Geist Mono (sayısal veri + plaka). Değişmiyor.
- **Ölçek (px) ve roller:** 11 (mikro-etiket, uppercase, +0.04em, `--muted-foreground`) · 12 (tablo ikincil hücre, chip metni) · 13 (yoğun tablo gövdesi) · **14 (gövde varsayılan)** · 16 (drawer/kart başlığı) · 20 (bölüm başlığı, h2) · 24 (sayfa içi büyük değer) · 28 (StatCard KPI değeri). Satır yüksekliği 1.4–1.5.
- **Ağırlık:** 400 gövde · 500–600 başlık/vurgu · **700 yalnız KPI değeri.** (`font-bold` başlıklarda yasak — FAZ 0 §2.6 ihlalleri FAZ 3'te temizlenir.)
- **`.nums` kimliği:** Tüm sayısal veri (saat, km, €, hız, adet) ve **plaka** `.nums` (tabular-nums + mono) kullanır. Plaka ayrıca `uppercase tracking-wide`. İstisnasız — FAZ 0'da bulunan aykırı yerler (seferler kartı, workers tablosu) FAZ 3'te düzeltilir.
- **Sayı hizalama:** Tabloda sayısal kolon **daima sağa hizalı** + `.nums`; tarih/saat hücreleri de `.nums`. Metin kolonları sola.
- **Tek h1 kuralı:** Sayfanın h1'i DashboardShell topbar başlığıdır. Sayfa gövdesi h2'den başlar. Çift h1 (yakıt/masraf/seferler) FAZ 3'te PageHeader ile çözülür.
- **Boş değer sözlüğü (tek kural):** `—` = veri yok/girilmedi · `0` = gerçek sıfır · tam cümle yalnız EmptyState içinde. "Girilmedi" gibi kelime değerleri yasak.

---

## 4. Boşluk, Konteyner, Form

- **4px grid.** Kart iç boşluğu 16–20px (`p-4`/`p-5`), bölüm arası `space-y-6` (tek standart; mevcut 4/5/6 karışımı FAZ 3'te birleşir).
- **Konteyner standardı** (FAZ 0'daki 7 farklı genişlik yerine 3 sınıf):

| Sayfa sınıfı | Konteyner | Sayfalar |
|---|---|---|
| Liste/dashboard | `max-w-6xl` | Yönetici, Alarmlar, Araçlar, Seferler, Yakıt, Masraflar, Çalışanlar, Bölgeler |
| Detay | `max-w-5xl` | Araç detay, Çalışan detay |
| Tam genişlik | `max-w-none` (kenar boşluğu `px-4 sm:px-6`) | Harita, araç rota (`araclar/[id]/rota`), rota replay (`/admin/rota`) |

  Konteyner div'i **her zaman `page.tsx`'te** (server) yaşar, client bileşende değil.
- **Radius:** kart 14–16px (`--radius`), iç öğe 10–12px, chip tam yuvarlak. Değişmiyor.
- **Kenarlık:** 1px `--border`. Gölge yalnız yüzen yüzeylerde (`.elevate`, `.glass-pop`). Zebra striping **yasak** (hover/seçili ayrımını bozar — COMPETITOR-DNA §3.10); satır ayrımı 1px ayraçla.

---

## 5. Yüzeyler

- **Cam (`.glass`):** Sidebar, topbar ve birincil kartlarda kalır (mevcut). Blur 18px sabit; `@supports` fallback korunur. Yeni yüzeyler `.glass` mi düz `--card` mı: içerik yoğun tablolar düz `--card` (okunabilirlik), kabuk/KPI yüzeyleri `.glass`.
- **Elevation:** dropdown/dialog/drawer = `.glass-pop` veya `.elevate`. Başka gölge yok.
- **Dekorasyon sınırı (§0):** Veri yüzeyinin içinde marka görseli, filigran, dekoratif gradyan yasak.

---

## 6. Tablo Standardı + Yoğunluk Modları

Tüm listeler FAZ 3'teki **DataTable**'a (tablosal veri) veya **ListRow**'a (kart-satır; araçlar/harita yan listesi gibi) taşınır. Üçüncü desen yok.

**ListRow anatomisi:** sol 3px durum şeridi · `.nums` plaka/kimlik bloğu · orta: 2 satıra kadar özet (ad + ikincil bilgi) · sağ: StatusChip + hover'da üç-nokta menü. Yoğunluk modları ListRow'a da uygulanır (rahat 64px / sıkı 52px — kart-satır tabladan yüksektir). Tıklama = DetailDrawer.

- **Başlık:** sticky; 11px uppercase mikro-etiket, `--muted-foreground` (AdminClient'taki mevcut desen standarttır). Sıralanabilir başlık gerçek `<button>` + `aria-sort`.
- **Yoğunluk modları (görev şartı):** `rahat` = 48px satır · `sıkı` = 40px satır. Kullanıcı anahtarı DataTable sağ üstünde; tercih **globaldir** (tek `localStorage` anahtarı `hak-density`, tüm sayfalarda geçerli). Padding değişir, font boyutu değişmez. *(COMPETITOR-DNA #15'teki 40/48/56 üçlüsünden görev şartına uygun iki kademeye indirildi.)*
- **Varsayılan sıralama = aciliyet:** listeler kronoloji yerine önce dikkat gerektirenle açılır — alarmlar: kritik üstte; araçlar: alarmlı/çevrimdışı üstte, sonra plaka (COMPETITOR-DNA #6, Samsara "In Motion üstte" + Verizon acil-durum-üstte kalıbı). Kullanıcı sıralaması URL'e yazılır.
- **Satır anatomisi:** sol 3px durum şeridi (opsiyonel) · hücreler · sağda hover'da beliren aksiyonlar (düzenle / üç-nokta menü). **Silme asla satırda açık ikon değil** — üç-nokta menüsünün içinde (FAZ 0 araçlar bulgusu).
- **Satır tıklama:** tüm satır tıklanabilir → DetailDrawer açar (yeni sayfa değil). Hover: `--surface-2`.
- **Sayfalama:** 50 satır/sayfa varsayılan + "daha fazla yükle"; toplam sayaç zorunlu ("142 kayıttan 50'si").
- **Gruplama:** gün başlıkları (alarmlar, seferler) + olay-fırtınası kümeleri: aynı araç + aynı olay tipi 10 dk penceresinde tek satır "Sert Viraj ×3", tıklayınca açılır (görev şartı; Samsara trip-katlama + Verizon deste kalıbı).
- **Mobil:** kolon önceliklendirme — kritik 3-4 kolon kalır, gerisi drawer'da; yatay scroll son çare.

---

## 7. Bileşen Standartları (FAZ 3'ün sözleşmesi)

Hepsi `components/ui-v2/` altında tek kaynak; sayfa-içi kopya yasak.

- **Kabuk (DashboardShell — mevcut, düzeltilerek korunur):** Sol sabit 240px `.glass` sidebar + 64px `.glass` topbar düzeni değişmez. Düzeltmeler (UX-AUDIT §2.11'in dört tekrarlayan bulgusu):
  - **Tek seçili nav görünümü:** yalnız aktif sayfa vurgulanır; "Yönetici" öğesinin kalıcı açık-zemin pill görünümü kaldırılır (aktif değilken diğer öğelerle aynı).
  - **Etiketsiz kırmızı toggle kaldırılır** — işlevi (Yardım modu) etiketli menü öğesine ya da kullanıcı menüsüne taşınır; topbar'da etiketsiz anahtar yaşayamaz.
  - **Avatar baş harfi kullanıcı adından türetilir** ("Gökhan" → "G"); uyduruk harf yasak.
  - **Topbar sağ blok ritmi:** saat · çevrimdışı rozeti · yardım · dil · çıkış — 8px eşit aralık, tümü ≥44px dokunma hedefi ve `aria-label`'lı.
  - Sidebar logosu statik marka alanıdır; neon/glow versiyonu kullanılmaz (Bugatti testi).
- **PageHeader:** h2 başlık + sağda tek birincil aksiyon slotu + opsiyonel açıklama satırı. Çift h1'i bitirir.
- **StatCard:** 11px uppercase etiket + 28px `.nums` değer + **zorunlu kapsam etiketi** ("Bugün", "Bu Ay", "Seçili aralık" — FAZ 0'daki '9 Saati Aşan' ikiliği bir daha yaşanmasın) + opsiyonel delta (`▲/▼ + değer`, **daima nötr renkte** — km artışı iyi mi kötü mü bağlama bağlı, trend rengi yanıltır). Değeri >0 olan istisna metriği ilgili durum rengini alır; sıfır/nötr metrik renksiz. **Tıklanabilir:** filtrelenmiş listeye URL ile gider (Vercel derin-bağlantı kalıbı). ⓘ ikonu YASAK — açıklama gereken etiket yanlış etikettir; gerekiyorsa kapsam etiketi çözer.
- **FilterBar:** filtre durumu **daima URL searchParams'ta** (paylaşılabilir link — dashboard'daki mevcut desen tüm sayfalara). Anatomi: arama kutusu + durum/tip çipleri + tarih aralığı ön-ayarları (Bugün/Hafta/Ay/Özel) + sonuç sayacı + "Temizle". 28 araçlık listede canlı (anlık) filtreleme; "Uygula" butonu yok.
- **DetailDrawer:** sağdan, masaüstü 480px / mobil tam genişlik; `.glass-pop` yüzey; Esc + overlay kapatır; açıkken ↑/↓ komşu kayda geçer (Linear peek); `?panel=<id>` ile URL'e yazılır (derin link); mini harita slotu (alarm konumu, araç son konumu). Kayıt detayı için modal **yasak**.
- **EmptyState:** ikon + başlık + tek cümle neden + (varsa) CTA. Üç tip ayrışır: "hiç yok" (onboarding CTA'lı) · "bu filtrede yok" (Temizle CTA'lı) · "sinyal/veri gelmiyor" (teknik ipucu). Boş bölüm dikeyde büyümez — tek satıra sıkışır (FAZ 0: dört dev boş kutu).
- **Skeleton + loading.tsx:** her admin route'una `loading.tsx` zorunlu; iskelet gerçek yerleşimi taklit eder (StatCard sırası + tablo satırları). `components/ui/skeleton.tsx` zaten var, bağlanacak.
- **StatusChip:** shadcn Badge + 4 lib dosyasındaki (status-ui, vehicle-ui, assignments-ui, event-ui) el yapımı chip'lerin tek kaynağı. Anatomi: soft zemin (%15) + durum rengi metin (§2 token'ları) + opsiyonel nokta. El yapımı `rounded-full bg-accent-*/15` span'ları FAZ 3/4'te buna taşınır.
- **ConfirmDialog:** native `confirm()`/`alert()` yasak; yıkıcı onay = başlık + sonuç cümlesi + `--destructive` dolgu buton.
- **Komut paleti (⌘K):** cmdk zaten kurulu, bağlanacak. İçerik: araç (plaka fuzzy), çalışan, sayfa, hızlı eylem. Başlıklar eylem dili ("DO-… haritada izle", "Alarmlara git" değil "Alarmları aç"). Global tetik: `⌘K`/`Ctrl+K` + topbar'da arama görünümü.
- **Global araç seçici:** ⌘K'nin araç modu; her sayfadan plaka yazınca araç detayına/haritada odağa gider.

---

## 8. Hareket

- **Easing:** her yerde `cubic-bezier(0.25, 0.1, 0.25, 1)`. Başka eğri yasak.
- **Süreler:** mikro (hover/renk) 140–200ms · yüzey geçişi (kart, satır) 200–250ms · büyük yüzey (drawer, dialog, sayfa girişi) 240–300ms. **300ms üstü yalnız ambient** (canlı nokta pulse'ı gibi tekrar eden, dikkat çekmeyen animasyonlar). *(Görev metnindeki "0.3s+" bu şekilde yorumlandı: etkileşim yanıtı 0.3s'i aşmaz, ambient yavaş olabilir — itiraz varsa FAZ 2 kapısında düzeltilir.)*
- **Yasak:** bounce, spring, elastic, parallax, gradyan animasyonu, glow. Transform yalnız: opacity, translateY ≤4px, scale ≤1.1 (harita pini).
- **Ambient istisnası:** opacity'ye sönerek genişleyen ping halkaları (`live-ping` scale 2.4, `hak-pin-pulse` scale 1.6 — mevcut) scale sınırından muaftır; görünür yüzey değil sönen iz oldukları için. Yeni ambient animasyon bu iki desenin dışına çıkamaz. `splash-emblem` (420ms) login/splash akışına aittir — bu redesign'ın kapsamı dışı, dokunulmaz.
- **prefers-reduced-motion:** mevcut global söndürme kuralı korunur; yeni her animasyon bu kuralın kapsamında kalmak zorunda.

---

## 9. Harita Standardı

- **Stil:** OpenFreeMap **liberty** korunur (görev şartı). Açık karolar koyu temada "içerik yüzeyi" olarak çerçevelenir: 1px `--border` + 14px radius + kart içinde. *(Not: repoda `feature/openfreemap-dark` dalı var — koyu karo istenirse ayrı karar, Volkan'ın.)*
- **Kümeleme zorunlu** (28 araç; dört rakipte de standart): sayaçlı küme, zoom'da dağılır.
- **Lejant zorunlu:** pin renk/durum anahtarı harita köşesinde daraltılabilir lejant olarak yaşar (FAZ 0: "kırmızı rozetin anlamı hiçbir yerde açıklanmıyor"; Verizon Icon Legend kalıbı).
- **FitBounds yalnız ilk yüklemede.** Refresh kullanıcının zoom/pan'ını asla sıfırlamaz; "Tümünü göster" butonu manuel sıfırlama sağlar (FAZ 0 kritik bulgu #10).
- **Tek durum ilkesi:** liste + harita + KPI aynı veri setinden sayılır; "HARİTADA 0 ama 4 pin" çelişkisi tanım gereği imkânsız hale gelir.
- Pin renkleri §2.5 operasyonel durumları izler; pin etiketi mono plaka.

---

## 10. Mobil

- Dokunma hedefi **≥44px** (topbar ikonları dahil — FAZ 0'da ~30px'ti).
- Yıkıcı/ikincil eylemler satırda değil üç-nokta menüde.
- **Alt tab bar** (Harita · Araçlar · Alarmlar + menü) FAZ 4'te değerlendirilir (Vercel yüzen alt bar kalıbı); hamburger tek navigasyon olarak kalmaz.
- Tablolar mobilde kolon önceliklendirme (§6); harita scroll-trap koruması (tek parmak sayfa kaydırır, iki parmak harita).

---

## 11. Erişilebilirlik (özet)

- Kontrast: bu dokümandaki her metin token'ı ölçülmüş AA (§2 tabloları). `--text-tertiary` kısıtı §2.2.
- Odak: `--ring` (koyuda sky) her etkileşimli öğede görünür.
- `aria-sort` (sıralanabilir başlık), `aria-label` (ikon butonlar), `aria-current` (nav — mevcut, korunur).
- Renk tek anlam taşıyıcısı değil: her durum rengi ikon/etiketle birlikte.
- Base UI `nativeButton` hatası (FAZ 0 console bulgusu) FAZ 3'te gerçek `<button>` ile çözülür.

---

## 12. Yasaklar (tek liste)

1. Ham renk (`text-amber-600`, `hover:bg-white/5`, hex) — token dışı renk yok.
2. Bordo metin/ikon rengi olarak (koyu temada).
3. Neon, glow, bounce/spring/elastic, konfeti, çizgi film hissi.
4. Veri yüzeyinde dekoratif görsel/filigran/gradyan.
5. Native `confirm()`/`alert()`.
6. Çift h1; `font-bold` başlık.
7. Zebra striping; kayıt detayı için modal.
8. Limitsiz/sessiz kesilen sorgu; sayaçsız kesilmiş liste.
9. Satırda açık silme ikonu.
10. ⓘ ikonu (StatCard/buton açıklaması olarak).
11. Sayfa-içi kopya bileşen (StatCard/Kpi/chip kopyaları).
12. `[VARSAYIM]`sız tahmin — emin olunmayan her değer/etkiye etiket.

---

## 13. COMPETITOR-DNA §5 kararlarının durumu

15 kararın bu dokümandaki karşılığı — hiçbiri sessizce düşmedi:

| # | Karar | Durum |
|---|---|---|
| 1 | Liste+harita tek durum | **Alındı** — §9 |
| 2 | Triage kısayolları (1/2/3/H, snooze) | **Ertelendi → FAZ 4 Alarmlar** (sayfa deseni; drawer + klavye altyapısı §7'de hazırlanıyor) |
| 3 | Alarm hunisi (tip kartı → trend) | **Ertelendi → FAZ 4 Alarmlar** (StatCard→filtreli liste köprüsü §7'de temelini kuruyor) |
| 4 | Satırda tek rozet (en yüksek şiddet) | **Alındı** — §2.6 |
| 5 | Kolon aç/kapa + adaptif satır + sabit plaka | **Kısmen ertelendi** — mobil kolon önceliklendirme §6'da; kullanıcıya kolon aç/kapa DataTable v2'ye (FAZ 4'te ihtiyaç doğrulanırsa; 26-28 araçta YAGNI riski) |
| 6 | Aciliyet öncelikli varsayılan sıralama | **Alındı** — §6 |
| 7 | Drawer + sekmeli araç detayı | **Kısmen** — DetailDrawer §7'de; sekme yapısı FAZ 4 Araçlar sayfası kararı |
| 8 | KPI → filtreli liste derin bağlantısı | **Alındı** — §7 StatCard |
| 9 | Filtre-URL | **Alındı** (§7 FilterBar); kayıtlı görünümler **reddedildi** (küçük filoda URL paylaşımı yeterli; menü şişirir) |
| 10 | ⌘K palet | **Alındı** (§7); token araması (`plaka:`, `hiz:>90`) ve palette-peek **ertelendi → v2** (önce temel palet otursun) |
| 11 | Boş durum üçlüsü | **Alındı** — §7 EmptyState |
| 12 | Yükleme iskeleti | **Alındı** — §7 |
| 13 | Taze veri "subtle glow" | **REDDEDİLDİ** — §8/§12 glow yasağıyla çelişir; canlılık `.live-dot` + "son güncelleme" zaman damgasıyla verilir |
| 14 | Geist iki katmanlı arka plan | **Kısmen alındı** — iki katman + `--surface-3` (§2.1); 10 adımlı tam gri skalası **reddedildi** (mevcut token seti yeterli, skala migrasyonu risk/getiri dengesizliği) |
| 15 | Yoğunluk anahtarı | **Alındı** — §6 (üç kademe yerine görev şartındaki iki kademe) |

---

## Ek A — FAZ 3 uygulama notları

- Yeni token'lar (`--surface-3`, `--accent-claret-text`, `--status-critical`, `--status-critical-fill`, `--status-critical-soft`) `app/globals.css` `.dark` bloğuna eklenir; `@theme inline` eşlemeleri yapılır. Mevcut `*-soft` token'ları değerleriyle korunur (§2.4).
- Bileşen kütüphanesi `components/ui-v2/` altında: DataTable, ListRow, PageHeader, StatCard, FilterBar, DetailDrawer, EmptyState, StatusChip, ConfirmDialog, CommandPalette, DensityToggle.
- `eur()` ve sayı formatlayıcı `lib/format.ts`'e taşınır (4 kopya silinir); `nf` locale kalıbı tek helper olur.
- Ölü kod temizliği FAZ 3 başında: `components/AppShell.tsx`, `components/Header.tsx`, `app/admin/harita/HaritaClient.tsx`, kullanılmayan importlar (FAZ 0 §2.8 listesi).
- Şoför paneli (`/panel`) ve login bu sistemden **etkilenmez** (görev şartı); ortak token dosyası değişse de panel bileşenlerine dokunulmaz, görsel regresyon FAZ 5'te ekran görüntüsüyle doğrulanır.
