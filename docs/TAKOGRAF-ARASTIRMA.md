# Takograf desteği — FAZ 1 araştırma

**26.08.2026 · SALT ARAŞTIRMA, kod yazılmadı**

Kapsam: elle `.ddd` yükleme — sürücü kartı (28 gün) **ve** araç ünitesi (365 gün).

| İşaret | Anlamı |
|---|---|
| **[DOĞRULANDI]** | Resmî/birincil kaynaktan okundu, link verildi |
| **[KISMEN]** | Birincil kaynağa erişilemedi; ikincil kaynak, link verildi |
| **[VARSAYIM]** | Benim çıkarımım — ölçüm değil |
| **[BİLMİYORUM]** | Cevabı bulamadım; uydurmadım |

---

## 0 · 🔴 ÖNCE BUNU OKU — bu filoda takograf var mı?

Araştırmanın tamamından önce gelen soru bu, ve cevabı **bende yok**.

**Ölçtüm (HAK61 canlı, 26.08.2026):**

| Bulgu | Değer |
|---|---|
| Araç sayısı | 30 |
| Modeller | Fiat Ducato ×12 · Mercedes Sprinter ×10 · VW Crafter ×6 · Renault Trafic ×1 · test ×1 |
| `vehicles` tablosunda **ağırlık/tonaj kolonu** | 🔴 **YOK** |
| `tenant_mevzuat` | `AT_AZG` · `surus_tahmini = false` |

086'nın kendi migration yorumu şunu diyor:

> *"HAK61 için ÖLÇÜLDÜ (Volkan teyidi 22.07.2026): araçların hepsi 2,5 t ALTINDA
> ve sınır geçmiyor → 561/2006 UYGULANMAZ."*

⚠️ **Bu notla filo listesi çelişiyor olabilir.** Ducato / Sprinter / Crafter tipik
olarak **3,0–3,5 t** sınıfıdır, 2,5 t altı değil. [VARSAYIM — `vehicles` tablosunda
ağırlık kolonu olmadığı için koddan doğrulanamıyor.]

Ama belirleyici olan ağırlık değil, **sınır geçip geçmediği**: AB Komisyonu'na göre
2,5–3,5 t arası hafif ticari araçlar **yalnız uluslararası taşıma ve kabotajda**
01.07.2026'dan itibaren akıllı takograf zorunluluğuna girdi [DOĞRULANDI,
[AB Komisyonu Q&A](https://transport.ec.europa.eu/transport-modes/road/mobility-package-i/tachographs/questions-and-answers-tachograph-provisions-mobility-package-1_en)]:

> *"all light commercial vehicles whose maximum permissible mass is between 2.5 and
> 3.5 tonnes and which are engaged in international transport or cabotage activities
> will have to be equipped with this tachograph from 1 July 2026"*

**Yurt içi taşıma kapsam dışı.** HAK61 sınır geçmiyorsa **araçlarda takograf
CİHAZI YOKTUR** ve yüklenecek `.ddd` dosyası da yoktur.

> 🔴 **Bu özellik HAK61 için bir uyum ihtiyacı değil, YENİ PAZAR açma yatırımıdır.**
> Kime satılacağı netleşmeden ayrıştırıcı yazmak, kullanıcısı olmayan en pahalı
> modülü yazmak olur.

---

## 1 · Format gerçekliği

### 1.1 · `.ddd` nedir

İkili (binary) bir veri kabı. Metin düzenleyiciyle açılmaz; **dijital imzayla
korunur** ve okunması için imzanın açık anahtarını doğrulayan yazılım gerekir
[KISMEN, [TachoTools](https://tachotools.com/en/tachograph-files/tachograph-ddd-file.html)].

Dosya, **TREP** (Transfer Response Parameter) etiketli bloklardan oluşur. Nesil
farkı doğrudan bu etiketlerde görünür [KISMEN, aynı kaynak]:

| Blok | Nesil 1 | Nesil 2 |
|---|---|---|
| Overview | `0x01` | `0x21` |
| Activities (belirli takvim günü) | `0x02` | `0x22` |
| Events & faults | `0x03` | `0x23` |
| Detailed speed | `0x04` | `0x24` |
| Technical data | `0x05` | `0x25` |

### 1.2 · Üç nesil, üç ayrı ele alış

| Nesil | Cihaz | Kart |
|---|---|---|
| **Gen1** | DTCO 3.0 (dijital takograf) | Gen1 sürücü kartı |
| **Gen2 v1** | DTCO 4.0 (akıllı takograf 1) | Gen2V1 |
| **Gen2 v2** | **DTCO 4.1** (akıllı takograf 2) | **Gen2V2 — bugün Avrupa'da geçerli kart** |

[KISMEN, [TachoTools](https://tachotools.com/en/tachograph-files/)]

**Evet, Gen2 v2 ayrı bir ele alış gerektiriyor.** Yalnız yeni TREP değil, yeni veri
yapıları da var; aşağıda (§2.2) göreceğiniz gibi olgun sayılan ayrıştırıcı bile
Gen2 v2'yi **henüz bitirmemiş**.

### 1.3 · Geçiş takvimi — neden Gen2 v2 atlanamaz

[DOĞRULANDI, [AB Komisyonu Q&A](https://transport.ec.europa.eu/transport-modes/road/mobility-package-i/tachographs/questions-and-answers-tachograph-provisions-mobility-package-1_en)]

| Tarih | Ne oldu / olacak |
|---|---|
| **21.08.2023** | İlk tescil edilen tüm araçlarda akıllı takograf 2 zorunlu |
| **31.12.2024** | Analog / akıllı-olmayan dijital takograflı araçlar için son değişim tarihi |
| **18.08.2025** | Akıllı takograf **v1** taşıyan araçlar için son değişim tarihi |
| **01.07.2026** | 2,5–3,5 t hafif ticari araçlar (uluslararası taşıma / kabotaj) |
| **Ağustos 2028** | Tüm sürücülerde Gen2 v2 sürücü kartı |

> ⚠️ Bugün (2026) sahaya yeni giren her dosya **Gen2 v2**'dir. "Önce Gen1 yapalım,
> sonra bakarız" yolu, **bugünün dosyalarını okuyamayan** bir ürün demektir.
> Gen1 desteği ise arşiv için hâlâ gerekli (24 aylık saklama, §3.3).

### 1.4 · 🔴 İmza — ve imzasız dosyanın değeri

Dosya **imzalıdır**; imza verinin bütünlüğünü garanti eder ve kurcalamayı önler
[KISMEN, [TachoTools](https://tachotools.com/en/tachograph-files/tachograph-ddd-file.html)].
Teknik şartname **(EU) 2016/799 Ek 1C**'de; Gen2'de eliptik eğri kriptografisi (ECC)
kullanılıyor [KISMEN, [JRC örnek anahtar kılavuzu](https://dtc.jrc.ec.europa.eu/iot_doc/Sample%20Key%20Generation%20Tool%20User%20Manual%20v1.0.pdf)].

Doğrulama için **ERCA** (European Root Certificate Authority) kök ve üye devlet
açık anahtarları gerekir [DOĞRULANDI, [tachoparser README](https://github.com/traconiq/tachoparser)]:

> *"For proper data verification, the public keys (root ca and member states) are required."*

**"İmza doğrulanmadan yüklenen dosya denetimde ne kadar değerlidir?"**

Bunun kesin hukuki cevabını **[BİLMİYORUM]** — bir mahkeme kararı ya da otorite
görüşü bulamadım. Ama teknik olarak söylenebilecek şey şu ve zayıflatılmamalı:

> **İmza doğrulanmamış bir `.ddd`, içeriği elle değiştirilmiş olabilecek bir ikili
> dosyadır.** Ürün onu "takograf kaydı" diye gösterirse, aslında *"kullanıcının
> yüklediği bir dosyanın içeriği"* gösterilmiş olur. Denetimde asıl kanıt yine
> cihazın/kartın kendisidir.

> 🔑 **Ürün kararı [VARSAYIM]:** imza doğrulanamıyorsa dosya **reddedilmemeli** ama
> kaydın üzerinde **"imza doğrulanmadı"** damgası taşımalı ve o kayıttan üretilen
> hiçbir rapor "denetime hazır" diye sunulmamalı. Bu, 090'ın *"ölçülemedi ≠ 0"*
> kuralının aynısıdır: doğrulanmamış ≠ doğrulanmış.

---

## 2 · Ayrıştırma yolu

### 2.1 · Node/TypeScript ekosisteminde ne var

**Tek aday var ve ölü.**

| | `readesm-js` |
|---|---|
| npm son yayın | 🔴 **07.08.2020** |
| GitHub son push | 29.04.2023 |
| Sürüm sayısı | 9 |
| Lisans | npm: **ISC** · GitHub: **belirtilmemiş** ⚠️ (tutarsız) |
| Haftalık indirme | **267** |
| Temeli | C++ `readesm` (SourceForge) — **Gen1 dönemi aracı** |
| Gen2 / Gen2 v2 | **[BİLMİYORUM]** — açıklamada geçmiyor; temeli Gen1 olduğu için desteklemesi beklenmez [VARSAYIM] |
| İmza doğrulama | **[BİLMİYORUM]** — belgelenmemiş |

[DOĞRULANDI — npm kayıt API'si ve GitHub API'si, 26.08.2026'da sorgulandı:
[npm](https://www.npmjs.com/package/readesm-js) ·
[GitHub](https://github.com/densolo/readesm-js)]

> 🔴 **Sonuç: Node/TS tarafında bakımı süren bir kütüphane YOK.**

### 2.2 · Go tarafında iki canlı proje var

| | `traconiq/tachoparser` | `way-platform/tachograph-go` |
|---|---|---|
| Lisans | 🔴 **AGPL-3.0** | ✅ **MIT** |
| Oluşturuldu | 12.02.2024 | 18.09.2025 |
| Son push | **07.08.2026** (19 gün önce) | **03.08.2026** |
| Yıldız / fork | 58 / 29 | 15 / 12 |
| İmza doğrulama | var, ERCA anahtarları gerekli | var — `tachograph.Authenticate` |
| CLI | [BİLMİYORUM] | ✅ var |
| WASM | [BİLMİYORUM] | ✅ **[BİLMİYORUM]** — README'de geçmiyor |

[DOĞRULANDI — GitHub API, 26.08.2026]

#### 🔴 İki kritik bulgu

**1. `tachoparser`'ın açıklaması kendi TODO'suyla çelişiyor.**
Depo açıklaması *"Supports … 1st generation, 2nd generation and 2nd generation v2"*
diyor. Ama README'nin TODO bölümü şunları **bitmemiş** olarak listeliyor
[DOĞRULANDI, [README](https://github.com/traconiq/tachoparser)]:

> *"parse 2nd generation v2 driver card data"* · *"parse 2nd generation v2 vu data"*
> · Gen2 imza doğrulaması eksik · *"complete unit tests for all data types"*

**2. AGPL-3.0 bir SaaS için iş açısından kritiktir.**
AGPL §13 (ağ hükmü): yazılımı ağ üzerinden hizmet olarak sunuyorsanız,
kullanıcılara **karşılık gelen tüm kaynak kodu** sunmanız gerekir. Galzura kapalı
kaynak bir SaaS ise `tachoparser`'ı ürünün içinde çalıştırmak **tüm ürünün
kaynağını açmak** anlamına gelebilir. [VARSAYIM — hukuki görüş değil; avukata
sorulması gereken bir madde.]

`tachograph-go` **MIT** ve bu sorunu taşımıyor — ama genç (11 ay) ve 15 yıldız.

### 2.3 · Sıfırdan ayrıştırıcı yazmanın gerçek maliyeti

Zorunlu veri blokları (§1.1'deki TREP karşılıkları):

| Blok | Ne için gerekli | Bizim için |
|---|---|---|
| **Overview** | kart/araç kimliği, dönem | **zorunlu** — kaydı kime/hangi araca bağlayacağız |
| **Activities** | gün gün sürüş/iş/hazır/dinlenme | **zorunlu** — özelliğin tamamı bu |
| **Events & faults** | kart çıkarma, hız aşımı, güç kesintisi | **zorunlu** — denetimin baktığı yer |
| **Places** | ülke/bölge giriş-çıkış | uluslararası taşımada zorunlu |
| **Detailed speed** | saniyelik hız (son 24 sa) | **atlanabilir** [VARSAYIM] — kaza incelemesi dışında kullanılmıyor, en büyük blok |
| **Technical data** | kalibrasyon, sensör eşleşmesi | manipülasyon tespiti için değerli, ilk turda atlanabilir |

**Maliyet tahmini [VARSAYIM — ölçüm değil]:** Ek 1C veri sözlüğü yüzlerce ASN.1
benzeri yapı tanımlar; üç nesil × iki dosya türü (kart/VU) = altı ayrı şema
ailesi. İmza doğrulaması ayrıca ERCA sertifika zinciri, Gen1 için RSA, Gen2 için
ECC gerektirir. **Sıfırdan yazmak ay mertebesinde bir iştir ve tek kişilik bir
yan iş değildir.** Bu tahminin dayanağı: konuya 2,5 yıldır adanmış, 58 yıldızlı,
aktif bir Go projesi bile Gen2 v2'yi henüz bitirememiş (§2.2).

> **Öneri: sıfırdan yazma. Kesinlikle yazma.**

### 2.4 · 🔴 Rakipler ne yapıyor — ve bu en öğretici bulgu

| Firma | Ne yapıyor |
|---|---|
| **Samsara** | Cihazı uzaktan `.ddd` **indiriyor**, ama *"Samsara is not a standalone tool for tachograph analysis"* — dosyayı **API ile üçüncü taraf analiz araçlarına** veriyor [KISMEN, [Samsara KB](https://kb.samsara.com/hc/en-us/articles/5653950913421-Remote-Tachograph-Downloads)] |
| **Geotab** | Uzaktan indirme (DDD/TGD/V1B/C1B); analiz **Marketplace ortaklarında** (ör. GeoTach by Evestel) [KISMEN, [Geotab doc](https://support.geotab.com/ioxs/doc/tachograph-solution)] |
| **Webfleet** | "Tachograph Manager" — uzaktan ve elle indirme [KISMEN, [Webfleet portal](https://portals.webfleet.com/s/topic/0TO1O000003ci0wWAA/tachograph-remote-download?language=en_GB)] |
| **Descartes SmartCompliance** | Geotab/Samsara/OptiFleet için **indirme + analiz** hizmeti [KISMEN] |
| **VDO Fleet** (Continental) | Ayrıştırma/analiz/arşiv hizmetinin kendisi [KISMEN] |

> 🔑 **Telematik devleri bu işi kendileri AYRIŞTIRMIYOR.** Dosyayı taşıyorlar,
> yorumlamayı uzman servise bırakıyorlar. Bu tesadüf değil: takograf analizi ayrı
> bir uyum ürünü ve ayrı bir sorumluluk.

**Fiyat mertebeleri** (analiz servisleri, kıyas için):

| Servis | Fiyat |
|---|---|
| Tachomaster | **£1 / şoför / hafta** + **50p / araç / hafta** [KISMEN, [tachomaster.co.uk](https://www.tachomaster.co.uk/)] |
| TAGRA | **€19/yıl** (tek araç) → **€149/yıl** (sınırsız) [KISMEN, [tagra.app](https://tagra.app/fleet/)] |
| Genel bant | araç başına **£40–£80 / yıl** [KISMEN] |

Samsara/Geotab/Webfleet'in takograf modülü **ek ücreti [BİLMİYORUM]** — yayımlanmamış.

---

## 3 · Hukuki zorunluluk

### 3.1 · İndirme sıklığı — AB

| Kaynak | Sürücü kartı | Araç ünitesi |
|---|---|---|
| **AB (Komisyon Tüzüğü 581/2010)** | **28 gün** | **90 gün** | [KISMEN, [legislation.gov.uk](https://www.legislation.gov.uk/eur/2010/581)] |
| **Avusturya İş Müfettişliği** (Art. 33 VO 165/2014'e atıfla) | *"spätestens alle 28 Tage"* | *"spätestens drei Monate nach dem letzten Herunterladen"* | [DOĞRULANDI, [arbeitsinspektion.gv.at](https://www.arbeitsinspektion.gv.at/Personengruppen/lenkerinnen/Verwendung_des_Kontrollgeraetes.html)] |
| **Almanya (§ 2 Abs. 5 FPersV)** | **28 takvim günü** | **90 gün** | [KISMEN, [gesetze-im-internet.de](https://www.gesetze-im-internet.de/fpersv/__2.html)] |

⚠️ **581/2010'un AB'deki güncel yürürlük durumu [BİLMİYORUM].** Birleşik Krallık onu
**01.01.2024'te ilga etti** (Retained EU Law Act 2023) [DOĞRULANDI, legislation.gov.uk].
AB tarafında ilga/değişiklik bulamadım. **Ama 28/90 rakamları Avusturya İş
Müfettişliği tarafından bugün de yayımlanıyor** ve orası bizim için bağlayıcı
otoritedir — sayı bu yüzden güvenli.

Ayrıca ek indirme anları: araç trafikten çekilmeden önce, kiralama durumunda,
takograf değişiminden önce, kart arızasında [DOĞRULANDI, arbeitsinspektion.gv.at].

### 3.2 · Saklama süresi — AB tabanı

**Tüzük (EU) 165/2014 Md. 33(2)** [DOĞRULANDI,
[legislation.gov.uk/eur/2014/165/article/33](https://www.legislation.gov.uk/eur/2014/165/article/33)]:

> *"Transport undertakings shall keep record sheets and printouts … in chronological
> order and in a legible form, **for at least a year after their use**"*

### 3.3 · 🔴 Avusturya — AB tabanının İKİ KATI

**§ 17b AZG: 24 AY** [DOĞRULANDI,
[arbeitsinspektion.gv.at](https://www.arbeitsinspektion.gv.at/Personengruppen/lenkerinnen/Verwendung_des_Kontrollgeraetes.html)]:

> Süre *"mit dem Ende eines etwaigen Durchrechnungszeitraumes"* başlar — yani varsa
> **denkleştirme döneminin sonundan** itibaren 24 ay.

İş Müfettişliği bunun AB standardını **aşan ulusal bir kural** olduğunu açıkça
belirtiyor.

> 🔑 **HAK61 Avusturya'da. Bağlayıcı sayı 24 AY, 1 yıl değil.**
> Ve bu süre sabit bir tarihten değil, **denkleştirme döneminin sonundan** işliyor —
> yani ürün "yükleme tarihi + 24 ay" diye basit bir hesap yapamaz. [VARSAYIM]

### 3.4 · Almanya — 1 yıl + silme takvimi

- Saklama: **1 yıl** [KISMEN]
- Silme: saklama süresi biten takvim yılını izleyen yılın **31 Mart**'ına kadar
  imha [KISMEN, [FPersV § 2](https://www.gesetze-im-internet.de/fpersv/__2.html) ·
  [PTC](https://www.ptc-telematik.de/loeschfristen-beim-digitalen-tachographen/)]

⚠️ Almanya'da 31 Mart bir **silme ZORUNLULUĞUDUR**, saklama izni değil. Yani Alman
kiracıda ürün yalnız "sakla" değil **"zamanı gelince sil"** de demek zorunda.
[VARSAYIM — bu ürün gereksinimi çıkarımı bana ait.]

### 3.5 · Yol kenarı denetim penceresi ≠ saklama süresi

AB Komisyonu sayfası *"the current day and the last 56 days"* diyor
[DOĞRULANDI, Komisyon Q&A]. ⚠️ Bu **şoförün yanında taşıması gereken** dönemdir,
işletmenin arşiv süresi değil. İkisini karıştırmak "56 gün saklamak yeter" gibi
**yanlış** bir sonuca götürür.

---

## 4 · Veri kategorisi (090)

### Karar önerisi: **`yasal_zorunlu`** — ama model bunu tam ifade edemiyor

**Gerekçe:**

Takograf verisi **hem** kişisel veridir (şoförün nerede, ne zaman, ne kadar
çalıştığı — 090'daki *"o an araçta kim vardı"* ölçütünün ta kendisi) **hem de**
saklaması kanunla emredilmiştir (AT 24 ay, DE 1 yıl, AB tabanı 1 yıl).

090'ın üç kategorisinde `yasal_zorunlu` şu anlama geliyor: **silinemez, arayüz
silme seçeneğini bile göstermez.** Saklama süresi içinde doğru olan budur — bir
yöneticinin denetim kaydını silebilmesi, `shift_edit_log` ve `security_log` için
reddettiğimiz şeyin aynısıdır.

Aynı gerekçeyle `time_entries` zaten `yasal_zorunlu` kategorisinde (AZG çalışma
süresi kaydı). Takograf verisi **daha da güçlü** bir yasal kayıttır.

### 🔴 Ama burada 090'ın modelinde bir boşluk var

**Kategoriler zaman körü.** `yasal_zorunlu` = "hiç silinmez" demek. Takograf verisi
ise **"24 ay silinemez, sonra silinmelidir"**. Almanya'da üstelik silme bir
zorunluluk (31 Mart kuralı, §3.4).

Bugünkü modelde bunu ifade edecek yer yok. İki yol var [VARSAYIM]:

| Yol | Ne gerekir |
|---|---|
| **A — kategoriye zaman ekle** | `veri_kategorileri`ne `koruma_bitis_kurali` alanı; `yasal_zorunlu` süre dolunca `kisisel`e döner ve silme seçeneği belirir |
| **B — ayrı kalsın** | Takograf kendi ekranından yönetilir, 090 silme aracına hiç girmez |

**Önerim A** — çünkü B, "sil" düğmesi olmayan ama kanunen silinmesi gereken bir
veri yığını bırakır ve 31 Mart kuralı elle takip edilir.

⚠️ Bu, 090'ı değiştirir. **Volkan'ın kararı.**

---

## 5 · Mevcut şemayla kesişim

### 5.1 · `time_entries` ile çakışır mı — HAYIR, ama örtüşür

| | `time_entries` (bizim) | Takograf |
|---|---|---|
| Kaynak | şoför başlatır / depo tetikler (auto-shift) | cihaz, sürücü kartından |
| Ölçtüğü | **çalışma süresi** (AZG Arbeitszeit) | **sürüş / iş / hazır / dinlenme** (561/2006 kategorileri) |
| Kapsam | yükleme, bekleme, teslimat dâhil | direksiyon başındaki süre ayrı kategoride |
| Hukuki ağırlık | AZG kaydı | denetimin okuduğu birincil kayıt |

**Aynı olayı farklı anlatırlarsa hangisi doğru?**

Soru yanlış kurulu: **ikisi aynı büyüklüğü ölçmüyor.** 9 saatlik bir vardiyada 5
saat sürüş olabilir; ikisi de doğrudur.

Gerçekten çakışan tek şey **vardiya başı/sonu anı**. Orada:

> 🔑 **Takograf kazanır.** Cihaz kalibrasyonlu, imzalı ve müfettişin okuduğu kayıt;
> bizim `time_entries` operasyonel bir kayıt ve elle düzeltilebiliyor (087).
> **Ama üzerine YAZMAZ** — 087'nin dersi tam buydu: sessizce üzerine yazmak yasak.
> Fark **görünür kılınmalı**, biri diğerini ezmemeli. [VARSAYIM]

### 5.2 · 086 ceza önleme motoru — beslenir, çakışmaz

**Bugün ne var (ölçüldü):**

- `lib/mevzuat-db.ts` yalnız `time_entries` + `workers` okuyor
- HAK61 ayarı: `AT_AZG` · `surus_tahmini = false`
- `EU_561` seti **sürüş** eksenli ve temeli `surus_tahmini` — yani **tahmin**
- 086 migration'ının kendi yorumu: *"takograf olmadan üretilen sayı bir tahmindir"*

**Takograf gelince:**

`surus_tahmini` bayrağı **ölçüme dönüşür**. Bugün "tahmini" diye etiketlenen sürüş
süresi, takograf verisi varsa **gerçek ölçüm** olur. Bu, 086'nın en zayıf yerinin
kapanması demektir.

⚠️ **Ama HAK61 için bugün hiçbir şey değişmez:** kiracı `AT_AZG` kullanıyor ve o
setin temeli `calisma_suresi`, sürüş değil. Takograf verisi 086'yı ancak kiracı
`EU_561`e geçerse besler. [DOĞRULANDI — `lib/mevzuat.ts:205` `setinTemeli()`]

**Çakışma riski:** iki ayrı sürüş süresi kaynağı (tahmin + takograf) aynı ekranda
farklı sayı gösterirse güven gider. Kural: **takograf verisi olan gün için tahmin
HİÇ gösterilmez**, "ölçüldü" der. [VARSAYIM]

---

## 6 · Önerilen ayrıştırma yolu — TEK ÖNERİ

> ### `way-platform/tachograph-go`'yu ayrı bir servis olarak çalıştır, Next.js'ten HTTP ile çağır.

**Neden bu:**

1. **MIT lisanslı.** `tachoparser` AGPL-3.0 ve ağ hükmü kapalı kaynak SaaS için
   iş riski (§2.2).
2. **Aktif** — son push 03.08.2026.
3. **İmza doğrulaması var** (`tachograph.Authenticate`) — §1.4'teki damganın
   teknik karşılığı bu.
4. **CLI'ı var** — servisi sarmalamak, kütüphaneyi gömmekten kolay.
5. Node tarafında **alternatifi yok** (§2.1) ve sıfırdan yazmak ay mertebesinde
   (§2.3).

**Neden ayrı servis, Next.js'in içine değil:** Go kodu Next.js paketine giremez.
Vercel'de ayrı bir Go fonksiyonu ya da küçük bir konteyner gerekir. [VARSAYIM]

⚠️ **Riskler dürüstçe:** proje 11 aylık, 15 yıldız, tek ekip. Gen2 v2 desteğini
**doğrulamadım** [BİLMİYORUM]. Bağımlılık olarak alınmadan önce **gerçek bir Gen2
v2 dosyasıyla denenmelidir** — ve o dosya bizde yok.

**Yedek plan:** tachograph-go yetmezse, dosyayı ayrıştırmayı bırakıp **Descartes /
VDO gibi bir analiz servisine devretmek** — rakiplerin yaptığının aynısı (§2.4).

---

## 7 · Tahmini iş kalemleri

⚠️ Hepsi [VARSAYIM] — gün/saat tahmini vermiyorum, çünkü elimizde tek bir gerçek
`.ddd` dosyası bile yok ve ilk temas her şeyi değiştirebilir.

| # | İş | Not |
|---|---|---|
| 1 | **Örnek dosya edinme** | 🔴 **İLK İŞ.** Gen1 + Gen2 + Gen2 v2, kart + VU = 6 dosya. Bu olmadan hiçbir tahmin gerçek değil |
| 2 | Ayrıştırıcı servisi (tachograph-go sarmalayıcı) | ayrı dağıtım, sağlık ucu, sürüm sabitleme |
| 3 | ERCA anahtar yönetimi | kök + üye devlet sertifikaları, güncelleme yolu |
| 4 | Migration: `takograf_dosyalari` + `takograf_faaliyetleri` | dosya değişmez (ePOD deseni), faaliyet türetilmiş |
| 5 | Yükleme ekranı + Storage | dosya boyutu [BİLMİYORUM] — VU dosyaları büyük olabilir |
| 6 | Kart ↔ `workers` ve VU ↔ `vehicles` eşleştirme | kart numarası bugün şemada YOK |
| 7 | "İmza doğrulanmadı" damgası ve rapor kapısı | §1.4 |
| 8 | İndirme gecikmesi uyarısı (28/90 gün) | 084 kuralı olarak |
| 9 | 090 kategorisi + zaman boyutu | §4, model değişikliği |
| 10 | 086 besleme (yalnız EU_561 kiracıda) | §5.2 |
| 11 | Denetim/arşiv ihracı | AT 24 ay, DE 31 Mart silme |

---

## 8 · 🔴 Volkan'ın bunu yapmadan önce karar vermesi gerekenler

1. **HAK61 filosunda takograf cihazı VAR MI?**
   Sınır geçiliyor mu, araçların azami yüklü ağırlığı 3,5 t sınıfında mı?
   Cevap "hayır, yurt içi" ise **bu özelliğin HAK61'de kullanıcısı yok** ve
   yatırım yeni pazar içindir. (§0)

2. **Kim için yapıyoruz?** Mevcut kiracı mı, hedeflenen yeni müşteri mi?
   "Uluslararası taşıma yapan, >3,5 t filo" bugün müşterimiz değil.

3. **Sıfırdan yazmak masada mı?** Önerim hayır (§2.3). Onaylıyor musun?

4. **AGPL kabul edilebilir mi?** Değilse `tachoparser` elenir ve tek MIT seçenek
   genç bir proje olur. Avukata sorulacak madde. (§2.2)

5. **İmzasız dosya kabul edilsin mi?** Önerim: kabul et ama damgala ve
   "denetime hazır" deme (§1.4).

6. **090 kategorisi zaman boyutu kazansın mı?** (§4) — bu 090'ı değiştirir.

7. **`time_entries` ile fark çıkarsa ne olacak?** Önerim: takograf kazanır ama
   üzerine yazmaz, fark görünür olur (§5.1).

8. **Örnek `.ddd` dosyalarını kim verecek?** Bu olmadan Faz 2 planlanamaz.

9. **Analiz servisine devretmek masada mı?** Rakipler bunu yapıyor (§2.4);
   maliyeti araç başına £40–£80/yıl mertebesinde.

---

## 9 · Açık kalanlar (dürüst liste)

| Konu | Durum |
|---|---|
| 581/2010'un AB'deki güncel yürürlüğü | [BİLMİYORUM] — UK ilga etti, AB tarafı bulunamadı |
| İmzasız dosyanın mahkemedeki değeri | [BİLMİYORUM] — karar/otorite görüşü bulamadım |
| `readesm-js` Gen2 desteği | [BİLMİYORUM] — belgelenmemiş |
| `tachograph-go` Gen2 v2 desteği | [BİLMİYORUM] — README söylemiyor |
| `tachograph-go` WASM | [BİLMİYORUM] |
| Samsara/Geotab/Webfleet takograf ek ücreti | [BİLMİYORUM] — yayımlanmamış |
| `.ddd` dosya boyutları | [BİLMİYORUM] |
| HAK61 araçlarının azami yüklü ağırlığı | 🔴 şemada kolon yok — **Volkan'dan** |
| Avusturya "Durchrechnungszeitraum" hesabı | [VARSAYIM] — 24 ayın başlangıcı sabit değil |
