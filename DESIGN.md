# HAK61 — Design System

Hedef: Linear / Vercel / Stripe dashboard seviyesi. Elit, minimal, premium.
AI-template estetiği yok. Sadece görsel katman — çalışan mantık (auth, GPS, harita,
vardiya, sefer, raporlar, Supabase, Telegram) aynen korunur.

---

## 1. Felsefe

- **Nötr taban, minimal vurgu.** Arayüzün %95'i nötr gri/koyu tonlardır. Renk
  sadece anlam taşıdığı yerde kullanılır (aktif menü, canlı durum, birincil eylem).
- **Sessiz lüks.** Gradient yok, neon yok, glow yok, gölge bombardımanı yok.
  Derinlik; ince 1px kenarlık + hafif yüzey kontrastı ile kurulur.
- **İçerik kahramandır.** Veri (saat, km, konum) okunaklı; kromu görünmezdir.
- **Saha-önce.** Şoförler vanda, güneş altında, tek elle kullanıyor. Büyük dokunma
  alanları (min 44px), yüksek kontrast, hızlı tepki.

---

## 2. Renk Token'ları (OKLCH)

Tek merkezi kaynak: `app/globals.css`. Tüm renkler semantik token üzerinden gider —
hiçbir component'te ham hex/oklch yazılmaz.

### Nötr taban

| Token | Koyu (varsayılan) | Açık | Kullanım |
|---|---|---|---|
| `--background` | `oklch(0.165 0.006 256)` | `oklch(0.985 0.002 256)` | Sayfa zemini |
| `--card` (yüzey) | `oklch(0.205 0.007 256)` | `oklch(1 0 0)` | Kart, panel |
| `--surface-2` (yüksek) | `oklch(0.245 0.008 256)` | `oklch(0.975 0.003 256)` | Hover, popover, seçili |
| `--border` | `oklch(1 0 0 / 9%)` | `oklch(0.915 0.004 256)` | 1px hatlar |
| `--foreground` (metin-1) | `oklch(0.975 0.003 256)` | `oklch(0.235 0.02 262)` | Başlık, değer |
| `--muted-foreground` (metin-2) | `oklch(0.72 0.012 256)` | `oklch(0.5 0.016 262)` | İkincil metin |
| `--text-tertiary` (metin-3) | `oklch(0.55 0.012 256)` | `oklch(0.62 0.012 262)` | Etiket, ipucu |

### Marka aksanı (MİNİMAL — asla baskın değil)

| Token | Değer | Hex ~ | Nerede |
|---|---|---|---|
| `--accent-claret` (bordo) | `oklch(0.52 0.19 16)` | `#a01a33` | Birincil buton, aktif menü, marka |
| `--accent-sky` (gök mavisi) | `oklch(0.72 0.13 233)` | `#33b1e1` | Canlı/durum göstergesi, link, vurgu |

- `--primary` = **claret**. Birincil eylem ve aktif navigasyon.
- Canlı nokta / "aktif vardiya" pulse = **sky**.
- `--destructive` (9 saat aşımı, sil) ayrı bir uyarı kırmızısı `oklch(0.58 0.21 25)` —
  claret'ten ayrışır, çakışmaz.

Aksanlar yüzey alanının **>%10'unu kaplamaz**. Büyük dolu renk bloğu yasak.

---

## 3. Tipografi

- Aile: **Geist** (Inter ailesi karakterinde, temiz grotesk). Mono: Geist Mono (sayılar).
- Ağırlık: yalnız **400** (gövde) ve **500–600** (başlık/vurgu). 700 yalnız büyük KPI değerleri.
- Sayısal veri `nums` (tabular-nums + mono): saat, km, plaka, telefon hizalı kalır.
- Ölçek: 12 / 13 / 14 (gövde) / 16 / 20 / 24 / 30 (KPI). Satır yüksekliği rahat (1.4–1.5).
- Harf aralığı: başlıklarda hafif negatif (-0.01em), etiketlerde uppercase + +0.04em.

---

## 4. Boşluk & Form

- 4px grid. Bileşen iç boşluğu 12–16–24. Bölüm arası 24.
- **Radius:** kartlar 14px (`--radius`), iç öğeler 10–12px, pill/rozet tam yuvarlak.
- **Kenarlık:** 1px, `--border`. Gölge minimal — sadece popover/dialog/dropdown'da
  yumuşak `0 1px 2px / 0 8px 24px` çift katman.
- Boşluk cömert. Sıkışıklık yok; nefes alan layout.

---

## 5. Mikro Etkileşim

- Süre 150–250ms. Easing **Apple** `cubic-bezier(0.25, 0.1, 0.25, 1)`.
- Sadece: opacity, background-color, border-color, hafif `translateY(1px)` (buton basışı),
  `scale(1.02)` (harita pin hover).
- **Yasak:** bounce, spring, neon, glow, gradient animasyonu, aurora, parallax.
- Sayfa girişi: 240ms ince fade + 4px yukarı kayma (`page-enter`).
- Canlı durum: 2.4s yumuşak opacity pulse (sky), keskin yanıp sönme yok.

---

## 6. Component Kuralları

- **Sidebar (sol menü):** sabit 240px (masaüstü), ikon+etiket. Aktif öğe: claret
  metin + claret/12% zemin + sol 2px claret çizgi. Mobilde gizlenir → topbar hamburger.
- **Topbar (üst bar):** 56–64px, yarı saydam + backdrop-blur, alt 1px hat. Sol: sayfa
  başlığı. Sağ: canlı saat, tema toggle, dil, kullanıcı menüsü.
- **KPI kart:** etiket (uppercase, metin-3) + büyük değer (nums). Vurgu yalnız anlamlıysa
  (aktif > 0 → sky, aşım > 0 → destructive). Aksi halde nötr.
- **Harita:** kart içinde, üst köşeleri kesik, 1px çerçeve. Pin = claret daire + ak
  kenar. Rota çizgisi claret %60 opacity.
- **Şoför listesi:** harita yanında/altında satır listesi — avatar, ad, plaka, "X dk
  aktif", canlı sky nokta. Satır hover → surface-2.
- **Buton:** birincil = claret dolu; ikincil = outline 1px; ghost = sadece hover zemin.
  Yükseklik 36–44px (mobil dokunma).
- **Rozet/Badge:** ince, düşük doygunluk, ilgili aksanın %12 zemini + tam renk metni.

---

## 7. Tema Davranışı

- **Koyu varsayılan.** Açık/koyu toggle kullanıcıda; tercih `localStorage`'da saklanır
  (`next-themes`, `attribute="class"`). İlk yüklemede FOUC yok (`suppressHydrationWarning`).
- Tüm token'lar hem koyuda hem açıkta tanımlı; hiçbir component tema-özel hex yazmaz.
- Geçiş: zemin + metin renkleri 240ms yumuşak geçer.

---

## 8. Erişilebilirlik

- Metin/zemin kontrastı AA (gövde ≥ 4.5:1, büyük ≥ 3:1).
- Odak halkası her etkileşimli öğede görünür (`ring` token).
- Dokunma hedefi ≥ 44px. Renk tek anlam taşıyıcısı değil (ikon/etiket eşlik eder).
