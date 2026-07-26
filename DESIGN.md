# HAK61 — TASARIM KİLİDİ

**Durum:** kilitli · **Tarih:** 25.07.2026 · **Karar:** Volkan
**Yöntem:** Refero referans araştırması (`refero-design`). Bu belgedeki hiçbir değer
"iyi görünür" diye seçilmedi; her biri aşağıdaki üç gerçek üründen ölçülerek alındı.

> Bu dosya 25.07.2026'da baştan yazıldı. Önceki sürüm (koyu-öncelikli Linear/Vercel
> yönü) git geçmişinde `8393f6c` commit'inde duruyor. `docs/DESIGN-SYSTEM.md` hâlâ
> mevcut ve bazı bölümleri bu kilitle ÇELİŞİYOR — çelişkide **bu dosya** kazanır.

---

## 0. Referans kilidi

| Rol | Kaynak | Refero ID | Önizleme |
|---|---|---|---|
| **BİRİNCİL** — mizanpaj, kart dili, boşluk ritmi, tek-aksan disiplini | **Runey** · Expenses panosu | `bf9b7ee2-ab71-4ce1-98e4-85f119754add` | `https://images.refero.design/screenshots/runey.app/desktop/bf9b7ee2-ab71-4ce1-98e4-85f119754add_preview.jpg` |
| **DESTEK A** — tablo-içi bar, rapor yoğunluğu, indirme/sayfalama | **Stripe** · Revenue recognition | `5f9b93d3-6315-4656-8f74-cd26b07f1069` | `https://images.refero.design/screenshots/stripe.com/desktop/00d07674-325b-44e8-af0c-f2f5df70dbee_preview.jpg` |
| **DESTEK B** — mono font rolü, 8px ızgara, KPI çipi → grafik → tablo dizilimi | **Fingerprint** · Bot detection | `fa27b73e-e27a-4249-b08e-8af912b3ad26` | `https://images.refero.design/screenshots/fingerprint.com/desktop/fa27b73e-e27a-4249-b08e-8af912b3ad26_preview.jpg` |
| **DESTEK C** (26.07) — katmanlı gri merdiveni + operasyon konsolu İSKELETİ | **Stellate** · Operations metrics | `e8b04517-1949-47d0-9faa-23a79f651802` | `https://images.refero.design/screenshots/stellate.co/desktop/8dd79423-3320-4e4d-bc46-2a6b696c3f65_preview.jpg` |
| **DESTEK D** (26.07) — DETAY ekranı künye satırı: etiket sol / değer sağ, mikro bölüm etiketi, yoğun ayraçlı liste | **Enode** · Vehicle capabilities konsolu | `77cf19d7-fb3d-41bd-bc69-3e1bddb42f1a` (açık) · `5b7b3988-96d1-4f94-8c3f-f6a91505bde3` (koyu) | `https://images.refero.design/screenshots/enode.com/desktop/76385a20-10d3-41c0-9101-f5d447ec4715_preview.jpg` |
| **DESTEK E** (26.07) — üç kolon anatomisi (nav · orta içerik · sağ özellik/olay rayı) + rayda mini harita bandı | **Clay** · kişi detayı | `754179d7-6fe2-4e21-9edc-bbaf45bd9ff1` | `https://images.refero.design/screenshots/clay.earth/desktop/b66ec900-61f4-4022-83c2-730061a0009d_preview.jpg` |

### Korunacak imza özellikler (Runey'den — bunlar pazarlık dışı)

1. **Yüzen siyah nav rayı** — kenara yapışık değil, yuvarlatılmış, koyu panel.
2. **Sıcak açık zemin** + üstünde **beyaz kartlar** — soğuk gri-mavi değil.
   ⚠️ 26.07 güncellemesi: zemin artık `#F5F5F7`, yani karttan BELİRGİN ayrışır
   (§2.1 katmanlı gri merdiveni). Runey'in tek-katman sadeliği yerini Stellate'in
   kademeli gri mantığına bıraktı — hue Runey'de kaldı.
3. **Tek aksan rengi.** Mercan — ama artık CÖMERT (§2.2, %10 sınırı kalktı).
4. **Cömert boşluk + büyük köşe yarıçapı** (16–20px kart).
5. **Dizilim:** başlık satırı → 4'lü KPI şeridi → tam genişlik grafik kartı → gruplanmış liste/tablo.

### Ödünç alınan dar detaylar (rol dışına ÇIKARILAMAZ)

- **Stripe:** tablo hücresi içine gömülü soluk oran bar'ı — *yalnız* sayısal kolonlarda,
  *yalnız* aynı satırdaki değerin oranını göstermek için. Dekoratif kullanım yasak.
- **Fingerprint:** mono font — *yalnız* alfanumerik kimlik ve ölçüm (plaka, IMEI,
  request-id, saat, km, koordinat). Gövde metninde mono yasak. 8px temel ızgara.

### Reddedilenler

Koyu-öncelikli varsayılan · çok renkli grafik paleti · gradient/glow/aurora ·
neon aksan · "calm editorial" krem+terrakota · dekoratif serif başlık ·
her kartın farklı renkte olduğu KPI ızgarası.

---

## 1. Tema

**Açık tema VARSAYILAN.** Koyu tema tam desteklenir ve aynı DNA'dan türetilir:
aynı mizanpaj, aynı ritim, aynı aksan rolü — yalnız zemin/yüzey/metin remap edilir.

Altyapı hazır: `next-themes`, `attribute="class"`, `.dark` bloğu `app/globals.css`'te
zaten tanımlı, `components/ThemeToggle.tsx` çalışır durumda.
⚠️ Şu an `components/providers.tsx` içinde `forcedTheme="dark"` var — kilit gereği
kaldırılacak, `defaultTheme="light"` olacak.

Geçiş: zemin + metin renkleri 240ms yumuşak; layout HİÇ değişmez.

---

## 2. Renk

### 2.1 Nötr taban — KATMANLI GRİ MERDİVENİ (26.07.2026 güncellemesi)

**Karar (Volkan):** sayfa düz beyaz olmayacak; **katmanlı gri** hissi verecek.
Referans: Stellate operations konsolu (`e8b04517`) — zemin `#F8FAFC`, beyaz kart,
şerit satır `#F1F5F9`, ayraç `#E2E8F0`, ikincil metin `#687285`, üçüncül `#959EAE`.
Stellate'in **kademe mantığı** alındı, hue'su değil: bizim nötrler Runey'in sıcak
tarafında kalır, ama basamaklar arası fark artık **görünür**.

| # | Rol | Açık (varsayılan) | Koyu | Not |
|---|---|---|---|---|
| 1 | Sayfa zemini (ground) | `#F5F5F7` | `#0F0F10` | Karttan belirgin daha koyu — katman hissi buradan başlar |
| 2 | Kart yüzeyi | `#FFFFFF` | `#18181A` | İçeriğin yaşadığı yer |
| 3 | Panel / inset (filtre paneli, tablo başlığı, zebra satır) | `#F1F1F3` | `#1F1F22` | Stellate'in `#F1F5F9` karşılığı |
| 4 | Hover / seçili | `#EAEAEC` | `#26262A` | 3'ten bir tık daha koyu, tıklanabilirlik hissi |
| 5 | Kenarlık / ayraç | `#E3E3E6` | `rgba(255,255,255,0.10)` | Eski `#E6E9EB`'ten koyu — ayraçlar görünür olacak |
| — | Nav rayı | `#181818` (her iki temada da KOYU) | `#0E0E0F` | İmza öğe |
| — | Birincil metin (ink) | `#181818` | `#F2F3F5` | |
| — | İkincil metin | `#6B6B6B` | `#A0A0A3` | AA ölçüldü |
| — | Üçüncül metin / etiket | `#6E6E73` | `#9A9AA0` | 26.07: AA için koyultuldu (12px alt-satır) |

**Kural:** üst üste gelen iki yüzey ASLA aynı tonda olmaz. Kart zeminin üstünde,
panel kartın içinde, hover panelin üstünde — her katman bir basamak koyulaşır.

### 2.2 Aksan — mercan, ZARİF CÖMERTLİK (26.07.2026 güncellemesi)

**Karar (Volkan):** eski **%10 alan sınırı KALDIRILDI.** Mercan artık yalnız
odak/aktif rengi değil; beyaz + gri + mercan üçlüsü **sayfanın karakteri**.

| Token | Açık | Koyu | Kullanım |
|---|---|---|---|
| `--accent-coral` | `#F15857` | `#FF6F6E` | Aşağıdaki rollerin tamamı |
| `--accent-coral-soft` | `#F15857` @ 12% | `#FF6F6E` @ 18% | Rozet/şerit zemini, seçili satır, hücre-içi bar |
| `--accent-coral-hover` | `#D94746` | `#FF8A89` | Basış/hover koyulaşması |

**Mercanın MEŞRU rolleri** (hepsi serbest):
bölüm başlığı vurgusu · önemli sayı · grafik ana serisi · hover durumu ·
ikon vurgusu · ilerleme/oran barı · aktif sekme ve nav · birincil eylem ·
seçili satır zemini · sıralama barı · canlı/aktif göstergesi.

**Ölçü — "göz her ekranda mercanla 3-5 kez buluşsun":**
- Bir ekranda **en az 3**, **en çok 5-6** ayrı mercan dokunuşu olsun. 1 tanesi
  cimri, 10 tanesi gürültü.
- **Aynı karar için iki mercan yarışmaz:** bir bölümde birincil eylem mercansa,
  o bölümdeki ikinci vurgu nötr kalır.
- **Gövde metni asla mercan değildir.** Mercan sayıya, etikete, bara, ikona gider.
- Büyük dolu mercan zemin yalnız **tek** öğede olabilir (birincil eylem ya da
  tek bir vurgu şeridi) — kart zemini mercan olmaz.
- Kontrast kuralı değişmedi: mercan METİN olarak kullanılacaksa AA ölçülür
  (açık temada `#F15857` beyaz üstünde 3.6:1 → yalnız ≥18.66px kalın metin).
- **Dolu mercan üstündeki metin BEYAZ DEĞİLDİR** (26.07 ölçümü): beyaz,
  `#F15857` üstünde 3.35:1 kalıyor. Bu rol `--accent-coral-fg` token'ınındır;
  açık temada koyu mürekkep (`#181818`, 6.27:1), koyuda `#121213`. Token daha
  önce beyaz tanımlıydı ve hiç kullanılmamıştı — düzeltildi.

### 2.2.1 Ölçüm kuralı — EN KÖTÜ ZEMİN (26.07.2026)

Bir metin tonu "beyaz üstünde geçiyor" diye onaylanamaz. Çipler kendi renginin
%12-16 tinti üstünde yaşar ve o zemin beyazdan koyudur. Ölçüm **öğenin gerçekte
üstünde durduğu zeminle** yapılır; aynı çip sayfa zemininde (`#F5F5F7`) kart
üstündekinden daha zor geçer.

Bu kural iki kusuru ortaya çıkardı ve ikisi de düzeltildi:
- `--accent-gold-text` `oklch(0.52)` → **`oklch(0.5)`**: "Boşta" çipi kendi gold
  tinti üstünde 4.46:1 kalıyordu (beyazda geçiyordu). Artık 4.87:1.
- `STATUS_STYLE` çip metinleri dolgu token'ı kullanıyordu
  (`text-accent-gold` / `-sky` / `-claret`). §2.4'ün açıkça yasakladığı şey;
  hepsi `*-text` türevine çevrildi. Nokta ve şerit dolgu tonunda KALDI.

### 2.3 İSTİSNA — filo renkleri bilgi taşır

Bordo ve mavi **süs değil, veridir**; kilidin tek-aksan kuralının dışındadır.
Yalnız şu yerlerde yaşar:

- filo rozeti / çipi (bordo filo · mavi filo)
- harita pin'i ve rota çizgisi
- filo kırılımı gösteren grafik serisi ve tablo satır işareti

| Token | Açık | Koyu | Not |
|---|---|---|---|
| `--accent-claret` (bordo) | `#8A1538` | `#8A1538` | Koyuda metin olarak KULLANILAMAZ |
| `--accent-claret-text` | = bordo | `oklch(0.78 0.1 12)` | Koyuda çip metni bu açık tonu kullanır (kart üstünde 8.6:1) |
| `--accent-sky` (mavi) | `oklch(0.58 0.085 240)` | `#5B93CF` | |

Mevcut `lib/vehicle-ui.ts` → `FLEET_STYLE` tek kaynak olarak KALIR.

### 2.4 Durum renkleri

Operasyonel durum renkleri değişmiyor: aktif = mavi, mola = bordo, rölanti = altın,
kritik = kendi token'ı. Yeşil YALNIZ donanım sinyali (kontak açık). Renk hiçbir
zaman tek anlam taşıyıcısı değil — ikon/etiket eşlik eder.

⚠️ **Bilinen çelişki:** bordo hem §2.3'te "filo kimliği" hem burada "mola durumu".
İkisi bugün aynı ekranda yan yana gelmediği için sorun çıkmıyor; bir gün gelirse
mola için ayrı bir ton açılacak. Bu not bilinçli — sessizce taşınan bir borç değil.

**Metin tonları:** aksan renkleri METİN olarak kullanılacaksa ayrı token gerekir —
`--accent-gold-text`, `--accent-sky-text`, `--accent-claret-text`. Dolgu tonu ile
metin tonu aynı değildir; gold/mavi beyaz üstünde 2.9:1 ve 4.0:1 ile AA'yı geçmez.

### 2.5 Grafik renkleri

- Ana seri: **mercan**. İkincil seri: nötr gri (`#909096` / `#7A7A80`).
- Filo kırılımında: bordo + mavi (2.3 gereği anlamlı).
- Izgara çizgileri: kenarlık renginin %40'ı. Eksen etiketleri üçüncül metin, 11–12px.
- **Yasak:** 5 renkli kategorik palet, gradient dolgu, 3B, gölgeli bar.

---

## 3. Tipografi

| Rol | Değer |
|---|---|
| Gövde ailesi | **Geist** (mevcut) — Inter/SF karakterinde grotesk |
| Mono ailesi | **Geist Mono** — Fingerprint'in JetBrains Mono rolünün karşılığı |
| Ağırlıklar | 400 gövde · 500 etiket/kontrol · 600 başlık · **700 yalnız büyük KPI değeri** |

**Ölçek** (Runey + Fingerprint ölçümlerinden):

| Kullanım | Boyut | Ağırlık |
|---|---|---|
| Sayfa başlığı | 28–32px | 600 |
| Sayfa alt başlığı | 13–14px | 400, ikincil renk |
| Kart/bölüm başlığı | 16–18px | 600 |
| Büyük KPI değeri | 24–28px | 700 |
| Gövde / tablo hücresi | 13–14px | 400 |
| Etiket, kontrol, çip | 12–13px | 500 |
| Eksen etiketi, meta | 11–12px | 400, üçüncül renk |

**Mono font ROLÜ (katı):** plaka · IMEI · request/kayıt id · saat ve süre · km ·
koordinat · para. Bunlar `tabular-nums` ile hizalanır. Gövde cümlesinde, başlıkta,
buton metninde mono YASAK.

Harf aralığı: başlıkta `-0.01em`, uppercase etikette `+0.04em`. Satır yüksekliği
başlıkta 1.2–1.3, gövdede 1.4–1.5.

---

## 4. Boşluk ve form

**Temel ızgara: 8px** (Fingerprint). 4px yalnız ikon-metin gibi mikro aralıklarda.

| Ölçü | Değer |
|---|---|
| Sayfa dış boşluğu | 24px (mobil 16px) |
| Kart iç boşluğu | 20–24px |
| Kart arası dikey boşluk | 16–24px |
| Bölüm arası | 32px |
| KPI kartları arası | 16px |
| Tablo satır yüksekliği | 48–56px |
| Nav rayı genişliği | 240–260px (masaüstü) |
| İçerik azami genişliği | 1100–1200px |

**Köşe yarıçapı** (Runey'in yumuşak dili):

| Öğe | Yarıçap |
|---|---|
| Büyük kart / panel | **16–20px** |
| Grafik ve tablo konteyneri | 16px |
| KPI kartı | 16px |
| Buton, input, dropdown | 10–12px |
| Çip / rozet / pill | tam yuvarlak |
| Nav rayı | 20px (yüzen panel) |

**Kenarlık ve gölge:** 1px kenarlık ana ayraçtır. Gölge YUMUŞAK ve nadir —
kartlarda `0 1px 2px rgba(0,0,0,0.04)`, yalnız popover/dialog/dropdown'da
`0 8px 24px rgba(0,0,0,0.10)`. Koyu temada gölge yerine kenarlık kontrastı artar.

---

## 5. Bileşen dili

### Nav rayı (imza öğe)
Yüzen, koyu (`#181818`), 20px köşeli, sayfa kenarından 12–16px içeride. Üstte marka
işareti, altta kullanıcı. Aktif öğe: mercan metin + mercan %12 zemin. Mobilde alt
çekmeceye iner. **Açık temada da siyah kalır** — Runey imzası budur.

### KPI kartı
Beyaz kart, 16px köşe, 20–24px iç boşluk. İçerik: küçük etiket (12px, üçüncül renk)
→ büyük değer (24–28px, 700, mono/nums) → küçük betimleyici (12px). Değişim rozeti
sağ üstte, yalnız anlamlıysa mercan. **KPI kartları renkli DEĞİL** — hepsi beyaz,
ayrım tipografiyle kurulur.

### Grafik kartı
Tam genişlik, başlık + alt başlık sol üstte, kontroller sağ üstte. Bar'lar yuvarlatılmış
uçlu, ana seri mercan. Hover'da dikey kesik çizgi + yumuşak gölgeli tooltip
(120–200ms fade). Boş veri → sönük ızgara + tek satır açıklama, asla boş beyazlık.

### Tablo
Başlık satırı: 12px, 500, üçüncül renk, uppercase, `+0.04em`. Satır 48–56px,
1px alt ayraç, hover'da `#F4F4F5`. Sayısal kolonlar sağa hizalı ve mono.
**Stripe kuralı:** sayısal kolonda hücre arka planına gömülü soluk oran bar'ı
(mercan %15) — sayı okunur kalır, bar sıralamayı görünür kılar.
Gruplama başlığı (ay, filo) satır arasında küçük yapışkan etiket.

### Buton
Birincil: koyu dolu (`#181818`) beyaz metin, 10–12px köşe, 36–44px yükseklik.
Yıkıcı olmayan vurgulu eylem: mercan dolu. İkincil: 1px kenarlıklı, şeffaf zemin.
Ghost: yalnız hover zemini. Basışta `translateY(1px)`.

### Çip / rozet
İnce, düşük doygunluk: ilgili rengin %12 zemini + tam renk metni, tam yuvarlak,
11–12px, 500. Filo çipleri bordo/mavi (2.3), durum çipleri durum rengi.

### Detay ekranı — künye satırı ve olay rayı (Enode/Clay, §0 DESTEK D+E)

Tek kaynak: `components/ui-v2/DetailSpec.tsx`. Sayfa-içi kopya yasak.

- **Üç kolon:** nav (kabuk) · orta künye · sağ olay rayı. `xl` altında tek
  kolona iner ve ray künyenin ALTINA geçer (üstüne değil — mobilde araç
  kimliği önce gelir). Ray **yapışkan değildir**: olay sayısı önceden bilinmez,
  uzun ray sticky'de viewport'a kilitlenir.
- **Künye satırı:** etiket solda ikincil tonda (%38 genişlik), değer sağda
  birincil tonda, satır 44px, aralarında yalnız ince ayraç. Dikey çizgi yok,
  kutu içinde kutu yok. Kimlik/ölçüm değerleri mono (§3).
- **Bölüm işareti:** başlığın solunda 3px çubuk. VARSAYILAN NÖTR; mercan yalnız
  sayfanın "canlı" grubunda (`accent`) yanar. Dört grubun dördünde de mercan
  olsaydı §2.2'nin 3-6 dokunuş bütçesi tek başına tükenirdi.
- **Düzenlenebilir satır** sağında "Düzenle" taşır ve bu eylem GİZLENMEZ
  (hover'da belirmez). Sessiz kalması için üçüncül tonda durur, hover'da mercan.
- **Olay kartı:** ikon madalyonu + başlık + zaman + kendi eylemi. Olayın
  ağırlığı yalnız madalyonda yaşar; kart kenarına renkli şerit ÇEKİLMEZ
  (ne Enode ne Clay'de var, ve yan şerit üretilmiş-arayüz klişesidir).
- **Mini harita** bir DEĞERdir, araç değil: Konum satırının altında dar bant,
  tüm etkileşim kapalı (dar bantta tekerlek zumu kaydırma kapanı olur). Gerçek
  gezinme Rota oynatıcıdadır.

### Boş durum
Kartın içinde, ortalanmış, tek satır başlık + tek satır açıklama + varsa tek aksiyon.
İllüstrasyon yok. (Missive dersi: veri sıfırken de ekran ayakta kalır.)

---

## 6. Mikro etkileşim

- Süre **150–250ms**, easing `cubic-bezier(0.25, 0.1, 0.25, 1)`.
- Tooltip fade 120–200ms · sekme geçişi 160–200ms · grafik çizimi 600–900ms
  (`cubic-bezier(.22,.9,.32,1)`, yalnız ilk yüklemede).
- İzin verilen: opacity, background-color, border-color, `translateY(1px)`.
- **Yasak:** bounce, spring, glow, gradient animasyonu, parallax, sürekli pulse.
- `prefers-reduced-motion` → tüm süreler 0.

---

## 7. Erişilebilirlik ve saha koşulu

- Kontrast AA: gövde ≥ 4.5:1, büyük metin ≥ 3:1. Koyu temada bordo metin YASAK (2.3).
- Odak halkası her etkileşimli öğede görünür.
- Dokunma hedefi ≥ 44px — şoförler vanda, tek elle, güneş altında kullanıyor.
- Renk tek anlam taşıyıcısı değil: her renkli duruma ikon veya metin eşlik eder.
- Geniş içerik (tablo, grafik) KENDİ kutusunda yatay kayar; sayfa gövdesi kaymaz.

---

## 8. Uygulama kuralları

1. Hiçbir bileşende ham hex/oklch yazılmaz — her renk `app/globals.css` token'ından gelir.
2. Yeni token eklenmeden önce bu belgede rolü tanımlanır.
3. Bir referansın token'ı rolü dışına taşınamaz (mercan CTA'dır, zemin olamaz;
   mono ölçümdür, gövde olamaz; bordo/mavi filodur, dekor olamaz).
4. Her iki tema da her PR'da kontrol edilir — biri kırıksa iş bitmemiştir.
