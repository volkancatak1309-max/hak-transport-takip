# Mobil Uç Tur 1 — Kendi PIN'i + Vardiya başlatma/düzeltme

**Tarih:** 03.09.2026 · **Dal:** `feat/mobil-uc-1` · **Durum:** ✅ **CANLIDA KANITLANDI** (galzura-demo)
**Kapsam:** `MOBIL-YETKI-ENVANTERI.md` maddeleri **#3/#4/#5** (kendi PIN'i) ve **#6/#7** (vardiya başlatma + düzeltme)
**Karar (Volkan):** Panel ve mobil aynı işlevsellikte, aynı güçte.

---

## 0. Bir cümlede

Dört yeni uç açıldı; **hiçbiri panelin kuralını kopyalamadı** — panelin beş
eylemi ortak çekirdeklere indirildi ve iki taraf da aynı gövdeyi çağırıyor.

| Uç | Panelde karşılığı | Kapı |
|---|---|---|
| `POST /api/mobile/me/pin` | `changePinAction` (+ mevcut PIN kapısı, yeni) | herkes, kendisi için |
| `POST /api/mobile/shifts/start` | `startShiftManualAction` | şoför (yönetici muafiyetli) |
| `POST /api/mobile/shifts/start-for` | `startShiftForWorkerAction` | patron VEYA filo şefi |
| `PATCH /api/mobile/shifts/[id]` | `editEntryAction` · `adminUpdateKmAction` · `adminCloseShiftAction` | yalnız patron |

---

## 1. Ne yapıldı — dosya dosya

### Yeni çekirdekler (panel + mobil ORTAK)

| Dosya | Neyi taşıdı | Kim çağırıyor |
|---|---|---|
| `lib/manual-start-scope.ts` | `requireManualStartAuth`ın **kural gövdesi** | `lib/session.ts` (panel) + `lib/mobile-scope.ts` (mobil) |
| `lib/shift-start.ts` | `startShiftManualAction` + `startShiftForWorkerAction` gövdeleri | `app/actions/shift.ts` + iki mobil uç |
| `lib/shift-correct.ts` | `editEntryAction` + `adminUpdateKmAction` + `adminCloseShiftAction` gövdeleri | `app/actions/shift.ts` + `PATCH` ucu |
| `lib/auth-core.ts` → `verifyOwnPin` | mevcut PIN kapısı, **girişin kilit sayacıyla** | `lib/worker-account-db.ts` |
| `lib/worker-account-db.ts` → `changeOwnPin` | kendi PIN'ini değiştirme | PIN ucu |

Panelin action'ları **ince kabuk** oldu: kapı + çekirdek çağrısı +
`revalidatePath`. `lib/shift-end.ts`in 22.08.2026'da kapanış için yaptığının
aynısı.

**Panel sözleşmesi DEĞİŞMEDİ.** Hata dizgeleri (`no_vehicle`, `active`,
`day_done`, `outside_depot`, `km_low:…`, `errReasonShort`, ham DB mesajı) ve
`reopened` bayrağı aynen dönüyor — `PanelClient`ın hata eşlemesi olduğu gibi
çalışıyor.

---

## 2. GÖREV 1 — Kendi PIN'ini değiştirme

### 2.1 🔴 Bu uç neyi ÇÖZMÜYOR

Görev metni şöyle diyordu: *"PIN'ini unutan kullanıcı tanımı gereği panele de
giremez, kısır döngü."*

**Bu uç o döngüyü kırmıyor ve kıramaz.** PIN'ini unutan kişinin geçerli bir
token'ı da yoktur (giriş yapamaz), dolayısıyla bu uca da erişemez. Mevcut PIN'i
sormayan bir uç ise çalınmış bir telefonun asıl sahibi kilitlemesine izin
verirdi.

**Çözdüğü iki şey var ve ikisi de bugün kırıktı:**

1. PIN'ini **bilen** kullanıcı onu telefondan değiştiremiyordu
   (`app/(auth)/change-pin.tsx`: *"Bu ekran yakında"*).
2. `must_change_pin=true` ile gelen kullanıcı — yönetici geçici PIN atadı —
   zorunlu değişimi uygulamada **tamamlayamıyordu**; "Şimdilik devam et" ile
   geçiştiriliyordu.

**Unutan kişinin kurtarma yolu değişmedi:** yönetici PIN sıfırlar
(`POST /api/mobile/workers/[id]/pin` ya da panelde "PIN Belirle"). Öyle de
kalmalı — unutulmuş bir PIN'i sıfırlayan girişsiz bir yol, hesabın kendisini
girişsiz yapardı.

### 2.2 🔴 Yanlış mevcut PIN → kilit merdivenine YAZILIR

**Karar: EVET, giriş ile TAM TUTARLI.** Aynı tablo (`login_attempts`), aynı
satır (`identifier = ip|kanonik telefon`), aynı eşik (10 deneme), aynı merdiven
(15 sn → 60 sn → 5 dk → 15 dk → 1 sa).

**Neden:** ayrı bir sayaç kursaydık — ya da hiç saymasaydık — çalınmış bir
access token **sınırsız PIN denemesi** yapabilen bir sözlük saldırısı aracına
dönerdi. Giriş ekranı 10 denemede kilitlenirken bu uç sonsuza kadar cevap
verirdi. Yani token hırsızlığı, PIN hırsızlığına yükseltilebilirdi.

Bunu yapısal kılmak için `verifyOwnPin` `lib/auth-core.ts` **içinde** yaşıyor:
`registerFailure` / `failureResult` / `clearFailures` o dosyada dışa
aktarılmamış yardımcılar ve öyle kalıyorlar. Dışarı açılan her yardımcı,
ileride başka bir yerde **yarım bir merdiven** kurulmasının davetidir.

Doğru mevcut PIN sayacı **sıfırlar** — girişin başarı davranışıyla aynı.

**Ölçüldü** (`verify-mobil-uc-1.mjs` P3–P5):

```
✓ P3 yanlış mevcut PIN → 403          ✓ P3 login_attempts'e YAZILDI (1 upsert)
✓ P3 sayaç İLERLEDİ (3 → 4)           ✓ P3 kilit kimliği: 203.0.113.7|+43660111
✓ P4 kilitliyken → 429 + Retry-After=45
✓ P5 doğru mevcut PIN sayacı SIFIRLADI (1 delete)
```

### 2.3 🔴 Yanlış PIN **403** döner, 401 DEĞİL

Bu ucun sözlüğünde **401 yalnız "token geçersiz"** demek (ortak kapı) ve mobil
istemciler 401'de oturumu düşürür. Yanlış yazılmış bir mevcut PIN'e 401 demek,
kullanıcıyı **bir yazım hatası yüzünden uygulamadan atardı**.

`403` = "kimliğin geçerli, bu isteği yapamazsın" — doğru cümle budur.
Muhafız M4 bunu denetliyor; 401'e çevirmeyi deneyen bir değişiklik `npm run
verify`i kırar.

### 2.4 🔴 PIN değişince diğer cihazlar — `token_version` ARTAR

**Karar: EVET artmalı, AMA çağıran cihaz düşmemeli.**

`bumpTokenVersion` çağrılıyor (panelin `changePinAction`ı da çağırıyor): o
kişinin **tüm** mobil anahtarları ölür. Gerekçe: PIN'i ele geçirilmiş
kullanıcının ikinci cihazı düşürmesinin tek yolu bu.

Ama iptal **çağıran cihazı da** kapsıyor. Uç bu yüzden yeni sürümle mühürlenmiş
**yeni bir token çifti döndürüyor**. Aksi hâlde kullanıcı PIN'ini değiştirir
değiştirmez kendi telefonundan atılırdı — "değiştirdim, sonra çıkış yaptım"
gibi görünen bu davranışın güvenlik kazancı yok (yeni PIN'le hemen tekrar
girerdi), yalnız güveni bozardı.

**İstemci yanıttaki `accessToken`/`refreshToken` ile eskileri DEĞİŞTİRMELİ.**

Migration 044 yoksa `tokenIptal:false` döner ve bunu açıkça söyler — sessizce
"iptal edildi" demek, yapılmamış bir iptali yapılmış göstermek olurdu.
**Ölçüldü:** 044 **ÜÇ KİRACIDA DA var** (`token_version` kolonu). galzura-demo'da
iptalin gerçekten işlediği canlı koşumda görüldü: `token_version` 13 → 17
(§ 4.5).

**Tarayıcı oturumu etkilenmez** — ayrı yol (iron-session çerezi). Panelde açık
bir oturum varsa devam eder; kullanıcı yeniden giriş yapınca yeni PIN geçerli
olur.

### 2.5 Doğrulama kuralları — panelle TEK KAYNAK

| Alan | Şema | Neden |
|---|---|---|
| **mevcut PIN** | `loginPinSchema` (4–6 hane) | Kullanıcının BUGÜNKÜ PIN'i eski 4 haneli olabilir. Katı şemayı buraya uygulamak, tam da yeni PIN'e geçmek isteyen kullanıcıyı kapıda çevirirdi. **Ölçüldü** (P9): 4 haneli mevcut PIN kabul ediliyor. |
| **yeni PIN** | `changePinSchema` → `pinSchema` (6 hane + zayıf değil) + `pin_confirm` eşleşmesi | Panelin `/pin` ekranıyla **birebir aynı şema**. `adminSetPinSchema` DEĞİL: 123456 istisnası yalnız yöneticinin atadığı geçici PIN içindir. **Ölçüldü** (P5): 123456 → `errPinWeak`. |
| **aynı PIN** | düz karşılaştırma | Panelde `bcrypt.compare(yeni, mevcutHash)` ile ölçülüyor çünkü orada mevcut PIN BİLİNMİYOR. Burada biliniyor (kullanıcı yazdı ve doğrulandı) → aynı sonuç, bir bcrypt turu az. |

`yeniPinTekrar` **zorunlu**: eşleşme denetimi `changePinSchema`da, yani panelle
tek kural. İstemcinin kendi ekranında iki kutu göstermesi yeterli sayılmadı —
sunucu son sözü söyler.

### 2.6 Gövde sözleşmesi

```jsonc
// POST /api/mobile/me/pin
{ "mevcutPin": "418302", "yeniPin": "740193", "yeniPinTekrar": "740193" }

// 200
{ "ok": true, "mustChangePin": false, "tokenIptal": true,
  "accessToken": "…", "refreshToken": "…", "expiresIn": 900,
  "panelTazelendi": true }
```

| Kod | Hata | Anlamı |
|---|---|---|
| 401 | `missing_token` `invalid_token` `revoked` `inactive` | ortak kapı |
| 400 | `invalid_json` · `missing_fields` · `mevcut_pin_gecersiz` | |
| 400 | `yeni_pin_gecersiz` + `sebep`: `errPin` \| `errPinWeak` \| `errPinMismatch` | |
| 400 | `ayni_pin` | |
| **403** | `mevcut_pin_hatali` | **401 değil** — § 2.3 |
| 404 | `not_found` | |
| **429** | `kilitli` + `Retry-After` | giriş ucuyla aynı biçim |
| 503 | `db_error` | |

PIN yanıtta **dönmez** (kardeş uçla aynı karar). **Ölçüldü** (P8): yanıt
gövdesinde yeni PIN dizesi geçmiyor.

---

## 3. GÖREV 2 — Vardiya başlatma + düzeltme

### 3.1 Panelin mantığı AYNEN taşındı — kopyalanmadı

`lib/shift-start.ts` ve `lib/shift-correct.ts` panelin gövdelerini **satır
satır** aldı. Taşınırken korunan ve her biri bir VAKA'nın sonucu olan kurallar:

- çift açık vardiya guard'ı + `uq_time_entries_one_open` **23505 yakalama**
  ("zaten aktif", hata değil)
- **GÜNDE TEK VARDİYA** → yeni satır DEĞİL, o günün satırını **yeniden aç**
  (22.07.2026)
- `SHIFT_PER_DAY='many'` kiracısında bu dal **ATLANIR** — orada yeniden açma
  birinci vardiyayı **siliyordu** (14.08.2026, Sendigo canlı vakası)
- **depo kapısı yalnız YENİ vardiyada**, yeniden açmada değil
- `started_at` "şimdi" DEĞİL: depo girişi → 14 günlük ortalama → now
- `location_unverified` / `start_time_estimated` ayrımı (038)
- migration 037 öncesi `started_by`/`start_source` **kolonsuz geri düşüş**
- düzeltmede: **sebep zorunlu** (087), `logShiftEdit` izi, paket matematiği
  (teslim = alınan − geri getirilen), `checkUndelivered` tavanı,
  plaka→`vehicle_id` senkronu, sefer paket köprüsü

**Taşımanın davranış-eşdeğerliği ölçüldü.** `verify-reopen-payload.mjs` yeniden
açma yükünü **kaynaktan** çıkarıyor; taşımadan sonra da aynı anahtar kümesini
üretiyor:

```
ortak (reopenClearFields): ended_at, end_km, end_reason, auto_ended,
  summary_notified_at, summary_confirmed_at, summary_confirmed_by,
  undelivered_count, updated_at, updated_by
şoför yolu özgü          : vehicle_id, plate                  → 12 anahtar
yönetici yolu özgü       : started_at, vehicle_id, plate      → 13 anahtar
```

Taşımadan önceki sayılarla **birebir aynı**. O betik `app/actions/shift.ts`
parse ediyordu ve refactor onu kırmıştı; `lib/shift-start.ts`e çevrildi ve
ortak fonksiyonu hesaba katacak şekilde güncellendi.

### 3.2 Üç uç, üç kapı

**`POST /shifts/start`** — gövde **`workerId` ALMAZ**. Açılan vardiya
token'daki kişinin vardiyasıdır; kapı bir kontrol satırıyla değil **isteğin
şekliyle** kapalı (kapanış ucundaki `current/end` ile aynı ilke). **Ölçüldü**
(S7): gövdeye `workerId` konsa bile yok sayılıyor, kendi vardiyası açılıyor.

Kapı: `requireMobileWorker` + kardeş uçların aynı cümlesi (041 muafiyeti) —
direksiyona geçmeyen yönetici `403 not_a_driver`.

**`POST /shifts/start-for`** — patron VEYA filo şefi. **Neden ayrı uç:** iki
eylemin yetkisi farklı. Tek uçta birleştirmek "workerId yoksa kendine, varsa
başkasına" gibi bir dal demekti ve o dalın bir gün yanlış tarafa düşmesi, bir
şoförün başkası adına vardiya açması olurdu. İki uç, iki kapı: yanlış tarafa
düşecek dal **yok**.

⚠️ `baslangic` alanı **tam ofsetli ISO** olmalı. `"2026-09-03T06:30"` gibi
ofsetsiz bir dize sunucunun kendi diliminde yorumlanır ve Viyana'da yazın
2 saat kayar.

**`PATCH /shifts/[id]`** — yalnız patron. Gövdedeki `islem` alanı hangi eylemin
çalışacağını söyler:

| `islem` | Panelde | İz kaynağı |
|---|---|---|
| `duzelt` | `editEntryAction` | `duzeltme` |
| `km` | `adminUpdateKmAction` | `km` |
| `kapat` | `adminCloseShiftAction` | `kapatma` |

**Neden `islem`, alan varlığı değil:** `kapat` işleminde `ended_at`
**istemciden gelmez** — sunucu onu aracın son telemetrisinden türetir. "ended_at
yoksa kapat demektir" diye karar veren bir uç, ilk eksik alanda yanlış işi
yapardı.

**Filo şefi 403 alır ve bu bir eksik değil, PARİTE:** panelde de üç eylem
`requireAdmin` ile korunuyor. Kapsamlı bir şef düzeltme yolu ayrı bir karardır
(yazma yetkisi + kapsam denetimi birlikte tasarlanmalı) ve **bu turda yok**.

**GET ile PATCH'in kapısı bilerek farklı:** aynı dosyadaki GET şoföre kendi
vardiyasını, şefe kapsamındakini gösteriyor. Okuma ile yazma farklı
yetkilerdir — şoför kendi vardiyasını **görür** ama **saatini değiştiremez**.

### 3.3 Kapsam dışına bir ek: düzeltme izi okuma

`GET /shifts/[id]` yanıtına **`duzeltmeIzi`** alanı eklendi (yalnız patronda;
şefte ve şoförde `null`).

Gerekçe: PATCH bu satırı değiştirebiliyorsa değişikliğin görünür olması aynı
yüzeyin parçası. Panelde düzeltme formunun yanında "Düzenleme geçmişi"
çekmecesi var (`getShiftEditsAction`, `requireAdmin`). İz olmadan mobil, kaydı
değiştirebilen ama kimin değiştirdiğini göremeyen bir yüzey olurdu.

`null` ile `[]` **farklı**: `null` = "yetkin yok", `[]` = "değişiklik yok".

> Bu, görevde sayılan üç ucun **dışında** kalan tek eklemedir; kaydediliyor ki
> kapsam kararı Volkan'da kalsın.

### 3.4 Gövde sözleşmeleri

```jsonc
// POST /api/mobile/shifts/start          — gövde İSTEĞE BAĞLI
{}                                 // atanmış araçla
{ "aracId": "<uuid>" }             // geçici araç

// 200
{ "ok": true,
  "vardiya": { "id": "<uuid>", "yenidenAcildi": false },
  "kiraci": { "aracSecimi": "assigned", "gunlukVardiya": "one" },
  "panelTazelendi": true }

// POST /api/mobile/shifts/start-for
{ "workerId": "<uuid>", "baslangic": "2026-09-03T06:30:00+02:00",
  "aracId": "<uuid>" }             // aracId opsiyonel

// 200 → ayrıca "kaynak": "admin" | "chief"  (start_source kolonuna yazılan iz)

// PATCH /api/mobile/shifts/[id]
{ "islem": "kapat", "sebep": "Şoför kapatmayı unuttu" }
{ "islem": "km", "baslangicKm": 1000, "bitisKm": 1120 }
{ "islem": "duzelt", "baslangic": "…", "bitis": "…",
  "baslangicKm": 1000, "bitisKm": 1120, "molaDk": 45,
  "paketAlinan": 50, "paketTeslimEdilemeyen": 8,
  "plaka": "W-1234", "notlar": "…",
  "sebep": "Mola süresi yanlış girilmiş" }
```

Hata kodlarının tam listesi her route dosyasının başındaki yorumda.

---

## 4. Kanıt

### 4.1 Standart doğrulama (CLAUDE.md § "Doğrulama")

| Adım | Sonuç |
|---|---|
| `npx tsc --noEmit` | **0 hata** |
| `npm run build` | **başarılı**, üç yeni rota çıktıda: `/api/mobile/me/pin`, `/api/mobile/shifts/start`, `/api/mobile/shifts/start-for` |
| 15 muhafız betiği | **14 yeşil**, `lint:test-filters` tek bulgu — **baseline'ın aynısı** (`lib/auto-shift.ts:825`, bu turla ilgisiz) |
| `lint:tenant-defaults` | yeşil — 66 varsayılan değişmedi |
| ESLint | **43 problem / 28 hata / 15 uyarı** — **baseline'ın aynısı** (koşum öncesi temiz ağaçta ölçüldü) |

Yeni eklenen dosyaların **hiçbiri** ESLint borcunu artırmadı: refactor sonrası
ölü kalan 9 import elle temizlendi (ölçüm: 43 → 52 → 43).

### 4.2 Muhafız — ve muhafızın kendisi

`npm run lint:mobil-uc-1` · **11 denetim** (M1–M11), `verify` zincirine eklendi.

Geçen bir muhafız kör bir muhafızdan ayırt edilemez. Her denetim için kaynağa
**gerçek bir regresyon enjekte edildi**, muhafız koşturuldu, değişiklik geri
alındı:

```
OK M1 … OK M11 — 11 yakalandı / 0 kaçırıldı
GERİ YAZMA: muhafız temiz ağaçta çıkış=0
```

Muhafız yazılırken **iki yanlış pozitif** yakalandı ve ikisi de daraltıldı:
- M7 önce `shifts/[id]` GET'ini işaretledi — orada aynı iki çağrı var ama
  **okuma kapsamı** için;
- sonra `listStartableVehiclesAction`ı işaretledi — o, diyaloğun **araç
  listesini** süzüyor, bir yetki kapısı değil.

Son hâli yalnız `isFleetWorker(` arıyor (hedef şoförün kapsamı) ve yalnız
başlatma yolundaki dört dosyada.

### 4.3 Davranış kanıtı — kuru koşum, 64 iddia

`npm run verify:mobil-uc-1` · **64/64 geçti**.

Dört ucun **gerçek route handler'ları**, gerçek çekirdekleri ve gerçek
şemalarıyla koşuyor; DB katmanı `scripts/supabase-mock.mjs` ile bir kayıt
cihazına çevriliyor (`scripts/ts-server-kuru.mjs`). Token'lar gerçek mühürle
üretiliyor (`issueTokens`).

Ölçülen başlıklar:

```
PIN     P1–P9  : kapı, eksik alan, yanlış PIN + sayaç, kilit + Retry-After,
                 zayıf PIN, eşleşmeme, aynı PIN, başarılı yazma yükü,
                 token_version 7→8, yeni token, 4 haneli mevcut PIN
start   S1–S8  : not_a_driver, inactive_worker, no_vehicle, active,
                 vehicle_unavailable, insert yükü (auto_started=false,
                 confirmation_status=confirmed), gövde workerId yok sayılıyor,
                 yeniden açma (insert YOK, ended_at null)
start-for F1–F6: unauthorized, missing_fields, future_time, not_today,
                 not_a_driver, başarılı (started_at korundu, start_source=admin,
                 started_by=aktör)
PATCH   A1–A9  : admin_required (şef), gecersiz_islem, errReasonShort,
                 km_low, sebepsiz duzelt, kapat (ended_at + iz + sebep +
                 kaynak), no_active, duzelt (cargo_count 50−8=42),
                 paket tavanı (undelivered_over:12:10)
```

Harness yazılırken **iki gerçek kusur** ölçümle bulundu ve düzeltildi: senaryo
dal sırası (ortak kapının seçimi `changeOwnPin`inkiyle karışıyordu) ve
telemetri şeklinin dizi olması gerektiği.

**Emniyet:** yükleyici gerçek anahtarları process'e **hiç sokmuyor** (sahte
env) ve betik ilk satırda `supabaseAdmin.__MOCK__` bayrağını doğrulayıp yoksa
duruyor.

> **Bu ne ispatlar, ne ispatlamaz.** İspatlar: kodun karar akışı ve ürettiği
> yük. İspatlamaz: veritabanının o yükü kabul edeceği (kolon varlığı, CHECK,
> unique indeks). O ayrı ölçüldü → § 4.4.

### 4.4 Canlı zemin — SALT OKUMA

`npm run measure:mobil-uc1-zemin -- .env.local` (ve `.env.sendigo`)

Uçların dokunduğu her tablo/kolon, PostgREST'in OpenAPI tanımından okundu:

| Kiracı | `workers` (8) | `login_attempts` (4) | `time_entries` (27) | `vehicles` (5) | `shift_edit_log` (9) | `device_telemetry` (3) | EKSİK |
|---|---|---|---|---|---|---|---|
| **HAK61** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **0** |
| **Sendigo** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **0** |

`token_version` (044), `started_by`/`start_source` (037),
`location_unverified`/`start_time_estimated` (038), `reason`/`edit_group`/
`kaynak` (087) — **hepsi iki kiracıda da var**. Yani `503 tablo_yok` yoluna
düşmesi beklenen bir uç yok; kod yine de kolonsuz geri düşüşleri taşıyor
(panelden devraldı).

`login_attempts` gerçekten işliyor: HAK61'de **64 satır**, Sendigo'da **1**.

### 4.5 🔴 CANLIDA KANIT — galzura-demo, gerçek yazma

`ENV_FILE=.env.galzura-demo … scripts/verify-mobil-uc-1-canli.mjs` · **31/31 iddia geçti**

Dört ucun **gerçek route handler'ları**, **gerçek veritabanına** karşı koştu.
Betik iki emniyet taşıyor: şim devredeyse durur, ve proje referansı
`omgnkvoulndbglmxlvzc` (galzura-demo) değilse **çalışmayı reddeder** — HAK61 ve
Sendigo'da asla koşamaz.

**Test hesabı:** `+90123456789` ("TEST", `9b69ef0f…`), açık vardiyası
`fa1be738…` (04:02'de otomatik açılmış), atanmış aracı `W-GF-129`.

| Adım | Ölçüm |
|---|---|
| **Yanlış mevcut PIN** | `403 mevcut_pin_hatali` · `login_attempts` **9 → 10** · PIN değişmedi · `token_version` **15** sabit |
| **Doğru PIN → değişim** | `200` · hash artık `740193`'ü doğruluyor, **eski PIN geçersiz** · `token_version` **15 → 16** · `login_attempts` **10 → 9** (sıfırlandı) · yeni token `verifyMobileRequest`ten **geçti** (çağıran cihaz düşmedi) |
| **PIN geri alma** | `200` · hash yine `183434` · `token_version` **16 → 17** |
| **Açık vardiya varken başlat** | `409 active` · `time_entries` **527 → 527** (yazma yok) |
| **`islem=km`** | `200` · `start_km` **85177 → 85184** · `shift_edit_log` **4 → 5** · `updated_by`=yönetici · iz kaynağı `km` · **geri alındı → 85177** |
| **`islem=kapat`** | `200` · `ended_at`=`10:30:53Z` · `end_reason=admin` · `shift_edit_log` **6 → 8** (ended_at + end_km) · iz sebebi taşıyor |
| **Yeniden başlat** | `200` · `yenidenAcildi=true` · `time_entries` **527 → 527** (yeni satır YOK) · `ended_at` **null'a döndü** · `started_at` **04:02:18 korundu** · kapanış artıkları temizlendi |

**Kilit sayacının canlıda gerçekten işlediği** böyle ölçüldü: yanlış PIN satırı
yazdı, doğru PIN sildi. Kuru koşum bunu yükten çıkarıyordu; burada tablo sayıldı.

> ⚠️ **Ölçüm aracının kendisinde bir kusur çıktı ve düzeltildi.** İlk koşumda
> `login_attempts` sayımı `0 → 0` diyordu; sebep ürün değil betikti:
> `.or("id.not.is.null")` filtresi kullanılıyordu ve **o tabloda `id` kolonu
> yok** (anahtar `identifier`). PostgREST hatayı `error`da veriyor, `count` null
> kalıyor, `?? 0` onu "sıfır satır" gibi gösteriyordu. Filtre kaldırıldı, hata
> artık yutulmuyor — ikinci koşumda gerçek sayılar (9 → 10 → 9) çıktı.

**Kiracı bayrağı uyarısı:** koşum `SHIFT_PER_DAY=one` ile yapıldı (varsayılan).
galzura-demo'nun **canlı Vercel env değeri okunamıyor**. Dolaylı ölçüm
belirsiz: 527 vardiyada aynı şoför+aynı gün **3 çift satır** var (kural
öncesinden kalmış olabilir). `'many'` modda 7. adım yeniden açmaz, **yeni satır**
açar.

**Bırakılanlar / geri alınanlar:**

| | Başlangıç | Son | |
|---|---|---|---|
| `pin_hash` | `183434` | **`183434`** | ✅ geri alındı |
| açık vardiya | `fa1be738` açık, `start_km` 85177 | **aynı**, `started_at` korundu | ✅ geri alındı |
| `time_entries` | 527 | **527** | ✅ satır eklenmedi |
| `shift_edit_log` | 0 | **0** | ✅ 8 QA satırı silindi |
| `login_attempts` | 9 | **9** | ✅ |
| `workers.token_version` | 13 | **17** | ⚠️ **geri alınamaz** — dört PIN değişimi (iki koşum). Geri çekmek iptal edilmiş token'ları CANLANDIRIRDI. Etkisi: bu test hesabının eski mobil oturumları düştü. |
| `updated_at` / `updated_by` | — | yeniden açma damgası | ⚠️ kalıcı |

🔴 **`shift_edit_log` satırları neden silindi:** tablo koşum öncesi **boştu**,
yani 8 satırın tamamı testin artığıydı — gerçek bir operasyonel düzeltmenin izi
değil. Bırakılsalardı demo kiracıda o vardiya "elle düzeltilmiş" rozeti
taşırdı. Gerçek bir izi silmek denetim kaydını anlamsız kılardı; burada
silinen, kaydın kendisi değil test gürültüsüydü.

---

---

## 5. Bilinçli kararlar — özet

| Karar | Neden |
|---|---|
| Mevcut PIN kapısı **girişin** sayacında | ayrı sayaç = token hırsızlığından PIN hırsızlığına yükseltme yolu |
| Yanlış PIN **403**, 401 değil | 401 mobil istemciyi oturumdan atar; yazım hatası kullanıcıyı uygulamadan atmamalı |
| `token_version` artar **ama** yeni token verilir | diğer cihazlar düşsün, çağıran cihaz düşmesin |
| Mevcut PIN'de **gevşek** şema, yenisinde **katı** | eski 4 haneli PIN'li kullanıcı kapıda kalmasın |
| `/start` gövdesi kimlik almaz | kapı isteğin şekliyle kapalı, kontrol satırıyla değil |
| `/start-for` ayrı uç | tek uçta birleşen dal bir gün yanlış tarafa düşer |
| PATCH'te `islem` alanı | `kapat`ta `ended_at` istemciden gelmez; alan varlığından karar verilemez |
| PATCH yalnız patron | panel paritesi; şef yolu kapsam denetimiyle birlikte ayrı tasarlanmalı |
| `revalidatePath` çekirdek DIŞINDA | panelde çıplak, mobil uçta try/catch — birleştirmek panelin davranışını değiştirirdi |

---

## 6. Açık kalanlar

| # | Konu | Durum |
|---|---|---|
| 1 | **galzura-demo şema ölçümü** | ✅ **KAPANDI** (03.09) — service anahtarı verildi, ölçüldü: **6 tablo / 56 kolon, 0 eksik**. Üç kiracı da hizada. |
| 2 | **Canlı YAZMA kanıtı** | ✅ **KAPANDI** (03.09) — galzura-demo'da **31/31 iddia**, gerçek PIN değişimi + km düzeltme + kapatma + yeniden açma. Bkz. § 4.5. HAK61 ve Sendigo'ya **dokunulmadı**. |
| 3 | **Hız sınırı (rate limit)** | Yok — kardeş yazma uçlarıyla aynı durum. PIN ucunda kilit merdiveni fiilen bir sınır işlevi görüyor; başlatma/düzeltme uçlarında sınır yok. |
| 4 | **Şef için düzeltme yolu** | Kapsam dışı bırakıldı — panelde de yok. Açılacaksa kapsam denetimiyle birlikte tasarlanmalı. |
| 5 | **`deleteEntryAction` (vardiya silme)** | Mobil ucu **yok**. Görevde sayılan beş eylemin dışındaydı; kasıtlı olarak açılmadı. |
| 6 | **Panel `/pin` ekranı** | Mevcut PIN sormuyor (zorunlu değişim akışı). Mobil artık soruyor. **Ayrışma değil, farklı akış** — ama Volkan isterse panel de mevcut PIN soracak bir "PIN değiştir" ekranı kazanabilir. |
| 7 | **Mobil istemci işi** | Bu tur yalnız SUNUCU. `change-pin.tsx`, vardiya başlatma düğmesi ve düzeltme ekranı mobil CC'de. |

---

## 7. Kurulum dosyaları

**Yeni migration YOK.** Bu tur hiçbir tablo/kolon eklemiyor; var olan şemayı
kullanıyor. `lint:install-sql` yeşil (kurulum SQL'leri bayatlamadı).

Yeni kiracı bu uçları **kurulum dosyasındaki mevcut şemayla** doğrudan alır.
