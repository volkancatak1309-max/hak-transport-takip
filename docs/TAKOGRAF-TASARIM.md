# Takograf — FAZ 2 tasarım

**26.08.2026 · TASARIM, kod yazılmadı**

Hedef: **ağır nakliye / TIR müşterisi** — dünya pazarına açılan ürün. Mevcut
kiracının filosu bu tasarımın ölçütü değildir.

| İşaret | Anlamı |
|---|---|
| **[DOĞRULANDI]** | Kendi ölçtüğüm / birincil kaynaktan okuduğum |
| **[VARSAYIM]** | Tasarım kararı ya da çıkarım — ölçüm değil |
| **[BİLMİYORUM]** | Cevabı yok; uydurulmadı |

Volkan'ın verdiği dört karar (kapsam, imzasız kabul+damga, ihlal motoru YOK,
tachograph-go) bu belgenin girdisidir; yeniden tartışılmıyor.

---

## 0 · Test verisi — kendim indirdim ve doğruladım

`git clone --depth 1 https://github.com/way-platform/tachograph-go` ·
son commit **95ca680 · 2026-08-03** · **MIT** · 30 MB [DOĞRULANDI]

### Nesil dağılımı — Volkan'ın verdiği tablo DOĞRU

| Kayıt | Nesil | hexdump toplamı |
|---|---|---|
| VU `000/001/002-anonymized` | **GEN1** | 503–524 KB |
| VU `003/004-anonymized` | **GEN2 + GEN2_V2** | 493–778 KB |
| Kart `000/001/002` | GEN1 (15 blok) | 53 KB |
| Kart `003`–`009` | **GEN1 (17) + GEN2 (16)** — çift nesilli kart | 179 KB |

**Gen2 v2 blokları gerçekten var** [DOĞRULANDI — `internal/vu/testdata/records/004-anonymized/`]:
`OVERVIEW_GEN2_V2` · `ACTIVITIES_GEN2_V2` (×3) · `EVENTS_AND_FAULTS_GEN2_V2` ·
`TECHNICAL_DATA_GEN2_V2` · `DETAILED_SPEED_GEN2`

### 🔑 GERÇEK `.ddd` BOYUTLARI — ölçüldü

`hexdump` bir **metin** temsili; gerçek ikili boyutu satırlardaki hex çiftlerini
sayarak çıkardım [DOĞRULANDI]:

| Dosya türü | Gerçek ikili boyut |
|---|---|
| **Sürücü kartı — yalnız Gen1** | **≈ 10,4 KB** |
| **Sürücü kartı — Gen1+Gen2 (çift nesil)** | **≈ 34,9 KB** |
| **Araç ünitesi — Gen1** | **≈ 98–102 KB** |
| **Araç ünitesi — Gen2/Gen2v2** | **≈ 96–151 KB** |

### 🔴 En önemli tek ölçüm: `DETAILED_SPEED` dosyanın %93,5'i

VU `004-anonymized` blok kırılımı [DOĞRULANDI]:

| Blok | Bayt | Pay |
|---|---|---|
| OVERVIEW | 159 | 0,2 % |
| ACTIVITIES ×3 | 2.607 | 2,6 % |
| EVENTS_AND_FAULTS | 2.496 | 2,5 % |
| **DETAILED_SPEED** | **92.170** | **93,5 %** |
| TECHNICAL_DATA | 1.144 | 1,2 % |
| **toplam** | **98.576** | |

> **Detaylı hızı ayrıştırmazsak bir VU dosyası ~96 KB'tan ~6,4 KB'a düşer — 15 kat.**
> Faz 1'de "atlanabilir" diye [VARSAYIM] işaretlediğim şey artık ölçüm.
> ⚠️ Dosyayı yine de **tam olarak saklıyoruz** (§1.1); atlanan yalnız
> *ayrıştırma*, saklama değil.

### İmza durumu — düzeltme

Faz 1'de "sertifikalar sıyrılmış olabilir" diye okudum, **yanlıştı.** Sayım
[DOĞRULANDI]:

| Alan | DOLU | BOŞ |
|---|---|---|
| `signature` | **137** | 0 |
| `memberStateCertificate` | 3 | 2 |
| `vuCertificate` | 3 | 2 |

Ayrıca `internal/security/testdata/certs/` altında **4 gerçek sertifika** var
(Finlandiya G1 TCC ×2, G2 MSCA kart ×2) [DOĞRULANDI].

⚠️ **Ama imza doğrulaması bu veriyle muhtemelen BAŞARISIZ olacak** [VARSAYIM]:
anonimleştirme VIN'i `*****************`, plakayı `*************` yapmış
(hexdump'ta `2a` baytları olarak görünüyor). İmza **değiştirilmiş veri**
üzerinde artık tutmaz. Yani test verisi **ayrıştırmayı** kanıtlar,
**mühür doğrulamasını kanıtlamaz.**

**Bunu ölçemedim: Go kurulu değil** (`go: command not found`) [DOĞRULANDI].
Faz 3'ün ilk işi bu (§7).

### Yeniden `.ddd` üretimi

Üst düzey API'de `Unparse(file) → RawFile` var ve `internal/{card,vu}/cmd/extract-testdata-records`
araçları mevcut [DOĞRULANDI]. Parçalardan tam dosya üretilebilir **görünüyor**
ama **denenmedi** [BİLMİYORUM].

### Anonimleştirme

`vehicleRegistrationIdentification.nation = "PORTUGAL"`, plaka ve VIN yıldızlı,
`downloadablePeriod` **2025-11-28 → 2026-03-11** [DOĞRULANDI]. Volkan'ın
tarifiyle uyuşuyor.

⚠️ Kart kayıtlarının 7'si **birebir aynı** hexdump toplamına sahip (179.218 B) —
aynı kartın farklı anonimleştirmesi olabilir [BİLMİYORUM]. Yani "10 farklı
şoför" değil, **10 kayıt** demek daha doğru.

---

## 1 · Veritabanı şeması

### 1.1 · Dosyanın kendisi — Storage, tablo değil

**Özel Supabase kovası `takograf`** — 080'deki `teslimat-kaniti` deseninin
aynısı [DOĞRULANDI, `db/migrations/080:235`]:

```
id: 'takograf' · public: false · file_size_limit: 5242880 (5 MB)
allowed_mime_types: ['application/octet-stream']
```

**Neden 5 MB:** ölçülen en büyük dosya 151 KB (§0). 5 MB, diğer dört kovayla
aynı sayı ve 33 kat pay bırakıyor. `.ddd`'nin tescilli bir MIME türü yok, o
yüzden `application/octet-stream` [VARSAYIM].

**Neden tabloya değil Storage'a:** ikili veri Postgres satırında taşınırsa her
yedek ve her `select *` onu sürükler. ePOD fotoğrafında verilen kararın aynısı.

### 1.2 · Üç tablo

#### `takograf_dosyalari` — yüklenen dosyanın künyesi · **DEĞİŞMEZ**

| Kolon | Tür | Not |
|---|---|---|
| `id` | uuid pk | |
| `tur` | text | `surucu_karti` \| `arac_unitesi` |
| `depo_yolu` | text | kovadaki yol |
| `dosya_adi` | text | kullanıcının yüklediği ad |
| `bayt` | integer | |
| `sha256` | text **unique** | 🔑 aynı dosya iki kez yüklenemez |
| `nesil` | text | `GEN1` \| `GEN2` \| `GEN2_V2` \| `KARMA` |
| **`muhur_durumu`** | text | `dogrulandi` \| `dogrulanamadi` \| `denenmedi` |
| `muhur_sebep` | text | neden doğrulanamadı (sertifika yok, imza tutmadı…) |
| `muhur_at` | timestamptz | |
| `ayristirma_durumu` | text | `bekliyor` \| `isleniyor` \| `tamam` \| `hata` |
| `ayristirma_hata` | text | |
| `ayristirici_surum` | text | tachograph-go commit'i — 🔑 yeniden ayrıştırma için |
| `kart_no` | text | kart dosyasında |
| `arac_vin` / `arac_plaka` | text | VU dosyasında |
| `worker_id` / `vehicle_id` | uuid null | **çözülebilirse** bağlanır |
| `donem_bas` / `donem_bit` | timestamptz | `downloadablePeriod` |
| `yukleyen_worker_id` | uuid | |
| `yuklendi_at` | timestamptz | |

⚠️ **Değişmezlik tetikleyicisi (HK080 deseni)**: yalnız `ayristirma_*`,
`muhur_*`, `worker_id`, `vehicle_id` güncellenebilir. `sha256`, `depo_yolu`,
`donem_*`, `yuklendi_at` **UPDATE ile değiştirilemez**. Gerekçe 080'deki ile
aynı: *sonradan düzenlenebilen bir kayıt delil değildir*.

#### `takograf_faaliyetleri` — ayrıştırılmış ham satırlar

| Kolon | Tür | Not |
|---|---|---|
| `id` | uuid pk | |
| `dosya_id` | uuid fk **cascade** | 🔑 hangi dosyadan geldiği |
| `kart_no` | text | |
| `worker_id` / `vehicle_id` | uuid null | türetilmiş bağ |
| `gun` | date | |
| `baslangic` / `bitis` | timestamptz | |
| `sure_dk` | integer | ayrıştırıcıdan, **hesaplanmaz** |
| `faaliyet` | text | `surus` \| `is` \| `hazir` \| `mola` |
| `slot` | text | `surucu` \| `yardimci` |
| `kaynak_nesil` | text | |

**unique** `(dosya_id, kart_no, baslangic, slot)`

#### `takograf_olaylari` — events & faults

`dosya_id` · `tur` (kart çıkarma, güç kesintisi, hız aşımı…) · `bas`/`bit` ·
`ciddiyet` · `ham_kod` · `arac_plaka`

**Neden ayrı tablo:** olayın süresi ve öznesi faaliyetten farklı; tek tabloya
sıkıştırmak 085'te müşteriyi araç/şoför eksenine sıkıştırma hatasının aynısı
olurdu.

### 1.3 · Sürücü kartı ve araç ünitesi — AYNI tablolar, `tur` kolonu ile

**Neden ayrı tablo değil:** ikisi de aynı soruyu cevaplıyor — *"kim, ne zaman,
ne yaptı"*. Ayrı tablo, her ekranı ve her sorguyu ikiye katlar. Fark
`takograf_dosyalari.tur` kolonunda ve VU'da `arac_*`, kartta `kart_no`
alanlarının dolu olmasında görünür. [VARSAYIM]

### 1.4 · Aynı dosya iki kez yüklenirse

**`sha256` UNIQUE** → ikinci yükleme **reddedilir** ve ekran *"Bu dosya
{tarih}'te {kişi} tarafından zaten yüklendi"* der, mevcut kayda bağlantı verir.

⚠️ Sessizce kabul edip ikinci kopyayı yazmak, faaliyet satırlarını ikiye
katlar ve her raporu bozar.

### 1.5 · 🔴 Çakışan dönemler — BİRLEŞTİRME YOK

İki farklı dosya aynı günleri kapsayabilir ve bu **normaldir**:

- aynı kart 28 gün içinde iki kez indirilirse **örtüşür**
- **sürücü kartı ile araç ünitesi aynı olayı iki yandan anlatır** — biri
  şoförün, diğeri aracın gözünden

**Karar: satırlar birleştirilmez, tekilleştirilmez.** Her faaliyet satırı
`dosya_id` taşır; ekran varsayılan olarak **kaynak seçtirir** ve üstte
*"bu dönem {n} dosyadan geliyor"* der.

**Gerekçe:** iki kaynağın çakışması bir **çapraz doğrulama fırsatıdır**;
birini eleyen bir kod, hangisini eleyeceğine karar vermek zorunda kalır ve o
karar sessiz bir veri kaybıdır. 090'daki *"ölçülemedi ≠ 0"* ile aynı aile.
[VARSAYIM]

### 1.6 · 090 `veri_kategorileri`ne eklenecek satırlar

| Tablo | Kategori | Gerekçe (tabloya yazılacak metin) |
|---|---|---|
| `takograf_dosyalari` | **`yasal_zorunlu`** | Takograf indirmesi kanunla emredilen kayıttır (AT § 17b AZG 24 ay, DE 1 yıl, AB tabanı 165/2014 Md. 33(2)). Müfettişin okuduğu birincil belge. |
| `takograf_faaliyetleri` | **`yasal_zorunlu`** | Dosyadan türetilmiş ama aynı hukuki kaydın içeriği. |
| `takograf_olaylari` | **`yasal_zorunlu`** | Kart çıkarma / güç kesintisi kayıtları manipülasyon denetiminin konusu. |

### ⚠️ Zaman körlüğü — bu fazda ÇÖZÜLMÜYOR, notu düşülüyor

090'ın `yasal_zorunlu` kategorisi **"hiç silinmez"** demek. Takograf ise
**"AT'de 24 ay, DE'de 1 yıl silinemez — sonra silinmelidir"**, üstelik
Almanya'da silme bir **zorunluluktur** (izleyen yılın 31 Mart'ı).

Bugünkü model bunu ifade edemiyor. Faz 2 kapsamı dışında; Faz 3+ kararı.
Not `docs/SAKLAMA-POLITIKASI.md`'ye de düşülmeli.

---

## 2 · Yükleme akışı

### 2.1 · Kim yükler

**`requireAdmin`** — filo şefine kapalı. [VARSAYIM]

Gerekçe: indirme yükümlülüğü **şirket kartı sahibinindir** (Faz 1 §3.1); bu bir
şirket uyum işi, filo operasyonu değil. Şoförün kendi kartını yüklemesi ayrı bir
akış ve bu fazın dışında.

### 2.2 · Dosya boyutu sınırı

**Kova sınırı 5 MB.** Ölçülen en büyük gerçek dosya **151 KB** (§0). Sınır
cömert ve diğer dört kovayla aynı.

⚠️ Uygulama katmanı **ayrıca** kontrol eder: 5 MB'ı aşan bir `.ddd` gerçek
değildir; yanlış dosya seçilmiştir ve kullanıcıya öyle denir.

### 2.3 · Ayrıştırma ASENKRON

Yükleme ile ayrıştırma **ayrılır**:

```
1. Dosya Storage'a yazılır          → satır: ayristirma_durumu='bekliyor'
2. Kullanıcıya HEMEN dönülür        → liste satırı görünür
3. Ayrıştırma işi Go servisini çağırır → 'isleniyor'
4. Sonuç yazılır                    → 'tamam' | 'hata'
```

**Neden asenkron:** ayrıştırma süresini **[BİLMİYORUM]** — Go kurulu olmadığı
için ölçemedim. Bilmediğim bir süreyi senkron bir isteğe koymak, kullanıcıyı
belirsiz bir bekleyişe mahkûm eder. Detaylı hız bloğu 92 KB (§0) ve ayrıştırma
maliyeti oradan gelir; atlanırsa hızlı olması beklenir [VARSAYIM] ama **ölçüm
Faz 3'ün ilk işi**.

**Kullanıcı ne görür:** sağ alt köşede **kalıcı olmayan bir işlem tepsisi**
(Chatbase deseni, §4.2) — sayfa engellenmez, kullanıcı başka işe geçebilir.

### 2.4 · 🔴 Ayrıştırma başarısız olursa dosya SAKLANIR

**Silinmez. Asla.**

Gerekçe: dosya **kanunen saklanması gereken belgenin kendisidir**. Bizim
ayrıştırıcımızın onu okuyamaması, müşterinin yasal kaydını yok etmek için
sebep değildir. Ayrıca:

- `ayristirici_surum` saklandığı için **ayrıştırıcı güncellenince yeniden
  denenebilir**
- Ekran *"ayrıştırılamadı — dosya duruyor, indirebilirsiniz"* der
- Dosya indirilebilir kalır; müşteri onu başka bir araca verebilir

> Bu, ürünün en önemli sözü: **yüklediğin dosya, biz okuyamasak da senindir ve
> durur.**

---

## 3 · Ekran

### 3.1 · İki sayfa

| Yol | İçerik |
|---|---|
| `/admin/takograf` | Yükleme + **dosya listesi** |
| `/admin/takograf/[id]` | Tek dosyanın **ham faaliyet tablosu** + olaylar |

Menüde `Veri saklama`nın (090) hemen üstünde — ikisi de uyum ailesinden.
[VARSAYIM]

### 3.2 · Dosya listesi — kolonlar

| Kolon | Hizalama | Not |
|---|---|---|
| Dosya | sol | iki satır: **ad** + altında `tür · nesil` |
| Şoför / Araç | sol | çözülemezse `kart no` / `VIN` monospace, kısaltılmış |
| Dönem | sol | `28.11.2025 → 11.03.2026` |
| Satır | **sağ** | `tabular-nums` |
| Boyut | **sağ** | `tabular-nums`, KB |
| Mühür | sol | §3.4 |
| Durum | sol | sessiz nokta+etiket |
| Yükleyen | sol | ad + `tarih` ikinci satırda |

Üstte **hızlı süzgeç şeridi sayaçlarla** (Vapi deseni): `Tümü 34 · Mühürlü 21 ·
Doğrulanamadı 11 · Hata 2`.

### 3.3 · Ham faaliyet tablosu — kolonlar

Volkan'ın istediği kolonlar + iki ek:

| Kolon | Hizalama |
|---|---|
| **Şoför** | sol — çözülemezse kart no (monospace) |
| **Tarih** | sol |
| **Faaliyet** | sol — nokta + etiket (Sürüş / İş / Hazır / Mola) |
| **Başlangıç** | **sağ** `tabular-nums` |
| **Bitiş** | **sağ** `tabular-nums` |
| **Süre** | **sağ** `tabular-nums`, `4:32` biçimi |
| **Araç** | sol — plaka, monospace |
| *Kaynak* | sol — hangi dosya (§1.5 çakışma için) |
| *Slot* | sol — sürücü / yardımcı, yalnız yardımcı doluysa görünür |

Sol kenarda **satır numarası oluğu** (Fibery deseni) — 1.000+ satırlık bir
tabloda "kaçıncı satırdayım" sorusunun cevabı.

Altta **özet satırı** (Twenty deseni): `Toplam süre 41:18 · Sürüş 22:04 ·
Mola 9:12` — ihlal yorumu YOK, yalnız toplam.

### 3.4 · 🔴 Mühür damgası — göze batar, çığlık atmaz

Üç durum, **tek accent renk** + tipografi ile ayrılır:

| Durum | Görünüm |
|---|---|
| `dogrulandi` | küçük kalkan glifi + **"Mühür doğrulandı"**, nötr ton, **dolgu yok** |
| `dogrulanamadi` | satırın **sol kenarında 2px amber çizgi** + etiket **"Mühür doğrulanamadı"** |
| `denenmedi` | gri, **"Mühür denetlenmedi"** |

**Ve kaldırılamaz olan şu:** görünen kümede doğrulanamamış en az bir dosya
varsa, tablonun **üstünde kalıcı bir şerit** durur:

> ⚠️ **Bu listedeki 11 dosyanın mührü doğrulanamadı — denetimde kullanmayın.**

Detay sayfasında şerit **her zaman** görünür ve dışa aktarma (CSV/PDF) çıktısına
da basılır. [VARSAYIM]

**Neden rozet çorbası değil:** 11 satırda 11 kırmızı rozet gözü kör eder ve
uyarı okunmaz olur. Bir çizgi + bir şerit, hem sürekli hem sakin. Whop
deseninin (satır içi sorun + altta toplu özet) takograf uyarlaması.

### 3.5 · Boş durum — tablo iskeleti KALIR

**Yasak olan yapılmıyor:** boş sayfada ortalanmış "veri yok" yazısı YOK.

Twingate deseni: **kolon başlıkları, süzgeç şeridi ve `0 dosya` sayacı yerinde
durur**; boş mesaj tablonun **gövdesinde**:

> **Henüz takograf dosyası yok**
> `.ddd` dosyalarını yükleyin — sürücü kartı (28 gün) veya araç ünitesi (365 gün).
> [Dosya yükle]

Böylece kullanıcı **hangi kolonların geleceğini** boşken de görür.

### 3.6 · i18n

`messages/{tr,de,en}.json` içinde **`takograf`** ad alanı. Mevcut yapıya uygun,
`lint:i18n` muhafızı üçünü de denetler.

⚠️ **Faaliyet adları çevrilir ama kod sözlüğü çevrilmez**: `surus/is/hazir/mola`
veritabanı değeridir; ekranda `Sürüş / Lenkzeit`, `Fahrt` vb. gösterilir.
Rapor dili kararının (0b5906c) aynısı.

---

## 4 · Kullanılan tasarım referansları

Hepsi **Mobbin**'den, `--scope user`. ⚠️ **Refero MCP kullanılamadı**:
`NO_SUBSCRIPTION — Your subscription is not active or has expired`.

### 4.1 · Veri tablosu

| Kaynak | Ne aldım |
|---|---|
| [Deel](https://mobbin.com/screens/9eb88ef8-f0af-4353-8a65-029a8bd03884) | **İki satırlı kimlik hücresi** (ad + altında rol) → bizde "dosya adı + tür·nesil". **Sessiz nokta+etiket durumu** (dolgulu rozet değil). Tablonun üstünde `Total 289 people` sayaç satırı. |
| [Twenty](https://mobbin.com/screens/35f5c474-ed6a-4c77-a6cb-f2e1d6b12398) | **Kaldırılabilir süzgeç çipleri** (`×`) ve **alt toplam satırı** (`Count all 3`, `Max of…`) → bizde faaliyet tablosunun altındaki süre toplamı. |
| [Fibery](https://mobbin.com/screens/94ad5a19-976a-4301-a5b9-c62e1c3f7b00) | **Sol satır-numarası oluğu** ve olay/varlık kolon düzeni → uzun ham faaliyet tablosu. |
| [Vapi](https://mobbin.com/screens/ade375a8-2dcf-43cf-b00a-972495b2e3d0) | **Sayaçlı hızlı süzgeç şeridi** (`All 32 · Successful 18 · Failed 1`) → `Tümü/Mühürlü/Doğrulanamadı/Hata`. **Monospace kısaltılmış kimlikler** → kart no ve VIN. Koyu tema. |

**Almadıklarım ve nedeni:** ClickUp ve Wrike'ın renkli durum hapları — kullanıcının
yasakladığı "renkli rozet çorbası"nın tam örneği.

### 4.2 · Yükleme

| Kaynak | Ne aldım |
|---|---|
| [Lindy](https://mobbin.com/screens/50bd3a40-45f3-44a4-a9da-fe935dffefe1) | **Kısıtı bırakma alanının İÇİNE yazmak** ("20MB maximum") → bizde "yalnız `.ddd` · en çok 5 MB". Durum, dosya adının altında **ikinci satır** olarak. |
| [Chatbase](https://mobbin.com/screens/5a2dc98d-5c16-4eea-985f-bf094ad6fa1d) | **Sağ altta engellemeyen işlem tepsisi** (`Uploading 1/1 · Processing…`) → asenkron ayrıştırmanın görünen yüzü (§2.3). Desteklenen tür listesi bırakma alanında. |
| [Revolut Business](https://mobbin.com/screens/2a7be71f-2e9a-404c-9c56-c846d8616783) | **`tarih · durum` ikinci satır** deseni ve koyu temada çok sessiz dosya satırı. |
| [Whop](https://mobbin.com/screens/03fc821c-eec1-4278-bf97-8f8ac202d34c) | **Satır içi sorun + altta toplu özet** (`4 files need cropping · 1 invalid file`) → mühür şeridinin mantığı (§3.4). |
| [Dropbox](https://mobbin.com/screens/dfe639b5-dfce-4e47-bf79-29e9bf2daec6) | Yükleme tepsisinde **durum sekmeleri** (All/Completed/Failed) → dosya listesi süzgeç şeridi. |

### 4.3 · Boş durum

| Kaynak | Ne aldım |
|---|---|
| [Twingate](https://mobbin.com/screens/37f0ebd3-6f6e-4360-b8d9-3c0b719e6f56) | 🔑 **İskelet kalır**: kolon başlıkları, süzgeçler ve `0 Devices` sayacı yerinde; boş mesaj tablo gövdesinde. Bizim boş durumumuzun birebir kaynağı. |
| [Amplitude](https://mobbin.com/screens/e7f11578-5a9e-405b-91d7-df492d340b25) | Boş durumda **tablonun iskelet önizlemesi** — gelecek şekli gösterme fikri. |
| [Hex](https://mobbin.com/screens/27d29fd4-757a-4832-b33b-737dd01a9d40) | Sessiz tipografi, tek birincil eylem, süs yok. |

**Almadığım:** Cake Equity'nin çizimli boş durumu — ürünün Authkit DNA'sına
(fcf8e49) yabancı.

---

## 5 · Servis mimarisi

### 5.1 · Go servisi nerede koşar

**Öneri: Hetzner, Almanya (Falkenstein/Nürnberg).** [VARSAYIM]

⚠️ Volkan'ın verdiği `178.104.143.207` **repoda hiç geçmiyor** [DOĞRULANDI —
`grep` sonucu boş]. O makinenin ne olduğunu, nerede durduğunu ve kimin
yönettiğini **[BİLMİYORUM]**; Faz 3'ten önce doğrulanmalı.

**Neden Vercel Go fonksiyonu değil:** Next.js paketiyle aynı dağıtımda Go
çalıştırmak ayrı bir runtime demek; ayrıca bölge sabitlemesi (fra1) ve **log
politikası** üzerinde bizim denetimimiz sınırlı. Ayrı bir kutu, kişisel veri
akan bir servis için daha savunulabilir.

### 5.2 · 🔴 Kişisel veri bu servisten geçiyor — dört kural

Takograf dosyası **şoförün kişisel verisidir** (090 sınıflandırması, §1.6).
Servis bu yüzden şu dördünü sağlamak zorunda:

1. **AB'de koşar.** Almanya = AB. ABD bölgesi kabul edilemez.
2. **İSTEK GÖVDESİ LOGLANMAZ.** Ne dosya, ne ayrıştırılmış çıktı, ne kart
   numarası. Log yalnız: zaman, istek kimliği, durum kodu, süre, bayt sayısı.
3. **DİSKE YAZMAZ.** Dosya bellekte ayrıştırılır ve yanıtla birlikte düşer.
   Geçici dosya bırakan bir uygulama, saklama politikasının dışında bir kopya
   üretir.
4. **Saklama süresi sıfır.** Servis durum tutmaz; tek kalıcı kopya Supabase
   kovasındadır ve 090 kapsamındadır.

⚠️ Bunlar **sözleşmeye de girmeli** — `docs/SAKLAMA-POLITIKASI.md`'deki
*"Galzura veri işleyendir"* cümlesinin teknik karşılığı budur.

### 5.3 · Next.js → Go çağrısı

```
POST https://<servis>/parse
Authorization: Bearer <TAKOGRAF_SERVIS_SIRRI>
Content-Type: application/octet-stream
X-Istek-Kimlik: <uuid>
gövde: ham .ddd baytları
```

- Sır **env**'de (`CRON_SECRET` deseni), `safeEqual` ile karşılaştırılır
- Servis **yalnız** bu sırla çağrılır; açık uç yok
- Yanıt: `{ nesil, muhur: {...}, ozet: {...}, faaliyetler: [...], olaylar: [...] }`
- İstemci tarafı **asla** doğrudan servise gitmez — dosya önce bizim
  sunucumuzdan geçer, Storage'a yazılır, sonra servise gönderilir

⚠️ **Detaylı hız bloğu istenmez** (§0): istek `?detayli_hiz=0` ile gider.
15 kat daha küçük yük.

### 5.4 · Servis düşerse

**Yükleme yine başarılı olur.** Dosya Storage'da, satır
`ayristirma_durumu='bekliyor'`.

- Ekran: *"ayrıştırma sırada — servis şu an yanıt vermiyor"*
- Bir cron (ya da elle "yeniden dene") bekleyenleri toplar
- **Dosya asla kaybolmaz** (§2.4)

> Ayrıştırıcının çalışmaması bir gecikmedir; dosyanın kaybolması bir felakettir.
> Mimari bu ikisini karıştırmamalı.

---

## 6 · Kesişim — `time_entries` farkı görünsün mü

### Cevap: **Bu fazda HAYIR.**

**Gerekçe:**

1. **Kuralı olmayan bir fark gürültüdür.** İhlal motoru bu fazın dışında
   (Volkan kararı). "Vardiya 06:00'da başladı, takograf 06:14 diyor" satırı,
   kullanıcının ne yapacağını bilmediği bir sayıdır.
2. **Daha kötüsü: birini diğerine uydurmaya davet eder.** 087'nin dersi tam
   buydu — *"sessizce üzerine yazma YASAK, Avusturya iş müfettişliği bu raporu
   okuyor"*. Farkı gösterip yanına "düzelt" koymak, o yasağın etrafından
   dolaşmanın en kolay yolu olurdu.
3. İkisi zaten **farklı büyüklükleri** ölçüyor (Faz 1 §5.1): AZG çalışma süresi
   vs 561/2006 sürüş/iş/hazır/dinlenme.

### Ama şema bugünden hazır olmalı

`takograf_faaliyetleri` satırları `worker_id` + `baslangic`/`bitis` taşıyor.
Yani Faz 3+'te karşılaştırma bir **sorgu** işidir, migration işi değil.

**Faz 3+ için önerilen biçim** [VARSAYIM]: vardiya detayında **salt okunur bir
kıyas bloğu** — iki zaman çizelgesi yan yana, fark **etiketlenir ama hiçbir
şey değiştirilmez**, ve "hangisi doğru" denmez; ekran *"takograf kalibrasyonlu
kayıttır"* der, gerisini insana bırakır.

### 086 bu fazda beslenmiyor

Faz 1 §5.2 geçerli. Ek not: HAK61 `AT_AZG` + `surus_tahmini=false` [DOĞRULANDI,
canlı ölçüm] — ama hedef müşteri TIR filosu olduğu için orada `EU_561` açık
olacak ve takograf `surus_tahmini`'ni **ölçüme** çevirecek. Bu, Faz 3'ün en
değerli kazancı.

---

## 7 · Faz 3'e geçmeden önce Volkan'ın onaylaması gerekenler

1. **Go kurulumu ve ilk ölçüm.** Go yok (§0). İlk iş: kur, `go test ./...`
   çalıştır, **ayrıştırma süresini ölç** ve **imza doğrulamasının anonim veride
   ne yaptığını gör**. Bu ölçüm olmadan §2.3'teki asenkron kararı bir
   varsayımdır.

2. **`178.104.143.207` nedir?** Repoda geçmiyor. AB'de mi, kim yönetiyor, log
   politikası ne? (§5.1)

3. **Servisin dört kuralı kabul mü?** AB'de koşar · gövde loglanmaz · diske
   yazmaz · saklama sıfır. (§5.2)

4. **Detaylı hız bloğu atlanacak mı?** Ölçüm: dosyanın %93,5'i. Atlanırsa
   kaza incelemesi verisi ayrıştırılmaz (dosyada durur). (§0)

5. **Yükleme yetkisi yalnız yönetici mi?** Şoförün kendi kartını yüklemesi bu
   fazda yok. (§2.1)

6. **Çakışan dönemlerde birleştirme yok** kararı onaylanıyor mu? Ekran kaynak
   seçtirecek. (§1.5)

7. **Ayrıştırılamayan dosya saklanır** kararı onaylanıyor mu? (§2.4)

8. **090 zaman körlüğü** bu fazda çözülmüyor, yalnız not düşülüyor — kabul mü?
   (§1.6)

9. **Vardiya farkı bu fazda gösterilmiyor** — kabul mü? (§6)

10. **Refero aboneliği** süresi dolmuş. Yenilenecek mi, yoksa Mobbin yeterli mi?

---

## 8 · Açık kalanlar

| Konu | Durum |
|---|---|
| Ayrıştırma süresi | **[BİLMİYORUM]** — Go kurulu değil |
| İmza doğrulamasının anonim veride sonucu | **[VARSAYIM]** — başarısız olması beklenir, ölçülmedi |
| `.ddd` yeniden üretimi (`Unparse`) | **[BİLMİYORUM]** — API var, denenmedi |
| `tachograph-go` Gen2 v2 **ayrıştırma** kalitesi | golden dosyalar var, **koşturulmadı** |
| 10 kart kaydı gerçekten 10 farklı şoför mü | **[BİLMİYORUM]** — 7'si aynı boyutta |
| `178.104.143.207` | **[BİLMİYORUM]** — repoda yok |
| Gerçek (anonim olmayan) `.ddd` | yok — müşteri verisi gerekir |
| `.ddd` için tescilli MIME türü | **[BİLMİYORUM]** — `application/octet-stream` varsayıldı |
