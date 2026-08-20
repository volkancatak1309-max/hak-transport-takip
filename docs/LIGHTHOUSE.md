# FAZ 5 — QA Raporu (Lighthouse + erişilebilirlik + mobil)

**Tarih:** 17.07.2026 · **Dal:** `redesign-ui-v2` · **Kapsam:** yönetici panelinin 10 sayfası
**Ortam:** `npm run build` + `npm start` (production build — dev server DEĞİL), gerçek admin oturumu (iron-session çerezi), Chromium headless.
**Lighthouse:** v12, varsayılan mobil profil (throttling açık). **Playwright:** ayrı QA harness'ı (konsol / kontrast / mobil / klavye / reduced-motion).

Ölçüm dosyaları geliştiricinin yerelinde: `scratchpad/qa-report.json`, `scratchpad/lh/*.json`.

---

## 1. Lighthouse skorları (production build)

| Sayfa | Perf | Erişilebilirlik | En İyi Uygulama | SEO | LCP | CLS |
|---|---:|---:|---:|---:|---:|---:|
| Yönetici | 77 | **100** | **100** | 100 | 5,9 s | 0 |
| Alarmlar | 81 | **100** | **100** | 100 | 5,0 s | 0 |
| Araçlar | 78 | **100** | **100** | 100 | 5,8 s | 0 |
| Seferler | 78 | **100** | **100** | 100 | 5,5 s | 0 |
| Harita | 61 | 96 | **100** | 100 | 4,8 s | 0,002 |
| Yakıt | 71 | **100** | **100** | 100 | 7,7 s | 0 |
| Masraflar | 81 | **100** | **100** | 100 | 4,9 s | 0 |
| Bölgeler | 78 | **100** | **100** | 100 | 5,8 s | 0 |
| Çalışanlar | 76 | **100** | **100** | 100 | 5,9 s | 0 |

**CLS 10/10 sıfır** (harita 0,002 — kayan harita döşemeleri, eşiğin çok altında).

## 2. Playwright QA taraması (10 sayfa)

| Kontrol | Sonuç |
|---|---|
| Konsol **hata** (masaüstü + mobil) | **0 / 10 sayfa** |
| Konsol **uyarı** | 0 — tek istisna harita (aşağıda) |
| WCAG AA kontrast ihlali | **0** |
| Mobil 390px yatay taşma | **0 px** |
| Dokunma hedefi < 24px | **0** (harita atıf linkleri hariç — istisna kapsamında) |
| `prefers-reduced-motion` altında süren animasyon | **0** |
| Odaklanabilir öğede focus halkası eksik | **0** (10 sayfada ilk 25 tab durağı denetlendi) |

---

## 3. Bulunan ve düzeltilen kusurlar

### 3.1 Bordo metin — tasarım sisteminin kendi yasası uygulanmamış (kontrast 1,98:1)
FAZ 2 (`DESIGN-SYSTEM.md` §2.3) şunu yazmış: *"Bordo koyu temada asla metin/ikon rengi olmaz — 1,9:1 FAIL. Bordo metinler `--accent-claret-text`'e taşınır."* Token `.dark` bloğunda **doğru** tanımlıydı (`oklch(0.78 0.1 12)` = 8,6:1) ama **göç hiç yapılmamıştı**: 12 yerde hâlâ ham `text-accent-claret` kullanılıyordu (KPI değerleri, ceza rozetleri, ikonlar).
→ 12/12 kullanım `text-accent-claret-text`'e taşındı. `bg-*` / `border-*` bordo kullanımlarına dokunulmadı (onlar dolgu, kural onları kapsamıyor).

### 3.2 `--text-tertiary` AA'yı geçmiyordu (4,09:1)
Koyu temada `oklch(0.55 0.012 256)` = ölçülen **4,09:1**; 12px normal metin için AA eşiği 4,5. Token seviyesinde bir kusur, yani tüm sayfalara yayılıyordu.
→ `oklch(0.6 0.012 256)` = **5,04:1** ✓ (ton korunarak pay bırakıldı).

### 3.3 Kritik rozet: yanlış token + kontrast FAIL (4,42:1)
`FleetDtcCard` kritik rozeti `bg-destructive/15 text-destructive` kullanıyordu — hem rozet zemininde **4,42:1** (11px için FAIL), hem de DESIGN-SYSTEM §2.3 yasa 3'e aykırı (*destructive yıkıcı EYLEM içindir; kritik DURUM için kritik token'lar*).
→ `bg-status-critical-soft text-status-critical` = **6,06:1** ✓ ve yasaya uygun.

### 3.4 Leaflet atıf linkleri okunmuyordu (3,23:1)
Leaflet'in varsayılan link rengi (#0078A8) atıf şeridinde **3,23:1**. Atıf **yasal zorunluluk**, kaldırılamaz.
→ Şerit zemini + link rengi okunur yapıldı (**7,4:1** ✓).
**Özgüllük tuzağı:** `leaflet.css` harita bileşenlerinin İÇİNDE import edildiği için `globals.css`'ten sonra yükleniyor; eşit özgüllükteki seçici sessizce kaybediyordu. Kural `.leaflet-container` ile sarılıp (0,3,0) yapıldı — ilk deneme tam da bu yüzden işe yaramamıştı.

### 3.5 Erişilebilir adı olmayan butonlar (`button-name`)
- **Yönetici**: üç filtre select'i (Tarih Aralığı / Çalışan / Durum) — `<Label>` görsel, `htmlFor` yok, trigger'da `aria-label` yok → ekran okuyucuda adsız.
- **Çalışanlar**: "PIN sıfırla" butonunun metni `hidden md:inline` — **dar ekranda gizlenince buton tamamen adsız kalıyordu**. Lighthouse mobil profilde koştuğu için ancak burada yakalandı.
→ Hepsine `aria-label` eklendi. **Yönetici erişilebilirlik 84 → 100.**

### 3.6 `label-content-name-mismatch` (WCAG 2.5.3 Label in Name)
OpsSummary tile'ları `aria-label="Sahadaki Şoför"` veriyordu ama görünen metin "0 SAHADAKİ ŞOFÖR" — erişilebilir ad görünen metni içermiyordu.
→ `aria-label={değer + " " + etiket}`: kural sağlanıyor ve ekran okuyucu artık sayıyı da duyuruyor.

### 3.7 `heading-order` — h1'den h3'e atlama
Pano `h1` → `RankingTile h3` diye gidiyordu (OpsSummary zaten `h2` kullanıyordu).
→ `RankingTile` ve `FleetDtcCard` başlıkları `h2` oldu; sıra h1 → h2 → h2.

### 3.8 Dokunma hedefi < 24px (WCAG 2.2 AA 2.5.8)
`HelpTip` (ⓘ) butonları 18×18, Araçlar chevron linki 16×16.
→ HelpTip gerçekten `size-6` (24×24), chevron linki 24×24 sarmalayıcı; ikon boyutları değişmedi.
**Kayda değer:** önce görünmez `::before` ile hedefi büyütmeyi denedim ve **tıklama testi geçti** (kutunun dışından tıklama butonu açıyordu). Ama axe/Lighthouse hedefi elemanın kutusundan ölçüyor ve 18×18 görüp uyarmaya devam etti. *Denetim aracının göremediği uyum, uyum sayılmaz* — buton gerçekten büyütüldü.

### 3.9 Mobilde okunaksız yazı (`font-size`)
Pano metninin yalnız **%42,75'i ≥12px** idi (%44,64 → 11px, %12,61 → 10px). Kaynak doğrudan klon spec'i: Reveal'ın **masaüstü** ölçüleri (11px etiket) telefona olduğu gibi inmişti.
→ Yoğun metinler mobilde ≥12px, `sm:` ve üstünde **klon ölçüsü aynen korundu** (`text-[12px] sm:text-[11px]`). Onaylanan masaüstü görünümü piksel piksel değişmedi.
Sonuç: Yönetici **%100 okunabilir**, Harita %59,91 → **%70,51**. Harita pin etiketleri ve atıf yazısı da mobilde 12px.

---

## 4. Düzeltilmeyenler — ve nedeni

### 4.1 Harita, dokunma hedefi (a11y 96)
Araç pinleri birbirini kısmen örtüyor (*"smallest space is 120px by 6px"*). Sebep düzen hatası değil: **araçlar fiziksel olarak yan yana park etmiş**. Doğru çözüm CSS değil, **marker kümeleme (clustering)** — ayrı bir özellik, bu turun kapsamı dışında. Yakınlaştırınca pinler ayrışıyor.

### 4.2 Harita, 4 konsol uyarısı
`GL Driver Message (OpenGL, Performance): GPU stall due to ReadPixels` — headless Chromium'un yazılım GPU katmanından gelen **sürücü** mesajı, uygulama kodu değil. Gerçek GPU'lu makinede görünmez. Gizlemek yerine raporlandı.

### 4.3 Harita, `valid-source-maps`
Production build source map yayımlamıyor (bilinçli). Kullanıcıya etkisi yok.

### 4.4 Performans 61–82
En düşük harita (61) — vektör döşeme + Leaflet + maplibre yükü; sonra Yakıt (71). Skorlar Lighthouse'un **varsayılan mobil throttling profilinde** ve **localhost prod** üstünde; Vercel'de CDN + gerçek ağla farklılaşır. **CLS = 0**, yani düzen kayması yok; asıl maliyet JS paketi ve harita motoru. Paket bölme / döşeme tembel yükleme ayrı bir performans turu işi — bu turda kapsam dışı tutuldu, kararı Volkan'ın.

---

## 5. Yöntem notu

QA harness'ı ilk turda **dokunma hedeflerini yanlış ölçüyordu** (elemanın kutusuna bakıyor, `::before` ile genişletilmiş gerçek hedefi göremiyordu) ve bir tıklama testi bunu ortaya çıkardı. Ayrıca ilk hit-test'in kendisi de geçersizdi: eleman görüntü alanının dışındayken koordinatla tıklamak hiçbir şeye denk gelmiyordu — kontrol testi (`merkeze tıkla, değişiyor mu?`) eklenince anlaşıldı.

Bunun dersi rapora da yansıdı: **kendi aracına güvenme, iki bağımsız ölçüm kullan.** Lighthouse benim harness'ımın kaçırdığı 5 gerçek kusuru (§3.5–3.9) yakaladı; harness da Lighthouse'un bakmadığı reduced-motion ve mobil taşmayı kapattı.
