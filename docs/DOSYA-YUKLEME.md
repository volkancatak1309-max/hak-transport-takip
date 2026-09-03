# Mobil dosya yükleme — TASARIM (kod YAZILMADI)

**Tarih:** 03.09.2026 · **Durum:** 🛑 **ONAY BEKLİYOR — kod yazılmadı**
**Görev:** `MOBIL-YETKI-ENVANTERI.md` § "Ortak altyapı — tek seferlik iş"
**Talimat:** *"Tasarla, uygulama — önce bana sor."*

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

## 7. Kod yazılmadan önce beklenen cevaplar

1. **Karar 1** — tek aşama mı, iki aşama mı? *(öneri: tek aşama)*
2. **Karar 2** — personel belgesi: kapsam dışı / tek dosya / çok dosya?
3. **Karar 3** — yetim dosya temizliği bu turda mı? *(öneri: hayır)*
4. **Karar 4** — hangi iş önce? *(öneri: teslimat + DVIR fotoğrafı)*
5. **Karar 5** — hız sınırı? *(öneri: basit sınır)*
6. **§ 6/1** — modül bayraklarının canlı değeri nedir?

**Bu cevaplar gelmeden kod yazılmayacak.**
