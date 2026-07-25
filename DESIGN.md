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

### Korunacak imza özellikler (Runey'den — bunlar pazarlık dışı)

1. **Yüzen siyah nav rayı** — kenara yapışık değil, yuvarlatılmış, koyu panel.
2. **Sıcak açık zemin** (`#FBFBFB` ailesi) + üstünde **beyaz kartlar** — soğuk gri-mavi değil.
3. **Tek aksan rengi.** Mercan. Başka hiçbir dekoratif renk yok.
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

### 2.1 Nötr taban

| Rol | Açık (varsayılan) | Koyu | Not |
|---|---|---|---|
| Sayfa zemini | `#FBFBFB` — sıcak, hafif gri | `#121213` | Runey / Polar ölçümü |
| Kart yüzeyi | `#FFFFFF` | `#18181A` | Kart zeminden AYRIŞIR |
| Yükseltilmiş yüzey (hover, popover) | `#F4F4F5` | `#1F1F22` | |
| Nav rayı | `#181818` (her iki temada da KOYU) | `#0E0E0F` | İmza öğe — açık temada da siyah |
| Birincil metin | `#181818` | `#F2F3F5` | |
| İkincil metin | `#747474` | `#A0A0A3` | |
| Üçüncül metin / etiket | `#919191` | `#6A6B6F` | |
| Kenarlık / ayraç | `#E6E9EB` | `rgba(255,255,255,0.08)` | 1px, Fingerprint ölçümü |

### 2.2 Tek aksan — mercan

| Token | Açık | Koyu | Kullanım |
|---|---|---|---|
| `--accent-coral` | `#F15857` | `#FF6F6E` | Birincil buton, aktif nav, grafik ana serisi, vurgu değeri |
| `--accent-coral-soft` | `#F15857` @ 12% | `#FF6F6E` @ 18% | Rozet zemini, seçili satır |

**Disiplin:** aksan, ekranın boyalı alanının **%10'unu geçemez**. Büyük dolu mercan
blok yok. İki mercan öğe yan yana gelmez — sayfada bir "en önemli şey" vardır.

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

Operasyonel durum renkleri değişmiyor (mevcut sistem doğru): aktif = mavi,
mola = bordo, rölanti = altın, kritik = `oklch(0.55 0.2 27)`. Yeşil YALNIZ donanım
sinyali (kontak açık). Renk hiçbir zaman tek anlam taşıyıcısı değil — ikon/etiket eşlik eder.

### 2.5 Grafik renkleri

- Ana seri: **mercan**. İkincil seri: nötr gri (`#919191` / `#6A6B6F`).
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
