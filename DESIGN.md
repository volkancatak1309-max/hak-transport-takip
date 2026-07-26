# HAK61 — TASARIM KİLİDİ

**Durum:** kilitli · **Tarih:** 27.07.2026 · **Karar:** Volkan
**DNA:** **Authkit** — *"gece yarısı buzlu cam katedrali"*

> Bu dosya 27.07.2026'da **baştan yazıldı**. Önceki sürüm (Runey taban + "Ui"
> sade/klinik yönü) `docs/DESIGN-ui-arsiv.md` dosyasında ve git geçmişinde
> duruyor. Çelişkide **bu dosya** kazanır.
>
> **"Ui" (shadcn) yönü İPTAL** — düz beyaz kutu + ince halka fazla sade ve ucuz
> göründü. Kanvas=kart beyaz kararı, halka-yükselti ve DESTEK F rolü geçersizdir.

---

## 0. Referans kilidi

| Rol | Kaynak | Refero ID |
|---|---|---|
| **DNA — BİRİNCİL** · yüzey, ışık, derinlik, cam, buton dili | **Authkit** · authkit.com | `9712d1d1-ef0a-4a9d-a266-57f5cd2a34b7` |
| YAPI A · pano iskeleti, operasyon konsolu | Stellate | `e8b04517-1949-47d0-9faa-23a79f651802` |
| YAPI B · tablo, kayıtlı görünüm, filtre çipi | Aboard | `40c5d8d6-7995-463b-a559-aa050c69e59d` |
| YAPI C · detay künye satırı (etiket sol / değer sağ) | Enode | `77cf19d7-fb3d-41bd-bc69-3e1bddb42f1a` |
| YAPI D · üç kolon + olay rayı + mini harita bandı | Clay | `754179d7-6fe2-4e21-9edc-bbaf45bd9ff1` |
| YAPI E · mono font rolü, 8px ızgara | Fingerprint | `fa27b73e-e27a-4249-b08e-8af912b3ad26` |

**Kritik ayrım:** Authkit **CİLTTİR** (yüzey, ışık, renk, tipografi, buton).
Stellate/Aboard/Enode/Clay **İSKELETTİR** (dizilim, kolon, gruplama, davranış).
27.07'de cilt değişti; **iskeletlerin hiçbiri değişmedi.**

### Reddedilenler

Düz beyaz kutu + ince çizgi felsefesi · gradient metin · aurora/neon ·
çok renkli grafik paleti · dekoratif serif başlık · her kartın farklı renkte
olduğu KPI ızgarası · mor aksan (Authkit'in Neon Violet'i alınmadı).

---

## 1. Tema

**KOYU VARSAYILAN.** Açık tema tam desteklenir ve **aynı DNA'dan türetilir** —
aynı mizanpaj, aynı ritim, aynı ışık yönü.

### Işık yasası (tek cümle)

**Işığın YÖNÜ değişmez, ORTAM değişir.** Işık her iki temada da ÜSTTEN gelir.
Koyuda cam ışığı **yakalar** (üst kenarda beyaz iç çizgi, içeride yayılan hale).
Açıkta cam gölge **düşürür** (üst kenar çizgisi kalır, içerideki hale yerini
yumuşak iç gölgeye bırakır).

| Katman | Koyu | Açık |
|---|---|---|
| Üst kenar ışığı | `inset 0 1px 1px rgba(199,211,234,.12)` | `inset 0 1px 1px rgba(255,255,255,.90)` |
| İç hale / iç gölge | `inset 0 24px 48px rgba(199,211,234,.05)` | `inset 0 24px 48px rgba(20,20,35,.035)` |
| Dış gölge | `0 24px 32px rgba(6,6,14,.70)` | `0 16px 32px rgba(20,20,35,.10)` |

**Açık tema zemini SAF BEYAZ OLAMAZ.** Tonlu alandır (`#EEF0F5`): camın
bulanıklaştıracak bir zemini olmalı — beyaz üstünde beyaz cam görünmez.
(26.07'nin "kanvas = kart = beyaz" kararı bu yüzden geçersizdir.)

Geçiş: zemin + metin 240ms yumuşak; layout HİÇ değişmez.

---

## 2. Renk

### 2.1 Nötr taban (Authkit)

| Rol | Koyu (varsayılan) | Açık |
|---|---|---|
| Sayfa zemini | `#05060F` | `#EEF0F5` |
| Cam panel yüzeyi | `rgba(186,214,247,.03)` | `rgba(255,255,255,.55)` |
| Katı kart (cam DEĞİL) | `#0A0B14` | `#FFFFFF` |
| Panel / inset (tablo başlığı, zebra) | `rgba(186,214,247,.05)` | `rgba(20,20,35,.035)` |
| Hover / seçili | `rgba(186,214,247,.08)` | `rgba(20,20,35,.06)` |
| Kenarlık / ayraç | `rgba(186,215,247,.12)` | `rgba(20,20,35,.10)` |
| Nav rayı | `#05060F` | `#0A0B14` |
| Metin — birincil | `#FFFFFF` | `#14151C` |
| Metin — gövde | `#D8ECF8` | `#2A2C36` |
| Metin — ikincil | `#C7D3EA` | `#565A69` |
| Metin — üçüncül | `#9DA7BA` | `#6B6F7D` |

### 2.2 Aksan haritası — Authkit rolleri bizim renklerimizle

| Authkit rolü | HAK61 karşılığı |
|---|---|
| Neon Violet `#663af3` — birincil eylem, kritik CTA | **MERCAN** |
| Accent Element Glow — sıcak ikincil hale | **BORDO** |
| Celestial Light / System Highlight Border — odak, cam kenar ışığı, canlı | **MAVİ** |

**Mor ALINMADI.** Mercan birincil aksandır; **bordo ve mavi artık paletin tam
üyesidir** — yalnız filo rozeti değil: grafik serileri, bölüm işaretleri,
ikincil vurgular, odak halkası, canlı göstergeler.

| Token | Koyu | Açık |
|---|---|---|
| `--accent-coral` | `#FF6F6E` | `#F15857` |
| `--accent-coral-fg` (dolu mercan üstü mürekkep) | `#121213` | `#181818` |
| `--accent-claret` (bordo) | `oklch(.78 .10 12)` | `oklch(.40 .142 31)` |
| `--accent-sky` (mavi) | `#8FB8E8` | `oklch(.58 .085 240)` |

Filo kimliği (bordo = bordo filo, mavi = mavi filo) **veri taşır**, süs değildir;
`lib/vehicle-ui.ts` → `FLEET_STYLE` tek kaynak olarak KALIR.

### 2.3 Durum renkleri — ÖLÇÜLDÜ (27.07.2026)

Koyu cam üstünde üç sıcak renk yan yana gelince ölçüldü (ΔE2000):

| Çift | ΔE | Karar |
|---|---|---|
| mercan ↔ bordo | 12.8 | ✅ ayrışıyor — **bordo'ya DOKUNULMADI** |
| bordo ↔ kritik | 15.8 | ✅ |
| **mercan ↔ kritik (eski)** | **4.1** | ❌ **KARIŞIYOR** |
| mercan ↔ kritik (yeni) | **13.5** | ✅ düzeltildi |

`--status-critical` **KOYU**: `oklch(.70 .18 28)` → **`oklch(.62 .24 26)`**
(cam üstünde kontrast 4.77). **Açık tema ölçüldü ve DEĞİŞMEDİ** — mercan↔kritik
16.3, bordo↔kritik 13.7, zaten ayrışıyor.

> Hipotez yanlış çıktı: "bordo koyulaşsın" diye başlandı, ölçüm bordo'nun
> güvenli, kritiğin mercanla neredeyse aynı renk olduğunu gösterdi. Karar
> sezgiyle değil ölçümle verildi.

Altın (rölanti) ve yeşil (YALNIZ donanım kontak sinyali) kuralları aynen korunur.
**Renk hiçbir zaman tek anlam taşıyıcısı değildir** — ikon + etiket eşlik eder.

### 2.4 Grafik renkleri

Ana seri **mercan**, ikinci seri **bordo**, üçüncü seri **mavi**, dördüncü nötr gri.
Izgara çizgileri kenarlık renginin %40'ı. **Yasak:** 5+ renkli kategorik palet,
gradyan dolgu, 3B, gölgeli bar.

---

## 3. CAM — ana yüzey dili

Cam bir **malzeme** değil, bir **katman işareti**dir: bulanıklık görünce göz
"bu şey içeriğin ÜSTÜNDE yüzüyor" der.

### 3.1 Cam VAR

Yalnız **BÖLÜM PANELİ**: KPI şeridi · grafik kartı · tablo/liste konteyneri ·
çekmece ve dialog · kayan üst bar · harita üstü panel.

### 3.2 Cam YOK

Panelin **İÇİNDEKİ** her şey: tablo satırı · KPI kutucuğu · rozet · form alanı ·
olay kartı · künye satırı. Bunlar camın **üstünde** yaşar, kendileri cam olmaz.

> Gerekçe: bir tablo sayfasında 20 kart vardır. Hepsi cam olsaydı hem aşağıdaki
> sınır çiğnenirdi hem "yüzen katman" işareti anlamını yitirirdi.

### 3.3 Sayısal sınır

**Ekranda en fazla 3 bulanık katman.** Pratikte üst bar (1) + en çok 2 bölüm
paneli. **Şoför paneli (telefon) HAFİF VARYANT kullanır:** `backdrop-filter`
YOK, düz tonlu yüzey + aynı iç-ışık gölgesi. Kamyonetteki 5 yıllık Android'de
blur kaydırmayı takar; okunurluk aynı kalır, yalnız bulanıklık gider.

### 3.4 Değerler

| Ölçü | Değer |
|---|---|
| Bulanıklık | 14px (`--glass-blur`) |
| Cam yüzey | koyu `rgba(186,214,247,.03)` · açık `rgba(255,255,255,.55)` |
| Gölge | §1'deki üç katman |
| Yarıçap | 16px |
| Geri düşüş | `prefers-reduced-transparency` → düz `--glass-solid`, blur kalkar |

**Authkit kuralı aynen:** *"generic drop-shadow kullanma"* — derinlik iç gölge +
yumuşak dış hale ile kurulur, kutuya gölge yapıştırarak değil.

---

## 4. Tipografi

| Rol | Değer |
|---|---|
| Başlık | **Geist** 600 — Authkit'in aeonikPro rolü |
| Gövde / arayüz | **Geist** 400/500, harf aralığı `-0.01em` |
| Mono (`tabular-nums`) | **Geist Mono** |

**Ölçek** (Authkit): caption 12/1.5 · body 14/1.5 · body-lg 16/1.5 ·
subheading 18/1.43 · heading 24/1.33 · heading-lg 28/1.2 · display 44/1.16.

**Mono ROLÜ (katı):** plaka · IMEI · kayıt id · saat ve süre · km · koordinat ·
para. Gövde cümlesinde, başlıkta, buton metninde mono **YASAK**.

---

## 5. Boşluk ve form

**Yoğunluk: comfortable** (Authkit). Temel ızgara **8px**.

| Ölçü | Değer |
|---|---|
| Öğe arası | 8px |
| Kart içi boşluk | **24px** |
| Bölüm arası | **48px** |
| Sayfa dış boşluğu | 24px (mobil 16px) |
| Tablo satır yüksekliği | 48–56px |
| İçerik azami genişliği | 1200px |

**Yarıçap (Authkit):**

| Öğe | Yarıçap |
|---|---|
| Cam panel | **16px** |
| İç kart | 12px |
| Buton, pill | **999px** (tamamı) |
| Rozet | 6px |
| Input | 8px |

---

## 6. Bileşen dili

### Buton — hepsi pill (999px)

| Rol | Dil |
|---|---|
| **Birincil** | dolu **mercan** + `--accent-coral-fg` mürekkep |
| **İkincil** | şeffaf + `inset 0 0 0 1px rgba(186,215,247,.12)` (Authkit outline) |
| **Ghost** | yalnız hover zemini |
| **Yıkıcı** | `--destructive` metin + soft zemin |

Basışta `translateY(1px)`. Ekranda **tek** dolu mercan buton olur.

### Nav rayı
İmza öğe. İki temada da koyu, yüzen, 16px yarıçap. Aktif öğe: mercan zemin +
mercan çizgi.

### Ayraç
Authkit'in gradyan çizgisi serbest:
`linear-gradient(90deg, transparent, rgba(186,215,247,.12), transparent)`.
**Bu, gradyan yasağının TEK istisnasıdır** — ayraçtır, dolgu değil.

### Boş durum
Veri sıfırken ekran ayakta kalır: ikon + tek cümle + (varsa) eylem.

---

## 7. Erişilebilirlik ve saha koşulu

- Metin AA **4.5:1**; ≥24px veya ≥18.66px/700 için 3:1.
- **Ölçüm EN KÖTÜ ZEMİNLE yapılır** — çip kendi tinti üstünde, cam kendi yüzeyi
  üstünde ölçülür. *"Beyazda geçiyor"* onay değildir.
- **Dolgu tonu ≠ metin tonu.** Aksan metin olacaksa `*-text` türevi kullanılır.
- Renk tek anlam taşıyıcısı değil; ikon/etiket eşlik eder.
- `prefers-reduced-motion` ve `prefers-reduced-transparency` desteklenir.
- Dokunma hedefi **≥44px** — şoför paneli eldivenle, güneş altında kullanılır.

---

## 8. Uygulama kuralları

1. Bileşende **ham hex yazılmaz**; her renk token'dan gelir.
2. Yeni token eklenmeden önce rolü **bu belgede** tanımlanır.
3. Bir token rolünün dışına çıkarılamaz (dolgu ≠ metin ≠ kenarlık).
4. `.glass-panel` yalnız §3.1'deki yerlerde kullanılır; §3.2 listesi `.surface-card`.
5. Yapısal iskelet (Stellate/Aboard/Enode/Clay) cilt değişiminde **KORUNUR**.
6. **Veri ve işlev kaybı sıfır** — cilt değişimi davranış değiştirmez.
