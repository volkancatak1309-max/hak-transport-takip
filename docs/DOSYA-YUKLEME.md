# Mobil dosya yükleme — tasarım + uygulama

**Tarih:** 03.09.2026 · **Durum:** ✅ **UYGULANDI + CANLIDA KANITLANDI** (galzura-demo)
**Dal:** `feat/dosya-yukleme` · **PUSH YOK**
**Görev:** `MOBIL-YETKI-ENVANTERI.md` § "Ortak altyapı — tek seferlik iş"
**Kararlar:** Volkan, 03.09.2026 (§ 5'te tek tek işaretli)

---

## 0. Önce ölçüm: sekiz dosya yüzeyi var, **hiçbiri canlıda kullanılmıyor**

Envanter *"beşi dosya yükleme istiyor, bu tek altyapı beş işi birden açar"*
diyor. Ölçtüm — zemin bundan farklı çıktı.

**Panelde dosya taşıyan yüzeyler** (canlı şema + satır sayımı, salt okuma):

| # | Yüzey | Tablo | Dosya kolonu | Kova | HAK61 | Sendigo |
|---|---|---|---|---|---|---|
| 1 | Masraf fişi | `expense_entries` | `receipt_path` | `expense-receipts` | **1** | 0 |
| 2 | Yakıt fişi | `fuel_entries` | `receipt_path` | `fuel-receipts` | **1** | 0 |
| 3 | Bakım fişi | (bakım tablosu) | `receipt_path` | `maintenance-receipts` | — | — |
| 4 | Vardiya fotoğrafı | `shift_photos` | `storage_path` | `shift-photos` | **1** | 0 |
| 5 | DVIR kusur fotoğrafı | `dvir_yanitlari` | `foto_yolu` | `dvir-fotolari` | **0** | 0 |
| 6 | Teslimat fotoğrafı | `teslimat_fotograflari` | `storage_path` | `teslimat-kaniti` | **0** | 0 |
| 7 | Teslimat imzası (raster yedek) | `teslimatlar` | `imza_yol` | `teslimat-kaniti` | **0** | 0 |
| 8 | Takograf `.ddd` | `takograf_dosyalari` | `depo_yolu` | `takograf` | **0** | 0 |
| 9 | **Personel belgesi** | `worker_documents` | **YOK** | **YOK** | 0 | 0 |

### 🔴 Bulgu 1 — Personel belgesi panelde de dosya TUTMUYOR

`worker_documents` (078) kolonları: `worker_id`, `type_id`, `expires_at`,
`document_no`, `note`. **Dosya kolonu yok, kova yok, yükleme yolu yok.**

Envanter bunu *"#31 personel belgesi — dosya yükleme gerektirir"* diye
sınıflandırmış. Ölçüm bunu **çürütüyor**: bu bir "mobil geride" durumu değil,
**ürünün hiç yapmadığı bir şey**. Tablonun varlık sebebi belgenin KENDİSİ değil
**süre takibi** — 078'in kendi yorumu bunu söylüyor.

Yani "dosya yükleme altyapısı beş işi açar" cümlesindeki beşinci iş, altyapı
kurulsa bile **açılmaz**: önce şema kararı (kolon + kova) gerekiyor.

### 🔴 Bulgu 2 — Sekiz yüzeyin toplam kullanımı: **3 satır**

HAK61'de masraf 1, yakıt 1, vardiya fotoğrafı 1; kalan beşi **sıfır**.
Sendigo'da **hepsi sıfır**.

Bunun iki ayrı sebebi var ve ikisi de kayıtta:

- **Masraf / Yakıt / Bakım modülleri KAPALI.** `lib/tenant.ts` varsayılanları
  `FUEL_ENABLED=false`, `EXPENSE_ENABLED=false`, `MAINTENANCE_ENABLED=false`.
  Bu modüller kapalıyken fiş yükleme ucu yazmak, **hiçbir kiracıda
  çağrılamayacak** bir uç yazmak demek. *(Vercel env'leri bu ağaçtan
  okunamıyor; 1'er satır + kapalı varsayılan bu okumayı destekliyor ama
  bayrağın canlı değeri **doğrulanmadı** — § 6/1.)*
- **DVIR, ePOD ve takograf yeni** (081, 080, 091 — Ağustos sonu) ve **saha
  kullanımı henüz başlamamış.**

> **Bu, "yapmayalım" demek değil.** Ama "beş işi birden açar" gerekçesi
> ölçümde tutmuyor: altyapı bugün **sıfır kullanımı olan** yüzeyleri ikinci bir
> platforma taşıyacak. Sıralamayı Volkan'ın bilerek seçmesi için yazıyorum.

---

## 1. SORU A — Nereye yüklenecek?

### Öneri: **Supabase Storage — panelin bugün kullandığı AYNI 7 kova.** Hetzner değil.

Kovaların canlı ayarları (iki kiracıda da **birebir aynı**, salt okuma):

```
fuel-receipts         private  5 MB  image/jpeg|png|webp|heic
expense-receipts      private  5 MB  image/jpeg|png|webp|heic
maintenance-receipts  private  5 MB  image/jpeg|png|webp|heic
shift-photos          private  5 MB  image/jpeg|png|webp|heic
teslimat-kaniti       private  5 MB  image/jpeg|png|webp|heic
dvir-fotolari         private  5 MB  image/jpeg|png|webp|heic
takograf              private  5 MB  application/octet-stream|x-tachograph|…
```

**Neden aynı yere:**

1. **Kiracı izolasyonu bedava geliyor** (§ 3).
2. **İmzalı URL düzeneği kurulu** — `signedReceiptUrl` / `signedReceiptUrls`
   (toplu imzalama dahil). Hetzner'de bunun karşılığını yazmak, ikinci bir
   yetkilendirme katmanı demek.
3. **Yedekleme ve saklama politikası** (090) Supabase projesine bağlı.
   İkinci depo, ikinci saklama kuralı ve "hangi veri nerede" sorusunun ikinci
   cevabı demek — GDPR yükümlülüğü açısından bedeli yüksek.
4. **Panelle tek kaynak** kuralı: bu turda (Tur 1) uygulanan ilke aynen geçerli
   — yükleme mantığı `lib/storage.ts`te kalır, kapı çağıranda.

**Takograf istisnası GERÇEK DEĞİL:** okuyucu servisi Hetzner'de ama **arşiv
Supabase'de** (`takograf` kovası) ve `HK091` değişmezliği oraya bağlı. Bu ayrım
korunmalı; dosya Supabase'e yazılır, servise **içerik** gönderilir.

### Karşı seçenek (reddedilme gerekçesiyle)

**Hetzner'e taşımak** ancak şu üçünden biri doğruysa mantıklı: (a) 5 MB tavanı
gerçekten yetmiyor, (b) Supabase Storage maliyeti ölçülmüş bir sorun, (c) veri
Avusturya/AB dışına çıkmasın diye yasal bir kısıt var. **Üçü de bugün
ölçülmedi** ve üçü de doğru olsaydı **panelin de taşınması** gerekirdi — mobili
tek başına taşımak iki depo demek.

---

## 2. SORU B — Boyut ve tip sınırı

### Öneri: **5 MB, mevcut MIME listeleri. Değiştirme.**

Sınır bugün **üç katmanda** duruyor ve üçü de aynı sayıyı söylüyor:

| Katman | Değer | Aşılabilir mi |
|---|---|---|
| Supabase kova ayarı | 5 MB + MIME beyaz listesi | **Hayır** — sunucu tarafı, son söz |
| `lib/storage.ts` `MAX_BYTES` | 5 MB + `ALLOWED` MIME | Kod değişikliğiyle |
| `lib/takograf.ts` `EN_BUYUK_BAYT` | 5 MB + `.ddd` uzantı | Kod değişikliğiyle |

### 🔑 Mobil yol panelden **daha geniş** — ve bu bir fırsat

Panelin gerçek darboğazı 5 MB **değil**: fotoğraflar **server action FormData**
gövdesinden geçiyor ve Next.js onu varsayılan **~1 MB**'da kesiyor. `lib/
image-resize.ts` tam da bu yüzden var — istemcide 1600 px / JPEG q0.85'e
küçültüyor ve kendi yorumu bunu söylüyor.

**Route handler'da o sınır yok.** Vercel Functions gövde tavanı bugün 100 MB.
Yani mobil uç 5 MB'lık ham fotoğrafı **doğrudan** kabul edebilir — ki bu iyi,
çünkü React Native'de `canvas` yok ve `resizeImage` aynen kullanılamaz.

**Yine de küçültme önerilir** (`expo-image-manipulator`), sebebi sınır değil:
şoförün mobil verisi ve pili. Ama **zorunlu tutulmamalı** — sunucu 5 MB'a kadar
kabul etmeli ki küçültmenin başarısız olduğu cihazda (HEIC decode hatası)
yükleme düşmesin. Panel de aynı şeyi yapıyor: HEIC küçültülemezse ham gidiyor.

### Karar noktası

| Seçenek | Etki |
|---|---|
| **5 MB'da kal** *(öneri)* | Hiçbir kova ayarı değişmez, üç katman hizalı kalır |
| 10 MB'a çıkar | **7 kovanın ayarı da elle değişmeli** (3 kiracıda ayrı ayrı), `lib/storage.ts` ve takograf sabiti güncellenmeli. Kova ayarı değişmezse istemci "yükleniyor" gösterip sunucudan sessiz ret alır |

---

## 3. SORU C — Kiracı izolasyonu

### Cevap: **Zaten var, ek bir şey gerekmiyor.**

Her kiracı **ayrı bir Supabase projesi** — ayrı URL, ayrı service anahtarı,
ayrı Storage. Kova adları aynı (`expense-receipts` üçünde de var) ama
**farklı projelerde**, yani çapraz erişim şema ya da kontrol koduyla değil
**altyapıyla** kapalı.

Mobil token katmanı bunu ikinci kez kapatıyor: token'lar kiracının kendi
`SESSION_PASSWORD`'üyle mühürleniyor, yani HAK61'de üretilen bir token Sendigo
dağıtımında **çözülemez** (`lib/mobile-auth.ts` dosya başı notu).

**Kova içi yol deseni** (kişi ayrımı):

```
{workerId}/{yyyy}/{mm}/{uuid}.{ext}     ← lib/storage.ts uploadReceipt
{yyyy}/{mm}/{uuid}.ddd                  ← lib/takograf.ts depoYolu
```

⚠️ Takograf yolunda `workerId` **bilerek yok** — kaynak yorumu: *"kişisel ad
yol içinde geçmez"*. Yükleyen kişi satırda (`yukleyen_worker_id`), yolda değil.

**Ek prefix önerilmiyor.** Kova zaten kiracıya özgü; yola bir kiracı kodu
eklemek, tek bir projede iki kiracı olduğu yanılsaması yaratırdı.

---

## 4. SORU D — Panel bugün dosyayı nereye koyuyor?

§ 0'daki tablo. **Tek yükleme fonksiyonu:** `lib/storage.ts` `uploadReceipt`
(6 yüzey) + `lib/takograf-db.ts` `dosyaYukle` (takograf, kendi denetimiyle).

Akış **tek aşamalı**: aynı server action içinde `uploadReceipt` → `insert`.

### 🔴 Bulgu 3 — Yetim dosya yolu açık, silme yolu HİÇ YOK

Ölçüldü: kaynakta **tek bir `storage.remove()` çağrısı yok**.

İki sonucu var:

1. `uploadReceipt` başarılı + `insert` başarısız → dosya kalır, kaydı yoktur.
   **Bu bugünkü panelde de böyle** (yeni bir kusur değil).
2. Kayıt silinince (CRUD turu her listeye "Sil" ekledi) **dosya Storage'da
   kalır**. Saklama politikası (090) satırları temizler, dosyaları temizlemez.

Mobil yükleme bu yüzeyi **genişletir**, yani sorunu büyütür. Karar § 5/3.

---

## 5. Kararlar — Volkan'da

### Karar 1 — Uç şekli: tek aşama mı, iki aşama mı?

| | (a) **Tek aşama** — dosya + veri aynı multipart istekte | (b) **İki aşama** — `POST /uploads` → `{yol}` → JSON ile kaydet |
|---|---|---|
| Panelle aynı mı | **Evet** (bugünkü akış) | Hayır |
| Yetim dosya | Yalnız insert hatasında | **Her başarısız/yarım kalan akışta** |
| İstemci karmaşıklığı | Düşük | İki istek, ara durum yönetimi |
| Yeniden deneme | Dosya tekrar yüklenir | Dosya bir kez yüklenir |
| Uç sayısı | Her iş kendi ucunda multipart | Tek jenerik uç + mevcut JSON uçları |

**Öneri: (a) tek aşama.** Panelin davranışıyla aynı, yetim yüzeyi dar. (b)'nin
tek gerçek avantajı (büyük dosyada yeniden deneme) 5 MB'da anlamsız.

### Karar 2 — 🔴 Personel belgesi (#31): şema kararı gerekiyor

Bu iş **altyapıyla açılmıyor**. Üç seçenek:

| | Ne gerekir |
|---|---|
| **(i) Kapsam dışı** | Bugünkü hâl korunur: tarih + belge no + not. Envanterin #31'i "dosya değil, ekran" olarak yeniden sınıflandırılır. |
| **(ii) Tek dosya** | `worker_documents.storage_path` kolonu + yeni kova (`personel-belgeleri`) + migration + 3 kiracıya uygulama |
| **(iii) Çok dosya** | Ayrı tablo (`worker_document_files`) — ePOD deseni. Bir belgenin ön/arka yüzü ayrı satır. |

**Öneri: (ii)**, ama **ancak Volkan bu işi istiyorsa**. Belge PDF'i saklamak
GDPR yükümlülüğü ekler (kimlik/ehliyet görüntüsü **özel nitelikli olabilir**) ve
saklama politikasına (090) yeni bir madde gerektirir.

### Karar 3 — Yetim dosya temizliği bu turda mı?

| | |
|---|---|
| **(i) Bu turda değil** *(öneri)* | Mevcut kusur; mobil onu büyütür ama yaratmaz. Ayrı bir tur: silme yolları + saklama cron'una dosya adımı. |
| **(ii) Bu turda** | Her yeni uç, insert başarısızsa yüklediği dosyayı siler (`storage.remove`). Kapsamı dar, faydası gerçek — ama panelin davranışıyla **ayrışır**, yani ortak çekirdeğe girmeli ve panel de kazanmalı. |

### Karar 4 — 🔴 Sıralama: kapalı modüllerin fişi mi, açık modüllerin fotoğrafı mı?

Ölçüm (§ 0) şunu söylüyor:

- **Masraf + yakıt fişi** → modüller **kapalı**, hiçbir kiracıda çağrılamaz
- **Takograf `.ddd`** → 091 canlı, kullanım **0**; yükleme paneldeki tek yol
- **Teslimat fotoğrafı + DVIR fotoğrafı** → 080/081 canlı, kullanım **0**,
  ama **şoförün günlük akışında** ve mobil bu akışın doğal yeri
- **Vardiya fotoğrafı** → `shift_photos`, panelde şoför akışında var,
  mobilde yok

**Öneri: teslimat fotoğrafı + DVIR fotoğrafı önce.** Gerekçe: ikisi de şoförün
sahadaki işi, ikisi de telefonla yapılması gereken iş (masaüstünde fotoğraf
çekilemez), ikisinin de tablosu ve kovası **hazır**. Masraf/yakıt fişi ise
modül açılana kadar ölü kod olur.

### Karar 5 — Hız sınırı

Mobil yazma uçlarının **hiçbirinde** hız sınırı yok (bu tur dahil). Dosya
yükleme ilk kez **bant genişliği ve depolama** harcayan bir uç olacak.

| | |
|---|---|
| **(i) Sınırsız** | Kardeş uçlarla tutarlı; kötüye kullanım kimliği belli bir kullanıcıdan gelir |
| **(ii) Basit sınır** *(öneri)* | Kişi başına dakikada N yükleme. `login_attempts` deseni kullanılabilir ama o tablo kimlik doğrulama için; ayrı bir sayaç gerekir |

---

## 6. Ölçülmeyenler / açık sorular

| # | Konu | Durum |
|---|---|---|
| 1 | **Modül bayraklarının canlı değeri** | `FUEL/EXPENSE/MAINTENANCE_ENABLED` bu ağaçtan okunamıyor (Vercel env). Varsayılan `false` ve satır sayıları (1/1) bunu destekliyor — ama **doğrulanmadı**. Volkan'ın `vercel env ls` çıktısı ya da onayı gerekiyor. |
| 2 | **galzura-demo** | Kova ve tablo ölçümü **yapılamadı** — service anahtarı bu ağaçta yok. HAK61 + Sendigo ölçüldü ve **birebir aynı** çıktı; üçüncüsünün de aynı olması bekleniyor ama iddia edilmiyor. |
| 3 | **Bakım fişi tablosu** | Kova var (`maintenance-receipts`), tablo adı canlı şemada aranmadı (modül kapalı). |
| 4 | **RN tarafında dosya seçimi** | `expo-image-picker` / `expo-document-picker` gerekiyor mu, mobil CC'de hangi paketler kurulu — **ölçülmedi**. Takograf `.ddd` için görüntü seçici yetmez, belge seçici gerekir. |
| 5 | **Storage maliyeti** | Ölçülmedi. Bugünkü kullanım ~3 dosya olduğu için bugün sorun değil; teslimat fotoğrafı açılırsa 080'in kendi hesabı **~5,5 GB/yıl** diyor. |
| 6 | **Vercel gövde tavanı** | 100 MB olduğu bilgisi platform dokümanından; bu kurulumda **ölçülmedi**. 5 MB'da kalınırsa sorun doğmuyor. |

---

---

# BÖLÜM B — UYGULAMA (kararlar sonrası)

## B.0 Ne yapıldı

| Dosya | İş |
|---|---|
| `lib/upload-core.ts` | **Yükleme çekirdeği** — tek yükleme, tek silme, hız sınırı, yetim koruması |
| `lib/dvir-submit.ts` | DVIR form gönderimi — panel + mobil ORTAK |
| `db/migrations/098_yukleme_hiz_siniri.sql` | `upload_rate` tablosu |
| `POST /api/mobile/dvir` | Kontrol formu + kusur fotoğrafları (multipart) |
| `POST /api/mobile/sefer/[id]/duraklar/[durakId]/foto` | Teslimat kanıtına fotoğraf |
| `lib/storage.ts` | `uploadReceipt` gövdesi çekirdeğe indi (6 panel çağıranı değişmedi) |
| `app/actions/dvir.ts` · `teslimat.ts` | Yetim korumasına bağlandı |
| `app/actions/shift.ts` | `deleteEntryAction` artık `shift_photos` dosyalarını da siliyor |
| `scripts/check-dosya-yukleme.mjs` | 8 denetimlik muhafız (`lint:dosya-yukleme`) |

## B.1 🔴 Tasarımın bir maddesi CANLIDA ÇÜRÜDÜ

İlk tasarım `POST /api/mobile/dvir/[id]/foto` idi: formu gönder, fotoğrafı
sonradan ekle/değiştir/sil. **Yazıldı, canlıda ilk denemede reddedildi.**

Sebep 081'de yazılı ve tasarım aşamasında okunmamıştı:

```sql
create trigger trg_dvir_yanit_degismez before update on public.dvir_yanitlari
  → raise exception 'kontrol yaniti DEGISTIRILEMEZ' using errcode = 'HK081';
```

`dvir_yanitlari` **KOŞULSUZ** değişmez — `dvir_formlari`daki gibi alan alan
değil, **her UPDATE**. Yani kusur fotoğrafı ancak form YAZILIRKEN konabilir;
sonradan eklemek, değiştirmek ve silmek şema düzeyinde kapalı.

**Bu bir eksik değil, 081'in kararı:** kontrol formu bir beyandır ve beyan
sonradan güzelleştirilemez. Düzeltmenin yolu YENİ FORM doldurmaktır.

**Ne yapıldı:** foto ucu kaldırıldı, yerine **`POST /api/mobile/dvir`** yazıldı
— formu fotoğraflarıyla birlikte gönderen uç (INSERT, şemaya uygun). Karar
kaydı `lib/dvir-db.ts` sonunda duruyor ki aynı duvara ikinci kez çarpılmasın.

> **Ders:** değişmezlik tetikleyicisi olan bir tabloya yazacak uç tasarlarken
> tetikleyicinin KAPSAMI okunmalı. `teslimatlar` için okumuştum (`before
> update`, DELETE serbest), `dvir_yanitlari` için varsaymıştım.

## B.2 Yetim dosya — üç kapı

| Kapı | Nerede | Ne yapar |
|---|---|---|
| **Yazma düşerse geri al** | `yukleVeYaz` | Dosyayı yükler, kaydı yazdırır; `yaz` null dönerse/fırlatırsa dosyayı **siler** ve kotayı iade eder |
| **Çoklu: hepsi ya da hiçbiri** | `coklaYukleVeYaz` | N dosya + TEK kayıt. Herhangi bir adım düşerse **o ana kadar yüklenenlerin tamamı** silinir |
| **Kayıt silinince dosya da** | `deleteEntryAction` | `shift_photos` yolları **cascade'den ÖNCE** okunur, satır silinir, dosyalar en son |

**Kapatılan gerçek kusur:** `app/actions/dvir.ts` kusurlu madde başına dosya
yükleyip döngüde biriktiriyordu; `createDvirForm` düşerse **N dosyanın hepsi**
yetim kalıyordu. Artık `coklaYukleVeYaz` sarıyor.

**Kapatılan ikinci kusur:** `shift_photos.time_entry_id` FK'si `on delete
cascade` (020). Vardiya silinince satırlar gidiyor, **dosyalar kalıyordu** —
saklama politikası (090) onlara dokunmuyor.

## B.3 Hız sınırı — 10/dakika, kişi başına

`upload_rate` (098): sabit pencere, `worker_id` anahtarlı.

**Neden `login_attempts` değil:** o tablo kimlik doğrulama sayacı ve başarılı
girişte **silinir** — yükleme kotasını oraya koymak, girişin kotayı
sıfırlaması demekti. Anahtar da farklı: kota KİŞİYE ait (aynı şoför iki
cihazdan tek kotadan harcar), IP'ye değil (saha ekibi aynı depo Wi-Fi'sinde).

**🔑 Kota İSTEK başına, dosya başına değil (çoklu yüklemede).** Kontrol
listesi 15-20 maddelik; hepsi kusurluysa dosya başına kota formu 10. maddede
reddederdi — bir maliyet freni, yasal bir formu tamamlanamaz hâle getirirdi.
Tavan dosya SAYISIYLA kapalı (`COKLU_DOSYA_TAVAN = 30`).

**098 yoksa fail-OPEN** ve bu bilinçli: fail-closed olsaydı migration'ı
çalıştırmamış kurulumda yükleme TÜMDEN kapanırdı — fren, özellik kapısına
dönerdi. Kimlik kapılarındaki fail-closed kuralıyla çelişmiyor: orada hatanın
bedeli yetkisiz erişim, burada fazla dosya.

⏳ **098 hiçbir kiracıda çalıştırılmadı** (§ B.6).

## B.4 Tip listesi — panel ve mobil bilerek FARKLI

| Yol | Kabul | Neden |
|---|---|---|
| Yeni mobil uçlar | jpeg · png · webp | Volkan kararı |
| Panel (`uploadReceipt`) | + **heic** | Bugün kabul ediyordu, kova ayarı da izin veriyor — davranış değiştirilmedi |

`image/heic` yeni uçlarda dışarıda çünkü sunucuda çözecek yol yok: panel
istemcide JPEG'e çeviriyor (`lib/image-resize.ts`), çeviremezse ham gönderiyor
— ve o dosya hiçbir tarayıcıda **görüntülenemiyor**. Kabul edilen ama
açılamayan bir kanıt, reddedilenden kötüdür.

## B.5 Kanıt

### Standart doğrulama

| Adım | Sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| `npm run build` | **başarılı** — `/api/mobile/dvir`, `/api/mobile/sefer/[id]/duraklar/[durakId]/foto` çıktıda |
| 16 muhafız | **15 yeşil**, `lint:test-filters` tek bulgu (baseline, bu turla ilgisiz) |
| ESLint | **43 / 28 hata / 15 uyarı** — baseline'ın aynısı |
| `lint:install-sql` | yeşil — 098 `ORDER`a eklendi, 4 kurulum/hizalama dosyası yeniden üretildi |

### Muhafız — ve muhafızın kendisi

`npm run lint:dosya-yukleme` · **8 denetim**, `verify` zincirine eklendi.

**8/8 arıza enjeksiyonu yakalandı**, geri yazma tuttu (temiz ağaçta çıkış 0).

Muhafız yazılırken **üç yanlış pozitif** çıktı ve üçü de daraltıldı:
- `lib/takograf-db.ts` kendi `dosyaYukle`sini dışa aktarıyor → **ad çakışması**;
  D5 artık import kaynağını denetliyor.
- `aracGun.size > 0`, `zoneIds.size > 0` → **koleksiyon boyutu**, dosya tavanı
  değil; D3 deseni bayt eşiğine daraltıldı.
- `lib/takograf-db.ts` gerçekten kendi `storage.upload`ını yapıyor → **gerekçeli
  istisna** (§ B.6).

### 🔑 CANLIDA KANIT — galzura-demo, Storage sayılarak

`npm run verify:dosya-yukleme-canli` · **24/24 iddia geçti**

| Adım | Ölçüm |
|---|---|
| **Form + foto** | `200` · `dvir-fotolari` **0 → 1** · kayıt dosyayı gösteriyor · dosya gerçekten orada · kusur **1 iş emri** açtı |
| **4 RED** | 5 MB üstü → `cok_buyuk` · `text/plain` → `tip_yasak` · `image/heic` → `tip_yasak` · fotoğrafsız kusur → `kanit_yok` |
| **Red sonrası** | 🔴 dosya sayısı **1 → 1** — dördü de dosya bırakmadı |
| **Yetim testi** | `yaz` bilerek null → `dosyaTemizlendi:true` · dosya sayısı **1 → 1** |
| **Kayıt silme** | vardiya + 2 fotoğraf → sil → satırlar cascade ile gitti · 🔴 **dosyalar da gitti (2 → 0)** · ikisi de Storage'da yok |
| **Temizlik** | test formu/maddesi/dosyaları silindi · 🔴 **Storage temiz (0 · 0)** |

Hiçbir kalıcı iz bırakılmadı; HAK61 ve Sendigo'ya **dokunulmadı** (betik proje
referansını doğrulayıp galzura-demo değilse çalışmayı reddediyor).

## B.6 Açık kalanlar

| # | Konu | Durum |
|---|---|---|
| 1 | **Migration 098** | ✅ **16.09.2026 — ÜÇ KİRACIDA DA UYGULANDI** (galzura-demo, Sendigo, HAK61). Doğrulama sayıları: tablo **1** / kolon **4** / indeks **1**. Hız sınırı artık fail-open değil, gerçekten sayıyor. |
| 2 | **Takograf yükleme** | Çekirdeğe bağlanmadı — **gerekçeli istisna**, muhafızda yazılı. Yol deseni (`yyyy/mm/uuid.ddd`, kişi klasörü YOK), MIME ve SHA256 tekilliği farklı. Bedeli açık: o yolda **yetim koruması yok**. Volkan'ın sıralamasında **üçüncü**. |
| 3 | **Masraf / yakıt / bakım fişi** | Modüller kapalı; uç yazılmadı (Karar 4: kuyruğun sonu). Panel yolları yine de çekirdeğe bağlandı — yetim koruması ve hız sınırı **onlarda da geçerli**. |
| 4 | **Teslimat foto ucu canlıda ölçülmedi** | Kod yazıldı, build'e girdi, ama galzura-demo'da **hiç sefer/durak/teslimat kaydı yok** (`teslimatlar` = 0 satır). Test verisi üretmek sefer + durak + kanıt zinciri kurmayı gerektiriyordu; DVIR yolu aynı çekirdeği kullandığı için ölçüm oradan alındı. |
| 5 | **Yetim tarayıcı** | Yok. Bugünkü kapılar YENİ yetim üretilmesini engelliyor; GEÇMİŞTE birikmiş dosyalar (varsa) taranmıyor. Ayrı bir bakım işi. |
| 6 | **Personel belgesi** | Karar 2 gereği **kapsam dışı**. Envanterdeki #31 "ekran işi" olarak yeniden sınıflandırılmalı (mobil CC'ye not). |
| 7 | **Saklama cron'una dosya adımı** | **Yapılmadı ve yapılamadı:** saklama katmanı (090) yalnız `device_telemetry` + `driver_locations` kapsıyor (`HAM_TABLOLAR`), ikisinde de dosya yok. Dosya adımı eklemek, saklama kapsamını genişletmek demek — fotoğraflar için saklama süresi kararı gerekir. **Volkan'ın kararı bekliyor.** |
| 8 | **064'teki RLS kuralı fiilen ölü — 16 tablo sapmada** | `064_customer_zone_visits.sql:124` "Kasadaki kural (17 Tem): yeni migration'da RLS zorunlu" diyor, ama 064'ten sonra tablo yaratan **086/088/089/090/091/098'in hiçbiri RLS açmadı (16 tablo)**; şemadaki 77 tablodan yalnız 2'sinde RLS açık (`idle_episodes`, `zone_visits`) ve ikisinin de policy'si yok. Güvenlik etkisi **yok** — erişimi RLS değil GRANT kapatıyor (`anon`/`authenticated` hiçbir tabloda hak taşımıyor, depoda `ANON_KEY` geçen satır yok, tek istemci `lib/supabase.ts` service_role). Karar 16.09.2026: **099 yapılmadı**, `upload_rate` olduğu gibi birleştirildi; tutarlılık istenirse 66 tabloyu kapsayan ayrı temizlik işi, tek atımlık yama değil. |
| 9 | **`wtmain` worktree'si** | ✅ **16.09.2026 ONARILDI** (`git restore .`, 850/850 dosya yerinde, `git status` temiz). Hasar: temp temizliği izlenen dosyaların çoğunu diskten silmişti; değişiklik/stage/izlenmeyen dosya olmadığı için **veri kaybı yoktu** ve birleştirme commit'leri commit nesnelerinden kurulduğu için sonuca da sızmamıştı (`git diff main <dal>` boş ölçüldü). |


## 7. Kararlar — Volkan, 03.09.2026 ✅

| # | Karar | Uygulandı mı |
|---|---|---|
| 1 | **Tek aşama** — dosya + veri tek multipart istekte | ✅ iki uç da öyle |
| 2 | Personel belgesi **KAPSAM DIŞI** (özel nitelikli veri; saklama/silme/erişim politikası gerekiyor, store öncesi ayrı tur) | ✅ yapılmadı · envanterde #31 "ekran işi" olarak yeniden sınıflandırılmalı |
| 3 | Yetim temizliği **BU TURDA**, ortak çekirdekte, panel de kazansın | ✅ üç kapı (§ B.2) · panel yolları da bağlandı |
| 4 | Sıra: **teslimat + DVIR fotoğrafı** · masraf/yakıt sonda · takograf üçüncü | ✅ ikisi yazıldı · takograf istisna (§ B.6/2) |
| 5 | **Kişi başına dakikada 10** yükleme | ✅ 098 + `HIZ_TAVAN=10` · ⏳ migration çalıştırılmadı |
| 6 | Modül bayrakları **kapalı sayılacak**, doğrulanmadı | ✅ masraf/yakıt ucu yazılmadı |

⚠️ **Karar 3'ün bir parçası yapılamadı:** "saklama cron'una dosya adımı" —
saklama katmanı dosya taşıyan hiçbir tabloya dokunmuyor (§ B.6/7).
