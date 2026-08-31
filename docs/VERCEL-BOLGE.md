# Vercel fonksiyon bölgesi — ölçüm

> 28.08.2026 · 🔴 **SALT OKUMA + ÖLÇÜM TURU.** Hiçbir ayar değiştirilmedi,
> deploy edilmedi, push yapılmadı, kodda tek harf değişmedi.
> Kaynak: [`docs/ANALIZ-YAVASLIK.md`](ANALIZ-YAVASLIK.md) yayın turunda çıkan
> `x-vercel-id: fra1::iad1` yan bulgusu.

---

> 🔴 **31.08.2026 — BU BELGE KISMEN BAYAT.** Fonksiyon bölgesi DEĞİŞMİŞ.
> `x-vercel-id` yeniden ölçüldü (5 örnek × 3 kiracı, hepsi tutarlı):
>
> | kiracı | fonksiyon | Supabase | |
> |---|---|---|---|
> | HAK61 | **`dub1`** (Dublin) | eu-west-1 (Dublin) | ✅ aynı bölge |
> | Sendigo | **`fra1`** (Frankfurt) | eu-central-1 (Frankfurt) | ✅ aynı bölge |
> | galzura-demo | **`fra1`** (Frankfurt) | eu-central-1 (Frankfurt) | ✅ aynı bölge |
>
> Yani aşağıdaki "iad1" tespiti ve ona dayanan **92 ms/sorgu** rakamı artık
> geçerli değil; § 3'ün "beklenen kazanç ≈ 5,8 sn" öngörüsü büyük ölçüde
> **gerçekleşmiş** görünüyor. Yeni RTT ölçülmedi — o ayrı bir tur.
> Bunun CO₂ süresine etkisi: [`CO2-SURE.md`](CO2-SURE.md) § 1.3a.

## 0 · KISA CEVAP

| soru | cevap | nasıl |
|---|---|---|
| Fonksiyon nerede koşuyor? | **iad1 — Washington DC, ABD** | `x-vercel-id`, 5 uç × 5 örnek = **25/25** aynı |
| HAK61 Supabase nerede? | **eu-west-1 — İrlanda (Dublin)** | AWS `ip-ranges.json` CIDR eşleşmesi |
| Sendigo Supabase nerede? | **eu-central-1 — Frankfurt** | aynı yöntem |
| galzura-demo? | **eu-central-1 — Frankfurt** *(28.08 akşamı netleşti, Volkan)* | § 1.3 |
| Repoda bölge ayarı var mı? | **YOK** — `vercel.json` yok, `vercel.ts` yok, `preferredRegion` hiçbir yerde geçmiyor | grep |
| Gecikme maliyeti? | **iad1 → İrlanda ≈ 92 ms/sorgu**, Analiz ekranında **~5,9 sn** | § 3 |

🔴 **Ve bir sürpriz:** HAK61'in Supabase'i Frankfurt'ta DEĞİL, **İrlanda'da**.
Yani doğru hedef bölge `fra1` değil **`dub1`** (Dublin). Sendigo için `fra1`
doğru. **İki kiracı iki farklı bölge istiyor** — ayrı Vercel projeleri
oldukları için bu mümkün.

---

## 1 · SUPABASE BÖLGELERİ — ÖLÇÜLDÜ

### 1.1 Yöntem

`<ref>.supabase.co` (PostgREST ucu) **Cloudflare arkasında** — çözümlenen IP
(104.18.38.10 / 172.64.149.246) Cloudflare'in, bölgeyi göstermez.
`db.<ref>.supabase.co` ise **doğrudan AWS**'ye çözülüyor. O IPv6 adresi
AWS'nin kendi yayımladığı `ip-ranges.json` dosyasıyla **CIDR içerme testine**
sokuldu (string eşleşmesi değil, 128-bit önek karşılaştırması).

### 1.2 Sonuç `[DOĞRULANDI]`

| kiracı | `db.<ref>` IPv6 | AWS öneki | **bölge** |
|---|---|---|---|
| **HAK61** | `2a05:d018:175d:b601:…` | `2a05:d018::/35` (AMAZON/EC2) | **eu-west-1 · İrlanda** |
| **Sendigo** | `2a05:d014:128e:9500:…` | `2a05:d014::/35` (AMAZON/EC2) | **eu-central-1 · Frankfurt** |

Devir belgesindeki "Frankfurt + İrlanda" ifadesiyle **uyumlu** — ama hangisinin
hangisi olduğu şimdi kesin.

### 1.3 galzura-demo — **eu-central-1 (Frankfurt)** ✅ ÇÖZÜLDÜ

> Bu satır 28.08.2026 öğleden sonra **ÖLÇÜLEMEDİ** idi (service key ve proje
> URL'si bende yoktu). Volkan Supabase panelinden doğruladı: **eu-central-1,
> Frankfurt.** Kaynak ölçüm bana ait değil, panel okumasıdır.

Dolayısıyla üç kiracının tam eşleşmesi:

| kiracı | Supabase | doğru Vercel bölgesi |
|---|---|---|
| HAK61 | eu-west-1 (İrlanda) | `dub1` |
| Sendigo | eu-central-1 (Frankfurt) | `fra1` |
| **galzura-demo** | **eu-central-1 (Frankfurt)** | **`fra1`** |

---

## 2 · VERCEL'DE BÖLGE AYARI NEREDE

### 2.1 Üç ayrı yer var, repoda HİÇBİRİ kullanılmıyor `[DOĞRULANDI]`

| yer | ne yapar | repoda |
|---|---|---|
| **Proje ayarı** (Dashboard → Settings → Functions → Function Region) | tüm fonksiyonların varsayılan bölgesi | ayar dosyasında iz yok; **fiilen `iad1`** |
| `vercel.json` → `"regions": [...]` | proje ayarını dosyadan ezer | **DOSYA YOK** |
| `vercel.ts` (yeni biçim) | aynısı, TypeScript'le | **DOSYA YOK** |
| Rota başına `export const preferredRegion = "dub1"` (Next.js) | tek rota için ezer | **hiçbir dosyada geçmiyor** (grep: `app/`, `lib/`, `next.config.ts`, `package.json`) |

`next.config.ts` yalnız `reactStrictMode` ve `optimizePackageImports` içeriyor —
bölgeyle ilgisi yok.

**Sonuç: bölge hiçbir yerde belirtilmemiş, Vercel proje varsayılanı geçerli ve
o varsayılan `iad1`.**

### 2.2 Fonksiyonun gerçekten iad1'de koştuğu — iki bağımsız kanıt

**(a) Başlık** `[DOĞRULANDI]`: 5 farklı uç × 5 örnek = 25 istek, hepsinde
`x-vercel-id: fra1::iad1::…`. Yanıtta bölge veren başka başlık yok
(`x-vercel-execution-region` gönderilmiyor).

**(b) Gecikme** `[DOĞRULANDI]`: ölçülen sorgu başına RTT **92 ms** (§ 3.1).
Fonksiyon `fra1`de koşsaydı Frankfurt→İrlanda **~20-25 ms** olurdu; `iad1`den
İrlanda'ya ~75-95 ms tipiktir. Ölçüm başlığı doğruluyor.

---

## 3 · GECİKME — ÖLÇÜLDÜ

### 3.1 Sorgu başına RTT: **92 ms**

Yerel/uzak karşılaştırması **işe yaramaz**, çünkü ölçüldü: benim makinem de
İrlanda'ya uzak (min **96 ms**, medyan 105). Yani "yerelde hızlı, Vercel'de
yavaş" farkı RTT'yi izole etmiyor.

Bunun yerine **dağıtılmış uçların kendi aralarındaki eğimi** kullanıldı — iki
uç, bilinen ve SIRALI sorgu sayılarıyla:

```
/api/mobile/score-config   1 sorgu   → 290 ms (min, 5 örnek)
/api/mobile/fleets         6 sorgu   → 749 ms (min, 5 örnek)
                                       ───────
RTT = (749 − 290) / (6 − 1)         =  91,8 ms/sorgu
sabit taban (benim→Vercel + fonksiyon) = 290 − 92 = 198 ms
```

Karşılaştırma için benim makinemden ölçülen RTT'ler:

| hedef | min | medyan |
|---|---:|---:|
| HAK61 Supabase (eu-west-1) | 96 ms | 105 ms |
| Sendigo Supabase (eu-central-1) | 69 ms | 142 ms |

### 3.2 Analiz ekranında ne kadarı RTT

Ölçülen dağıtılmış süreler (5 örnek, min):

| uç | sorgu | süre | türetilen **etkin sıralı derinlik** |
|---|---:|---:|---:|
| score-config | 1 | 0,290 sn | 1 |
| me | 2 | 0,408 sn | 2 |
| fleets | 6 | 0,749 sn | 6 |
| **analytics** | **187** | **6,083 sn** | **~64** |
| dashboard | 188 | 2,314 sn | ~23 |

> Derinlik = `(süre − 198 ms) / 92 ms`. dashboard'ın 188 sorgusu analytics'in
> 187'sinden daha paralel olduğu için 2,6× daha hızlı — **sorgu sayısı tek
> başına süreyi belirlemiyor, SIRALI DERİNLİK belirliyor.**

**Formül ve tahmin** `[VARSAYIM]`:

```
t(bölge) = 198 ms  +  derinlik × RTT(bölge→Supabase)

analytics, bugün (iad1):   198 + 64 × 92 ms  =  6.086 ms   ← ölçülen 6.083 ✓
analytics, dub1 varsayımı: 198 + 64 ×  2 ms  =    326 ms
                                                ─────────
                                    beklenen kazanç ≈ 5,8 sn
```

⚠️ `RTT(dub1→eu-west-1) ≈ 2 ms` **ÖLÇÜLMEDİ** — dub1'de kod koşturamıyorum.
Aynı AWS bölgesi içi tipik değerdir; gerçek sayı ancak bölge değişince ölçülür.
Formülün girdilerinden **198 ms ve 92 ms ölçüldü**, yalnız 2 ms varsayım.

Bu, `docs/ANALIZ-YAVASLIK.md` § 4.1'de "ÖLÇÜLMEDİ" bıraktığım ~9 saniyelik
boşluğun büyük kısmını açıklıyor.

---

## 4 · RİSKLER

### 4.1 Plan hangi bölgelere izin veriyor — `ÖLÇÜLEMEDİ`

Vercel MCP bu projede **403 Forbidden** veriyor, CLI kurulu değil. Planın adını
ve bölge hakkını okuyamadım.

`[VARSAYIM]` genel kural: Hobby planında **tek** fonksiyon bölgesi seçilebilir
(varsayılan `iad1`, değiştirilebilir); Pro'da birden çok bölge mümkündür.
**Volkan bakacak:** Dashboard → Settings → Functions → *Function Region*
(seçilebilir bölgeler listesi orada görünür). `dub1` (Dublin) ve `fra1`
(Frankfurt) Vercel'in standart bölgeleridir.

### 4.2 Değişiklik anında ne olur

| | durum |
|---|---|
| Kesinti | **YOK** `[VARSAYIM]` — bölge değişikliği **bir sonraki deploy'da** etkinleşir; mevcut dağıtım çalışmaya devam eder |
| Cold start | **EVET** — yeni bölgede lambda'lar sıfırdan başlar, ilk isteklerde soğuk başlatma yaşanır |
| Geri dönüş | Ayarı `iad1`e geri al + yeniden deploy. `vercel.json` ile yapıldıysa dosyayı geri al. **Veri kaybı riski yok** — fonksiyon durumsuz |

### 4.3 Üç kiracı = üç ayrı Vercel projesi

**EVET, üçünü de ayrı ayrı değiştirmek gerekir** — ve **aynı bölgeye değil**:

| kiracı | Supabase | **doğru Vercel bölgesi** |
|---|---|---|
| HAK61 | eu-west-1 (İrlanda) | **`dub1`** |
| Sendigo | eu-central-1 (Frankfurt) | **`fra1`** |
| galzura-demo | `ÖLÇÜLEMEDİ` | Supabase bölgesi belirlenince eşleştirilecek |

⚠️ Hepsini `fra1` yapmak HAK61 için **yanlış** olurdu: Frankfurt→İrlanda
~20-25 ms, aynı-bölge ~2 ms. Kazancın onda dokuzu alınır ama tamamı değil.

### 4.4 Cron işleri — etkilenmez

Sekiz cron da **dış zamanlayıcıdan** (cron-job.org / GitHub Actions) HTTP ile
tetikleniyor (`docs/CRON-KAYITLARI.md`). Bölge, işin **nerede koştuğunu**
değiştirir, **tetiklenip tetiklenmediğini** değil. URL, sır, sıklık aynı kalır.

Yan etki: cron'lar da DB'ye yakınlaşır → flespi sync (günde 2.880 tur × ~17
sorgu) ve gece işleri hızlanır `[VARSAYIM]`.

### 4.5 Hetzner servisleri (Almanya) — mesafe DEĞİŞİR, İYİ YÖNDE

| servis | durum | bölge değişince |
|---|---|---|
| **Takograf** (`TAKOGRAF_URL`, `lib/takograf-servis.ts`) | kodda **CANLI** — `.ddd` dosyasının ham gövdesi Hetzner'e POST ediliyor (`body: ham`) | iad1→Almanya ~90 ms → fra1'den ~5 ms, dub1'den ~20 ms. **İYİLEŞİR** |
| **U-ETDS** | kodda **YOK** (yalnız `docs/UETDS-*.md`) | henüz etkisi yok |

Yani bölge değişikliği Hetzner'e olan mesafeyi **kısaltır**, uzatmaz.

---

## 5 · 🔴 VERİNİN FİİLEN NEREDEN GEÇTİĞİ

> Hukuki yorum yapmıyorum. Aşağısı **yalnız ölçülmüş veri yoludur.**

### 5.1 Bugünkü yol `[DOĞRULANDI]`

```
Tarayıcı/telefon (AT/TR)
   │
   ▼  HTTPS
Vercel edge · fra1 (Frankfurt, AB)        ← yalnız yönlendirme, TLS sonlandırma
   │
   ▼
🔴 Vercel Fonksiyonu · iad1 (Washington DC, ABD)   ← KOD BURADA KOŞUYOR
   │   · kişisel veri BELLEKTE işleniyor
   │   · console.log çıktıları buradan üretiliyor
   ├──────────────► Supabase · eu-west-1 (İrlanda, AB)     [HAK61 verisi]
   └──────────────► Hetzner · Almanya (AB)                 [.ddd takograf dosyası]
```

### 5.2 ABD'den geçen kişisel veri türleri `[DOĞRULANDI]` — kodda görüldü

| veri | nereden | kanıt |
|---|---|---|
| Şoför **adı-soyadı** | `workers` okuması her panel/mobil çağrısında | `listVehiclesAndWorkers`, `WORKER_PUBLIC_COLUMNS` |
| **Plaka** | her araç sorgusunda | `vehicles.plate` |
| **GPS koordinatı** (enlem/boylam) | `device_telemetry`, `listVehicleTrack` | araç detay, rota, bölge |
| **Vardiya saatleri** (çalışma süresi) | `time_entries` | AZG/analiz |
| **Takograf `.ddd` dosyası** | tarayıcıdan yüklenip Hetzner'e iletiliyor | `lib/takograf-servis.ts:27` `body: ham` — **iad1 üzerinden geçiyor** |
| **Plaka — Vercel LOGLARINDA** | hata yollarında | `app/api/flespi/sync/route.ts:193, 206, 244, 321, 363` → `[flespi/sync] ${v.plate}: …` |

### 5.3 Ne ÖLÇEMEDİM

- **Vercel log deposunun bölgesi** — plakaların düştüğü loglar nerede
  saklanıyor `ÖLÇÜLEMEDİ` (Dashboard erişimi yok)
- Supabase'in **at-rest** şifreleme/yedek bölgesi `ÖLÇÜLEMEDİ`
- Cloudflare'in `<ref>.supabase.co` önündeki yolu — hangi PoP'tan origin'e
  gittiği `ÖLÇÜLEMEDİ`
- Vercel ile imzalı DPA'nın içeriği ve alt-işleyen listesi — **belge okumadım**

### 5.4 Tek cümlelik olgu

**Veri AB'de duruyor (İrlanda/Frankfurt/Almanya), ama AB dışında (ABD,
Washington DC) işleniyor** — her istekte, bellekte, ve hata loglarında plaka
düzeyinde. Bunun sözleşmeye/DPA'ya uygun olup olmadığı benim ölçüm alanım
değil; **fiilî yol budur.**

---

## 6 · NASIL YAPILIR (adım adım — UYGULANMADI)

### Yol A — Vercel Dashboard (önerilen: en az dosya, anında geri alınır)

1. Vercel → **hak-transport-takip** projesi → Settings → **Functions**
2. **Function Region** → `iad1` yerine **`dub1` (Dublin)** seç
   *(HAK61'in Supabase'i eu-west-1 olduğu için — `fra1` DEĞİL)*
3. **Redeploy** (bölge yalnız yeni dağıtımda etkinleşir)
4. Doğrula: `curl -sI -H "Authorization: Bearer <token>" \
   https://hak-transport-takip.vercel.app/api/mobile/score-config | grep x-vercel-id`
   → ikinci bölüm **`dub1`** olmalı
5. Ölç: § 3.1'in aynısı (score-config 1 sorgu ↔ fleets 6 sorgu) →
   RTT **92 ms'den ~2-5 ms'ye** inmeli
6. Aynısını **Sendigo** projesinde **`fra1`** ile
7. galzura-demo: önce § 1.3 ile bölgesini belirle, sonra eşleştir

### Yol B — repoya `vercel.json`

```json
{ "regions": ["dub1"] }
```

⚠️ Bu dosya **her kiracıda farklı** olmalı (HAK61 `dub1`, Sendigo `fra1`) ama
depo **tek** — yani üç kiracı aynı `vercel.json`u paylaşır ve **biri yanlış
bölgeye düşer**. Bu depo için **Yol A daha doğru** (bölge proje ayarında,
kiracıya özel).

### Doğrulama ölçütü

| ölçüm | bugün | hedef |
|---|---:|---:|
| `x-vercel-id` 2. bölüm | `iad1` | `dub1` / `fra1` |
| RTT (score-config↔fleets eğimi) | 92 ms | **< 10 ms** |
| `/api/mobile/analytics?range=hafta` | 6,08 sn | **< 1,5 sn** `[VARSAYIM]` |
| flespi sync turu | — | ölçülmeli (§ 4.4) |

---

## 7 · ÖLÇÜM ÖZETİ

| ölçüldü | değer |
|---|---|
| Fonksiyon bölgesi | `iad1` — 25/25 istek |
| HAK61 Supabase | `eu-west-1` (İrlanda) — AWS CIDR |
| Sendigo Supabase | `eu-central-1` (Frankfurt) — AWS CIDR |
| iad1 → HAK61 Supabase RTT | **92 ms/sorgu** |
| benim makinem → HAK61 Supabase | 96 ms (min) |
| Sabit taban (benim→Vercel+fn) | 198 ms |
| analytics etkin sıralı derinlik | ~64 tur |
| analytics süresinin RTT payı | **~5,9 sn / 6,08 sn** |
| Repoda bölge ayarı | **yok** (3 mekanizmanın hiçbiri) |

| ölçülemedi |
|---|
| galzura-demo Supabase bölgesi |
| Vercel planının izin verdiği bölgeler |
| `dub1 → eu-west-1` gerçek RTT (bölge değişince ölçülür) |
| Vercel log deposunun bölgesi |
| Vercel DPA içeriği / alt-işleyen listesi |

---

## 8 · DEĞİŞİKLİK SONRASI ÖLÇÜM ✅ (28.08.2026 12:26–12:33 UTC)

> Volkan üç projede de Function Region'ı değiştirip redeploy etti.
> Aşağısı **aynı yöntemle** yapılan sonrası ölçümüdür — HAK61'de salt okuma,
> hiçbir yazma yok. Karşılaştırılabilirlik için örnek sayısı ve metrik
> (min / medyan, 5 örnek) § 3 ile birebir aynı tutuldu.

### 8.1 Bölge tuttu mu — EVET, üçü de `[DOĞRULANDI]`

| proje | `x-vercel-id` | hedef | sonuç |
|---|---|---|---|
| hak-transport-takip | `fra1::dub1` (6 uç × 5 örnek) | `dub1` | ✅ |
| sendigo-delta | `fra1::fra1` | `fra1` | ✅ |
| galzura-demo | `fra1::fra1` | `fra1` | ✅ |

Edge hâlâ `fra1` (istek Frankfurt'a düşüyor) — beklenen; değişen **ikinci
bölüm**, yani fonksiyonun koştuğu yer.

### 8.2 RTT: **91,8 → 24,6 ms/sorgu** (3,7×)

Aynı eğim yöntemi (score-config 1 sorgu ↔ fleets 6 sorgu, min süreler):

| | ÖNCE (iad1) | SONRA (dub1) |
|---|---:|---:|
| RTT / sorgu | **91,8 ms** | **24,6 ms** |
| sabit taban (benim→Vercel + fonksiyon) | 198 ms | **115 ms** |

Taban da düştü (198 → 115 ms): benim isteğim de artık Atlantik'i geçmiyor.

### 8.3 Uçlar — önce/sonra

| uç | sorgu | ÖNCE (min) | SONRA (min) | SONRA (med) | kazanç |
|---|---:|---:|---:|---:|---:|
| score-config | 1 | 0,290 sn | **0,140 sn** | 0,147 | **2,1×** |
| me | 2 | 0,408 sn | **0,171 sn** | 0,192 | **2,4×** |
| fleets | 6 | 0,749 sn | **0,263 sn** | 0,293 | **2,8×** |
| **analytics** | 187 | **6,083 sn** | **1,858 sn** | 2,035 | **3,3×** |
| dashboard | 188 | 2,314 sn | **0,865 sn** | 0,949 | **2,7×** |
| **analytics/co2** | 1116 | **31,300 sn** | **18,685 sn** | 18,688 | **1,7×** |

### 8.4 🔴 TAHMİN TUTMADI — model doğru, GİRDİ yanlıştı

| | tahmin | gerçek |
|---|---:|---:|
| RTT (sonra) | ~2 ms `[VARSAYIM]` | **24,6 ms** |
| analytics | ~0,33 sn | **1,86 sn** |
| kazanç | ~5,8 sn | **4,2 sn** |

**Model doğruydu, varsayım yanlıştı.** `t = taban + derinlik × RTT`
formülü ölçülen RTT ile beslendiğinde:

```
115 ms + 64 × 24,6 ms = 1.690 ms      ·      ölçülen 1.858 ms   → %10 içinde ✓
```

**Neden 2 ms değil 24,6 ms:** uygulama Supabase'e `<ref>.supabase.co`
üzerinden bağlanıyor ve o adres **Cloudflare arkasında** (§ 1.1'de ölçüldü:
104.18.38.10). Yani aynı AWS bölgesinde bile yol
`fonksiyon → Cloudflare edge → Supabase origin` ve üstüne PostgREST'in kendi
istek başına işleme süresi biniyor. "Aynı bölge ≈ 2 ms" varsayımı bu proxy
katmanını yok saydığı için fazla iyimserdi.

⚠️ Kalan 24,6 ms'in ne kadarı ağ, ne kadarı PostgREST işlemesi —
**ÖLÇÜLEMEDİ** (ayrıştırmak için Supabase tarafında zamanlama gerekir).

### 8.5 flespi akışı — kesintisiz `[DOĞRULANDI]`

Redeploy sonrası 6 örnek (12:28–12:33 UTC), hepsinde akıyor:

```
12:28:52 | son yazma 20 sn | son 5 dk 187 | giriş 200 | AKIYOR
12:29:53 |            21 sn |          249 |       200 | AKIYOR
12:30:54 |            22 sn |          261 |       200 | AKIYOR
12:31:55 |            23 sn |          303 |       200 | AKIYOR
12:32:57 |            24 sn |          295 |       200 | AKIYOR
```

29 cihazlı araç, `vin` NULL 0 — değişiklik öncesiyle aynı. Kesinti olmadı.

### 8.6 Takograf / Hetzner mesafesi — **ÖLÇÜLEMEDİ**

`TAKOGRAF_URL` benim `.env.local` dosyamda **yok** (0 eşleşme) ve
`servisSagligi()` yalnız bir server action'dan çağrılıyor
(`app/actions/takograf.ts:58`) — dışarıdan çağırabileceğim bir rota değil.
Dolayısıyla dub1 → Hetzner (Almanya) mesafesini ölçemedim.

`[VARSAYIM]` yön belli: iad1 → Almanya ~90 ms iken dub1 → Almanya ~20-25 ms
olmalı, yani **kısaldı**. Ölçmek isteyen: takograf ekranını açıp servis
sağlığı çağrısının süresine bakabilir.

### 8.7 Bundan sonra ne kaldı

Bölge değişikliği `docs/ANALIZ-YAVASLIK.md` § 4.1'deki açıklanamayan boşluğun
büyük kısmını kapattı. Kalan darboğazlar **sorgu sayısı ve sıralı derinlik**:

- `analytics` hâlâ 187 sorgu / ~64 sıralı tur → S5 (A/B/C bloklarını
  paralelleştir) ve S6 (araç başına span sorgularını tek RPC'ye indir)
- `analytics/co2` hâlâ **18,7 sn** — S2 (094, dalda bekliyor) ve S4 (aylık
  tablo) bunun içindir; bölge değişikliği tek başına yetmedi
