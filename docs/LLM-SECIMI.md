# Filo Copilot — LLM seçimi

**SALT ARAŞTIRMA · 26.08.2026 · kod yazılmadı, dal açılmadı**

Soru: yöneticinin doğal dille sorduğu filo sorularını, modelin **bizim uçlarımızı
araç olarak çağırarak** cevaplaması. Hangi model?

> **Baştan söylenecek sonuç:** bu işte model fiyatı belirleyici değil.
> Ölçtüm — 50 kiracıda aylık maliyet **30 dolardan az**. Yani "en ucuzu bul"
> sorusu yanlış soru; doğru soru **"araç çağırmayı hangisi düzgün yapıyor ve
> veriyi nereye gönderiyorum"**.

---

## 0 · Doğrulama işaretleri

| İşaret | Anlamı |
|---|---|
| **[DOĞRULANDI]** | Sağlayıcının kendi resmî sayfasından okundu, link verildi |
| **[KISMEN]** | Resmî sayfaya erişilemedi (JS ile yükleniyor / erişim reddi); ikincil kaynak, link verildi |
| **[AÇIK]** | Doğrulanamadı — bilerek boş bırakıldı, uydurulmadı |

Bu belgede **ölçüm** diyen her satır ya canlı HAK61 verisinde ya da resmî
dokümanda karşılığı olan bir sayıdır. Tahminler ayrıca "tahmin" diye yazılıdır.

---

## 1 · ÖNCE ÖLÇÜM — bir soru kaç token?

Fiyat karşılaştırması ancak gerçek yük bilinirse anlamlı. HAK61 canlı
verisinde uçların **gerçek yanıt boyutlarını** ölçtüm (25.08.2026, 30 günlük
pencere, 29 araç · 28 şoför):

| Uç | Ham yanıt | Copilot'a verilecek daraltılmış hâli |
|---|---|---|
| Performans (28 şoför) | 2.163 token | **560 token** |
| Yakıt (29 araç) | 3.520 token | **501 token** |
| CO₂ (29 araç) | 1.331 token | **521 token** |
| Maliyet (araç satırları) | 1.799 token | — |
| Tek araç sorusu (5 satır) | — | **97 token** |
| Filo özeti (oranlar + toplam) | — | **128 token** |

**Ders: ham yanıtı modele vermek 4-7 kat israf.** Copilot uçları kendi dar
alan kümesini döndürmeli — bu bir tasarım kararı, sonradan eklenecek bir
iyileştirme değil.

### Bir sorunun tam bütçesi

Araç çağırma **iki tur** demektir: model önce aracı çağırır, sonuç gelir,
sonra cevabı yazar. Yani girdi iki kez ödenir.

| Kalem | Token | Kaynak |
|---|---|---|
| Sistem istemi (TR/DE/EN kuralları + güvenilirlik sözleşmesi) | ~800 | tahmin |
| Araç tanımları (≈10 uç) | ~1.200 | tahmin |
| Anthropic araç-kullanım sistem eki (Haiku 4.5) | **496** | [DOĞRULANDI] |
| Kullanıcının sorusu | ~40 | tahmin |
| **1. tur girdi** | **≈2.550** | |
| 1. tur çıktı (araç çağrısı) | ~60 | tahmin |
| Araç sonucu (daraltılmış, ölçüldü) | ~550 | **ÖLÇÜLDÜ** |
| **2. tur girdi** (=1. tur + çağrı + sonuç) | **≈3.160** | |
| 2. tur çıktı (Türkçe cevap) | ~250 | tahmin |

**Soru başına: ≈5.700 girdi + ≈310 çıktı token.**

⚠️ **Önbellek belirleyici.** Sistem istemi + araç tanımları (~2.500 token) her
istekte **birebir aynı**. Prompt caching ile bu kısım 0,1× fiyata okunur.
Önbellekli gerçek yük: **~5.000 önbellekten + ~710 taze girdi + 310 çıktı.**

Aşağıdaki bütün maliyet hesapları bu ölçüme dayanıyor.

---

## 2 · BÜYÜK KARŞILAŞTIRMA TABLOSU

Kısaltmalar: **G** = 1M girdi token, **Ç** = 1M çıktı token, fiyatlar USD.

### 2.1 · Batı modelleri

| Model | G / Ç ($/1M) | Önbellek okuma | Ücretsiz katman | Araç çağırma | Türkçe | Almanca | Gecikme | AB'de işleme | Eğitimde kullanım |
|---|---|---|---|---|---|---|---|---|---|
| **Claude Haiku 4.5** | **1,00 / 5,00** [DOĞRULANDI] | **0,10** (batch 0,50/2,50) | yok | **çok iyi** — araç kullanımı ürünün merkezinde | iyi | çok iyi | orta | **var** — Bedrock Frankfurt / Vertex EU [DOĞRULANDI] | **sözleşmeyle YASAK** [DOĞRULANDI] |
| Claude Sonnet 5 | 2,00 / 10,00 [DOĞRULANDI] | 0,20 | yok | en iyi | çok iyi | çok iyi | orta | var | yasak |
| **GPT-5-mini** | **0,25 / 2,00** [DOĞRULANDI] | **0,025** | yok | çok iyi | iyi | çok iyi | hızlı | **var** — `eu.api.openai.com`, ayrı AB projesi şart [DOĞRULANDI] | iş verisi varsayılan olarak **kullanılmıyor** |
| GPT-5-nano | 0,05 / 0,40 [DOĞRULANDI] | 0,005 | yok | orta | orta | iyi | çok hızlı | var | kullanılmıyor |
| GPT-4.1-mini | 0,40 / 1,60 [DOĞRULANDI] | 0,10 | yok | iyi | iyi | çok iyi | hızlı | var | kullanılmıyor |
| **Gemini 2.5 Flash** | **0,30 / 2,50** [DOĞRULANDI] | var | **var — ⚠️ aşağıya bak** | çok iyi | iyi | çok iyi | hızlı | var (ücretli, DPA) | **ücretsizde EVET · ücretlide hayır** [DOĞRULANDI] |
| **Gemini 2.5 Flash-Lite** | **0,10 / 0,40** [DOĞRULANDI] | var | var — ⚠️ | iyi | orta-iyi | iyi | çok hızlı | var (ücretli) | ücretsizde evet |
| Mistral Large | 0,50 / 1,50 [DOĞRULANDI] | [AÇIK] | **$10/ay API kredisi** [DOĞRULANDI] | iyi | orta | çok iyi | orta | **AB şirketi, AB'de işleme** | [AÇIK] |
| Mistral Small / Ministral | [AÇIK] — fiyat sayfası ayrıntı vermiyor | [AÇIK] | aynı $10 | orta | zayıf-orta | iyi | hızlı | AB | [AÇIK] |
| Llama (barındırılan) | sağlayıcıya göre | — | Groq/Cloudflare üzerinden var | orta | zayıf-orta | orta | çok hızlı | sağlayıcıya bağlı | sağlayıcıya bağlı |

**Türkçe/Almanca notu:** yukarıdaki "iyi/orta" değerlendirmeleri **benim
yargım**, ölçüm değil. Türkçe için yayımlanmış güvenilir bir kıyaslama
bulamadım [AÇIK]. Gerçek karar bizim verimizle yapılacak 20 soruluk bir
körlemesine testle verilmeli — bu, uygulama kararı verilirse ilk iş olmalı.

### 2.2 · Çin modelleri

| Model | G / Ç ($/1M) | Ücretsiz | Araç çağırma | Ağırlıklar açık mı | AB'de işleme | Not |
|---|---|---|---|---|---|---|
| **DeepSeek v4-flash** | **0,44 / 1,32** tepe · **0,22 / 0,66** tepe-dışı [DOĞRULANDI] | yok | iyi | evet (MIT benzeri) | **hayır — Çin** | önbellek isabeti 0,014 / 0,007 (!) |
| DeepSeek v4-pro | 1,32 / 3,96 tepe [DOĞRULANDI] | yok | çok iyi | evet | hayır | |
| **GLM-4.5-Air** | **0,20 / 1,10** [DOĞRULANDI] | — | iyi | evet | hayır | küçük ve ucuz |
| GLM-4.5 / GLM-4.6 | 0,60 / 2,20 [DOĞRULANDI] | — | iyi | evet | hayır | |
| **GLM-4.7-Flash / 4.5-Flash** | **ÜCRETSİZ** [DOĞRULANDI] | evet | orta | evet | hayır | fiyat sayfasında "Free" |
| Qwen3.7 Flash | 0,03 / 0,13 (<32K) [KISMEN] | yeni hesaba 1M token/90 gün, **yalnız Singapur** [KISMEN] | iyi | evet (Apache 2.0) | Singapur/AB uçları var, ücretsiz kota yok | resmî fiyat sayfası okunamadı |
| Qwen-Plus | 0,40 / 1,20 [KISMEN] | — | iyi | evet | " | |
| Moonshot Kimi / MiniMax / Doubao / Ernie | [AÇIK] | [AÇIK] | — | Kimi+MiniMax açık · Doubao+Ernie kapalı | hayır | resmî fiyat sayfalarına erişilemedi |

🔴 **Çin modellerinde belirleyici olan fiyat değil, verinin nereye gittiği.**
Bizim verimiz şoför adı, konum, çalışma saati ve ihlal kaydı — yani
**çalışan izleme verisi**. AB'de bu en hassas kategorilerden biri.
Barındırılan Çin API'sine göndermek, aktarım dayanağı kurulmadan **yapılamaz**.

**Ama ağırlıkları açık olanlar (Qwen3, GLM, DeepSeek) Frankfurt'ta kendi
sunucumuzda çalıştırılabilir** — o zaman hukuki sorun kalkar. Maliyeti
§4'te.

### 2.3 · Ücretsiz katmanlar — TİCARİ KULLANIM (en kritik başlık)

| Sağlayıcı | Limit | Ticari kullanım | Veriyle eğitim | Karar |
|---|---|---|---|---|
| **Google AI Studio (ücretsiz)** | günlük istek kotası | Şartlar ticari kullanımı yasaklamıyor **ama**… | **EVET — eğitiyor.** Şartlar: *"Google uses the content you submit… to provide, improve, and develop Google products"*, *"human reviewers may read, annotate, and process your API input and output"* [DOĞRULANDI] | 🔴 **ELENDİ.** Aynı belge açıkça diyor: *"**Do not submit sensitive, confidential, or personal information to the Unpaid Services.**"* Bizim veri tam olarak bu. |
| **Google Gemini (ücretli)** | — | serbest | **hayır**, DPA geçerli [DOĞRULANDI] | ✅ kullanılabilir |
| **Groq (ücretsiz)** | kredi kartsız, hız sınırlı | ✅ **evet.** İnternette dolaşan *"personal, non-commercial"* maddesi **web sitesi Terms of Use**'a ait; GroqCloud'u **Services Agreement** yönetiyor [DOĞRULANDI] | *"By default, Groq does not retain customer data for inference requests"*; ZDR **tüm** müşterilere açık [DOĞRULANDI] | ⚠️ **veri ABD'de.** Tüm veri ABD'deki GCP kovalarında, **AB seçeneği yok** [DOĞRULANDI] → aktarım dayanağı gerekir |
| **OpenRouter `:free`** | **20 istek/dk**, **50 istek/gün** (<$10 kredi) · **1.000/gün** (≥$10) [DOĞRULANDI] | belirtilmiş bir yasak yok | **[AÇIK]** — eğitimden çıkma seçildiğinde `:free` sürümlerin erişilebilir kalıp kalmadığını doküman söylemiyor; doğrulayamadım | ⚠️ 50/gün zaten üretime yetmez |
| **Cloudflare Workers AI** | **10.000 Neuron/gün ücretsiz**, hem Free hem Paid planda [DOĞRULANDI]; sonrası $0,011/1.000 Neuron | dokümanda ticari kısıt **yazmıyor** [DOĞRULANDI] | [AÇIK] | ⚠️ katalog küçük modeller (llama-3.2-1b $0,027/$0,201 · qwen3-30b-a3b $0,051/$0,335) → araç çağırma zayıf |
| **Mistral (ücretsiz)** | **$10/ay API kredisi** [DOĞRULANDI] | serbest | [AÇIK] | ✅ AB şirketi — küçük ama temiz |
| **z.ai GLM-Flash** | tamamen ücretsiz [DOĞRULANDI] | — | — | 🔴 Çin'de işleniyor |
| Together / HuggingFace | [AÇIK] | [AÇIK] | [AÇIK] | resmî şart sayfaları doğrulanamadı |

> **Bu bölümün tek cümlelik özeti:** ücretsiz katmanların çoğu ticari kullanımı
> yasaklamıyor — **sorun ticari izin değil, VERİNİN NE OLDUĞU.** Google
> ücretsiz katmanı kendi şartlarında "kişisel veri göndermeyin" diyor. Bizim
> her sorumuz kişisel veri içeriyor. Ücretsiz katman bu üründe **yok hükmünde**.

---

## 3 · SOMUT MALİYET — 1 / 10 / 50 kiracı

Varsayım: **kiracı başına 2 yönetici × ayda 100 soru = 200 soru/ay.**
Soru başına §1'de ölçülen yük: 5.700 girdi + 310 çıktı token.

### Önbelleksiz

| Model | Soru başına | 1 kiracı (200) | 10 kiracı (2.000) | 50 kiracı (10.000) |
|---|---|---|---|---|
| Claude Haiku 4.5 | $0,0073 | **$1,46** | **$14,60** | **$73** |
| GPT-5-mini | $0,0020 | $0,41 | $4,09 | $20 |
| Gemini 2.5 Flash | $0,0025 | $0,49 | $4,90 | $25 |
| Gemini 2.5 Flash-Lite | $0,0007 | $0,14 | $1,38 | $7 |
| GLM-4.5-Air | $0,0015 | $0,30 | $2,96 | $15 |
| DeepSeek v4-flash (tepe dışı) | $0,0015 | $0,29 | $2,90 | $15 |

### Önbellekli (gerçekçi hâli — sistem istemi + araç tanımları sabit)

| Model | Soru başına | 1 kiracı | 10 kiracı | **50 kiracı** |
|---|---|---|---|---|
| **Claude Haiku 4.5** | **$0,0028** | **$0,56** | **$5,60** | **$28** |
| **GPT-5-mini** | **$0,0009** | **$0,18** | **$1,84** | **$9** |
| **Gemini 2.5 Flash-Lite** | ~$0,0004 | ~$0,08 | ~$0,80 | ~$4 |

🔴 **En pahalı seçenek bile 50 kiracıda ayda 28 dolar.** Bir kiracıdan alınan
aylık ücretin yanında yuvarlama hatası. **Fiyat bu kararın ekseni değil.**

Kıyas için: aynı 50 kiracıda **bir tek Vercel Pro aboneliği** bu maliyetin
kat kat üstünde.

---

## 4 · Kendi sunucumuzda çalıştırmak (self-host)

| Kalem | Değer |
|---|---|
| Hetzner **GEX44** — RTX 4000 SFF Ada, **20 GB VRAM**, 64 GB RAM, Falkenstein/Almanya | **€184/ay** + €79 kurulum [KISMEN — fiyat sayfası JS ile yükleniyor, ikincil kaynak] |
| Hetzner **GEX131** — RTX PRO 6000 Blackwell, **96 GB VRAM**, 256 GB RAM | **€889/ay** [KISMEN] |
| 20 GB VRAM'e sığan | Qwen3-8B · Ministral-8B · GLM-4.5-Air (nicemlenmiş) |
| 96 GB VRAM'e sığan | Qwen3-32B · GLM-4.5-Air tam · daha büyükleri hâlâ değil |

**Hesap:** 50 kiracının aylık 10.000 sorusu Haiku'da **$28**. Aynı yük için
en küçük AB GPU sunucusu **€184 ≈ $200** — yani **7 kat pahalı**, üstelik
kurulum, güncelleme, model yükseltme ve nöbet işi bize kalıyor.

**Başa baş noktası:** €184 ÷ $0,0028 ≈ **71.000 soru/ay** ≈ **355 kiracı.**

> **KARAR: self-host bugün gündemde değil.** Tek meşru gerekçesi hukuk olurdu
> (veri hiç AB dışına çıkmasın) — ama Bedrock Frankfurt ve `eu.api.openai.com`
> zaten bu ihtiyacı sözleşmeyle karşılıyor. ~350 kiracıda yeniden bakılır.

---

## 5 · Soru 4 — Halüsinasyon: araç çağırma mı, RAG mı?

### ARAÇ ÇAĞIRMA. RAG bu iş için yanlış alet.

| | RAG | Araç çağırma |
|---|---|---|
| Neyi getirir | metin parçası | **hesaplanmış sayı** |
| Verimiz | Postgres'te, saatlik değişiyor | aynı |
| Toplama (28 şoförün ortalaması) | gömme kaybeder | uç zaten hesaplıyor |
| Muhafızlar (test satırı, şoför kapsamı, epok, km kalitesi) | **atlanır** | **korunur** |

RAG'in **tek meşru yeri**: `docs/*.md` (30+ belge). "Güvenlik skoru nasıl
hesaplanıyor?" sorusu metin sorusudur ve cevabı statiktir. Sayı sorusu değil.

### 🔑 Elimizdeki en güçlü halüsinasyon savunması zaten yazılmış

Bu proje baştan beri **"ölçülemedi ≠ 0"** kuralıyla kuruldu ve uçlar
güvenilirlik meta verisi taşıyor:

```
/api/mobile/analytics → kmKapsama · skor.kalibre · skor.yetersizVeri
                        trendBloke · alarm.kapsamDisi · co2.kapsama
CO₂ panosu           → ölçülemeyen araçların PLAKA listesi
Kârlılık             → ucDisiOlcumsuz (ölçümü tam olmayan müşteri sayısı)
```

Bu, bir copilot için altın değerinde: **model, yanındaki meta veri
"ölçülemedi" diyen bir sayıyı rapor edemez.** Bu bir sözleşmedir ve
test edilebilir.

### Uygulanacak beş kural

1. **Model aritmetik YAPMAZ.** Cevaptaki her sayı bir araç sonucundan
   birebir gelir. "Ortalama şu" demesi gerekiyorsa ortalamayı uç döndürür.
2. **Kapsamı olmayan uç yoksa cevap "bunu ölçemiyorum"dur.** Tahmin yasak.
   084'ün ve CO₂'nin dilinin aynısı.
3. **Her cevap pencereyi ve kapsamayı yazar** — "son 30 gün · 29 araçtan 23'ü".
4. **Sayı-yankı muhafızı:** cevaptaki her sayının araç sonucu JSON'unda
   birebir geçtiğini doğrulayan ucuz bir düzenli ifade denetimi. Uydurmanın
   büyük kısmını yakalar ve modele bağlı değildir.
5. **Kaynak gösterme:** cevabın altında hangi ucun çağrıldığı yazar; yönetici
   ekranı açıp doğrulayabilsin.

⚠️ Kural 4 ölçülmeden "çalışıyor" denemez — uygulama kararı verilirse
tohumlanmış bir yalan senaryosuyla sınanmalı.

---

## 6 · Soru 5 — Kota altyapısı

### Bugünkü durum: `lib/rate-limit.ts` bu iş için YETERSİZ

Dosyanın **kendi başlığı** söylüyor: süreç-içi kayan pencere, soğuk
başlangıçta sıfırlanır, dağıtık yükü görmez. Bugün **tek bir yerde**
kullanılıyor: `app/api/takip/[token]/route.ts`.

Vercel'de N eşzamanlı örnek varsa gerçek tavan **N × tavan** olur. Takip
linki için kabul edilebilir; **token başına para ödenen bir özellik için
değil.** (`lib/package-limits.ts` ilgisiz — o paket adedi sınırı.)

### Gereken: veritabanı sayacı

```
copilot_kullanim
  gun date · worker_id uuid
  soru_sayisi int · girdi_token int · cikti_token int
  maliyet_usd numeric
  unique (gun, worker_id)
```

Atomik `upsert` ile artırılır — `login_unlock_log` deseninin aynısı.

**İki ayrı sınır, tek değil:**

| Sınır | Neyi korur |
|---|---|
| **Kullanıcı/gün soru adedi** | döngüye giren tek yöneticiyi |
| **Kiracı/ay token bütçesi** | faturayı |

Her ikisi de kullanıcıya **çarpmadan önce** görünür olmalı ("bu ay 63/200").
Sessizce kesmek, ürünün geri kalanının diline aykırı.

🔑 **Maliyet TAHMİN EDİLMEZ, API yanıtının `usage` bloğundan ÖLÇÜLÜR.**
Aksi hâlde bu projenin baştan beri kaçındığı hataya düşülür.

**Mimari notu:** her kiracı ayrı Supabase projesi (HAK61 · Sendigo ·
galzura-demo). Yani "kiracı başına sayaç" doğal olarak "veritabanı başına
sayaç" demek; çapraz-kiracı toplama diye bir iş yok.

---

## 7 · Soru 6 — Sektör ne yapıyor

| Ürün | Ne yapıyor | Katman | Ek ücret |
|---|---|---|---|
| **Samsara Assistant** | Doğal dille tedarik zinciri sorgusu; kodsuz ajan kurma; garanti/servis geçmişi sorgulama, randevu açma | platforma gömülü | **[AÇIK]** — ayrı fiyat yayımlanmamış |
| **Geotab Ace** | Yapay zekâ destekli analitik | platforma gömülü | [AÇIK] |
| **Motive AI** | Doğal dil desteği; özel rapor üretimi | platforma gömülü | [AÇIK] |
| **Fleetio** | Kendi AI'ından çok 12+ telematik entegrasyonu | — | — |

Platform fiyatları (AI ayrıştırılmamış): Motive $25-50/araç/ay ·
Geotab $20-40/araç/ay · Fleetio $4-10/araç/ay.

Kaynaklar: [Samsara — yeni AI ürünleri](https://www.samsara.com/blog/samsara-leads-the-way-new-products-bring-ai-to-operations) ·
[Samsara ajanik AI](https://www.samsara.com/blog/samsaras-new-innovations-digitally-transform-operations) ·
[Samsara Beyond 2026 özeti](https://www.rtinsights.com/everything-ai-samsara-announced-at-beyond-2026/) ·
[Geotab vs Motive kıyası](https://www.selecthub.com/fleet-management-software/geotab-vs-gomotive/) ·
[Fleetio fiyatlandırma](https://checkthat.ai/brands/fleetio/pricing)

### Stratejik okuma

**AI asistanı üst segmentte artık standart hâle geliyor — yani sahip olmak
FARK YARATMAZ, olmamak GERİ BIRAKIR.** Savunma hamlesi, atak hamlesi değil.

Bizim farkımız modelde değil, **cevabın dürüstlüğünde** olabilir: "ölçülemedi"
diyen, kapsama oranını yazan, plaka plaka eksiği sayan bir asistan.
Büyüklerde bu yok — onlarda sayı hep dolu görünüyor.

---

## 8 · Soru 7 — 084 kural motoruyla çakışma

### Çakışma yok — ayrım **itme / çekme** ekseninde

| | 084 Haftalık Aksiyon | Filo Copilot |
|---|---|---|
| Tetik | zamanlayıcı | kullanıcının sorusu |
| Yön | **itme** — sormadan söyler | **çekme** — sorulanı söyler |
| Mantık | 9 kural, sabit öncelik (800→200) | serbest |
| Belirlenim | tam belirlenimli | modele bağlı |
| LLM olmadan | **çalışır** | çalışmaz |

### 🔴 Tek gerçek risk: iki ağızdan iki farklı sayı

Copilot **084'ün yargısını yeniden türetmemeli.** "Hangi araçlara dikkat
etmeliyim?" sorusu 084 ucunu çağırıp **onun kalemlerini okumalı** — kendi
eşiğini uydurmamalı. Aksi hâlde pano "bakım gecikti" derken copilot
"sorun yok" der ve ürün güvenilirliğini kaybeder.

**084 asla LLM'e bağımlı hâle getirilmemeli.** Model erişilemez ya da bütçe
bitmişken haftalık pano çalışmaya devam eder.

### Copilot'un kendi katma değeri

084'ün öngöremeyeceği sorular:

- *"DO-623GL temmuzda haziranın kaç katı yaktı?"* — iki pencere kıyası
- *"Alpen Markt'ın son üç ayda km başına maliyeti nasıl gitti?"*
- *"Bu ay hangi şoförün skoru düştü ve neden?"* — kırılım açma
- *"Bakım maliyeti en yüksek beş araç hangileri?"*

Yani: **084 "ne yapmalısın"ı söyler, copilot "neden" sorusuna cevap verir.**

---

## 9 · İLK 3 ve NEDEN

### 🥇 1 — Claude Haiku 4.5

**Neden:** araç çağırma bu işin **tamamı**, ve bu ailede araç kullanımı
ürünün merkezinde duruyor — araç-kullanım sistem eki bile
belgelenmiş (496 token, `auto`/`none`). Almanca güçlü. Eğitim yasağı
**sözleşmede** ("Anthropic may not train models on Customer Content")
[DOĞRULANDI]. AB'de işleme Bedrock Frankfurt üzerinden mümkün.
**50 kiracıda $28/ay** — listenin en pahalısı ve yine de önemsiz.

**Zayıf yanı:** ham fiyat en yüksek; Türkçesi GPT-5-mini kadar iyi olmayabilir
(ölçülmedi).

### 🥈 2 — GPT-5-mini

**Neden:** $0,25/$2,00 ile Haiku'nun **dörtte biri**, önbellek okuma $0,025
ile çok agresif. Araç çağırma çok iyi. **AB veri ikametgâhı resmî bir ürün**:
`eu.api.openai.com`, ancak **yeni bir AB projesi açmak şart** — mevcut proje
çevrilemiyor [DOĞRULANDI]. İş verisi varsayılan olarak eğitimde kullanılmıyor.

**Zayıf yanı:** ZDR ve değiştirilmiş kötüye kullanım izlemesi **onay
gerektiriyor** — başvuru süreci var.

### 🥉 3 — Gemini 2.5 Flash (ÜCRETLİ katman)

**Neden:** en ucuz ciddi seçenek, büyük bağlam, hızlı.

🔴 **Ücretsiz katmanı ELENDİ ve bu tartışmaya kapalı:** Google'ın kendi
şartları *"Do not submit sensitive, confidential, or personal information to
the Unpaid Services"* diyor ve ücretsiz katmanda insan inceleyicilerin
girdiyi okuduğunu açıkça yazıyor [DOĞRULANDI]. Şoför adı + konum +
çalışma saati göndermek şartların doğrudan ihlali olurdu.

Ücretli katmanda eğitim yok ve DPA geçerli — o hâliyle kullanılabilir.

---

## 10 · NET ÖNERİ

> ### Claude Haiku 4.5 · aylık maliyet: 1 kiracıda **$0,56** · 10 kiracıda **$5,60** · 50 kiracıda **$28**
>
> (önbellekli, ölçülmüş yükle; ~200 soru/kiracı/ay)

**Gerekçe sırası — fiyat en sonda:**

1. **Araç çağırma güvenilirliği** — ürünün tamamı buna dayanıyor. Yanlış uç
   çağıran model, ucuz olsa ne olur.
2. **Sözleşmeli eğitim yasağı** — müşterinin filo verisi.
3. **Almanca** — DACH müşterisi, raporlar zaten Almanca.
4. **AB'de işleme yolu var** (Bedrock Frankfurt).
5. **Fiyat** — 50 kiracıda $28. Karar ekseni değil.

### ⚠️ Öneriye eşlik eden şartlar

- **Karar körlemesine testle mühürlensin.** Kendi verimizle 20 gerçek soru,
  Haiku · GPT-5-mini · Gemini Flash üçüne aynı anda sorulsun, cevaplar
  etiketsiz kıyaslansın. Türkçe kalitesi hakkında bugün elimde **ölçüm yok**,
  yalnız yargı var — ve bu proje yargıyla karar vermiyor.
- **Sağlayıcı bağımsız yazılsın.** Tek bir `konus()` adaptörü; model bir
  ayar. Araç katmanı bizim olduğu için model gerçekten değiştirilebilir.
- **Önbellek birinci günden açılsın.** Açmamak maliyeti 2,6 katına çıkarır.
- **Uçlar dar alan kümesi döndürsün.** Ham yanıt 4-7 kat israf (§1).

---

## 11 · YEDEK PLAN

| Sıra | Ne olursa | Ne yapılır |
|---|---|---|
| 1 | normal | **Haiku 4.5** |
| 2 | 5xx / zaman aşımı / hız sınırı | **GPT-5-mini**'ye düş (aynı araç tanımları, adaptör değişir) |
| 3 | ikisi de erişilemez | Copilot **"şu an cevaplayamıyorum"** der — sayı uydurmaz |
| 4 | kiracı bütçesi bitti | Copilot kapanır, **084 paneli ve tüm ekranlar etkilenmez** |
| 5 | fiyat 10 kat artarsa | Gemini 2.5 Flash-Lite (50 kiracıda ~$4/ay) |
| 6 | hukuk "AB dışına hiç çıkmasın" derse | Bedrock Frankfurt (aynı model) → o da olmazsa GEX131'de Qwen3-32B |
| 7 | ~350 kiracıyı geçersek | self-host başa baş noktası — yeniden hesaplanır |

**4. satır en önemlisi:** copilot **eklenti** olmalı, bel kemiği değil.
Kapandığında ürün çalışmaya devam eder.

---

## 12 · Açık kalanlar (dürüst liste)

| Konu | Durum |
|---|---|
| Türkçe kalite kıyası | **ölçüm yok** — körlemesine test şart |
| OpenRouter `:free` + eğitimden çıkma birlikte çalışıyor mu | doküman söylemiyor |
| Moonshot Kimi · MiniMax · Doubao · Ernie fiyatları | resmî sayfalara erişilemedi |
| Mistral Small/Ministral birim fiyatları | fiyat sayfası ayrıntı vermiyor |
| Together · HuggingFace ticari şartları | doğrulanamadı |
| Hetzner GEX44/GEX131 fiyatı | sayfa JS ile yüklüyor; ikincil kaynak |
| Samsara/Geotab/Motive AI katmanının ek ücreti | yayımlanmamış |
| Anthropic'in **doğrudan** API'sinde AB ikametgâhı | Bedrock/Vertex yolu doğrulandı, doğrudan API için doğrulanmadı |

---

## 13 · Kaynaklar

**Fiyat ve limitler**
[Anthropic fiyatlandırma](https://platform.claude.com/docs/en/about-claude/pricing) ·
[Anthropic ticari şartlar](https://www.anthropic.com/legal/commercial-terms) ·
[OpenAI fiyatlandırma](https://developers.openai.com/api/docs/pricing) ·
[OpenAI AB veri ikametgâhı](https://openai.com/index/introducing-data-residency-in-europe/) ·
[OpenAI API veri ikametgâhı yardım](https://help.openai.com/en/articles/10503543-data-residency-for-the-openai-api) ·
[Gemini API fiyatlandırma](https://ai.google.dev/gemini-api/docs/pricing) ·
[Gemini API şartları](https://ai.google.dev/gemini-api/terms) ·
[DeepSeek fiyatlandırma](https://api-docs.deepseek.com/quick_start/pricing) ·
[z.ai / GLM fiyatlandırma](https://docs.z.ai/guides/overview/pricing) ·
[Mistral fiyatlandırma](https://mistral.ai/pricing) ·
[Groq veri politikası](https://console.groq.com/docs/your-data) ·
[OpenRouter limitler](https://openrouter.ai/docs/api-reference/limits) ·
[Cloudflare Workers AI fiyatlandırma](https://developers.cloudflare.com/workers-ai/platform/pricing/) ·
[Alibaba Model Studio modeller](https://www.alibabacloud.com/help/en/model-studio/models) ·
[Qwen fiyat özeti (ikincil)](https://www.eesel.ai/blog/qwen-pricing)

**Donanım**
[Hetzner GPU sunucu matrisi](https://www.hetzner.com/dedicated-rootserver/matrix-gpu/) ·
[Hetzner GEX44](https://www.hetzner.com/dedicated-rootserver/gex44/) ·
[GEX44 fiyat (ikincil)](https://www.whtop.com/plans/hetzner.com/128304)

**AB ikametgâhı**
[Bedrock eu-central-1 model listesi](https://modelavailability.com/platforms/aws/regions/eu-central-1)

**Sektör** — §7'de.

---

## 14 · Sonraki adım

**Kod yazılmadı. Onay bekliyor.**

Onay verilirse ilk iş **model seçimi değil**, körlemesine test: bizim
verimizle 20 gerçek soru, üç aday, etiketsiz kıyas. Ondan sonra araç
katmanı.
