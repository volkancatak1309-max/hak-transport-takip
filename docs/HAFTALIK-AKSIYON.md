# Haftalık aksiyon paneli — "gölge filo müdürü"

**Migration 084 · `/admin/haftalik` · `/api/cron/haftalik-aksiyon`**

10–200 araçlık filoda tam zamanlı filo müdürü yok. Sistem her hafta **en fazla
5 YAPILACAK İŞ** çıkarır. Gösterge değil, iş. Kural tabanlı — yapay zeka yok,
her kalem hangi sayıdan hangi eşikten çıktığını ekranda söyler.

> Bu belge ölçümlerin kaydıdır. Sayılar 25.08.2026'da HAK61 canlı verisinde
> ölçüldü; eşik değiştirmeden önce yeniden ölçün.

---

## 1 · Hangi sinyaller elimizde (ÖLÇÜLDÜ)

Yedi kural yazıldı. Seçim ölçüme dayanıyor: *"veri var mı, kaç özne üretiyor,
haftalık mı değişiyor"*.

| Kural | Kaynak | HAK61'de veri | Neden bu kural var |
|---|---|---|---|
| `belge_bitiyor` | `worker_documents` (078) | var | Süresi dolan belge = yola çıkamayan şoför. Geri dönüşü randevu süresi kadar. |
| `bakim_gecikti` | `bakim_planlari` (081) | var | Geçmiş bakım arıza üretir; iş emrinden pahalıdır. |
| `is_emri_bekliyor` | `vehicle_fault_reports` (081) | var | Açık iş emri kendi kendine kapanmaz. |
| `sessiz_arac` | `device_telemetry` | var — 8/33 cihaz sessiz ölçüldü (Ağustos) | Sinyalsiz araç = ölçülemeyen araç; km, skor, rölanti hepsi düşer. |
| `skor_dususu` | `surucu_skorlari` | var ama seyrek | Kişi ekseninde davranış değişimi. |
| `yakit_sapmasi` | `fuel_events` + km | **22/29 araç 30 günde ölçülebilir** | Filo ortalamasına göre sapan araç = ya arıza ya alışkanlık. |
| `vardiya_kapanmadi` | `time_entries` | var | Filo GENELİ düzen kalemi; öznesi yok. |

**Kasten DIŞARIDA bırakılanlar:** hız/alarm sayıları (kademe değişiklikleri
yüzünden dönemler kıyaslanamıyor — bkz. `docs` cihaz eşikleri notu), rölanti
(epizod eşiği cihaz ayarından geliyor, filo dışı), izin takvimi (aksiyon değil
takvim).

---

## 2 · Eşik nasıl belirlendi (SABİT / FİLO-GÖRELİ ayrımı)

Üç seçenek vardı: sabit, filo-göreli, trend. **Üçü de kullanılıyor — sinyalin
tabiatına göre.** Kural: dış dünyanın dayattığı sınır sabittir, filoya özgü
"normal" görelidir.

| Kural | Eşik tipi | Değer | Gerekçe |
|---|---|---|---|
| `belge_bitiyor` | **sabit** | 30 gün | Randevu + evrak süresi. Filoya göre değişmez, mevzuata göre değişir. |
| `bakim_gecikti` | **sabit** | 0 (bakım anı geçti) | Plan zaten filoya özgü; ikinci bir eşik gereksiz. Yaklaşan bakım Dikkat panosunda. |
| `is_emri_bekliyor` | **sabit** | 7 gün | Bir haftadır açık emir "unutulmuş" sayılır. |
| `sessiz_arac` | **sabit** | 72 saat | Dikkat panosu 24 saatte *bakmanı* söylüyor; 3 gün "cihaza baktır" işidir. |
| `yakit_sapmasi` | **filo-göreli** | filo ort. **+%25**, 30 gün | Mutlak L/100km filo türüne bağlı. Ortalamanın kendisi ölçülüyor. |
| `skor_dususu` | **trend** | 2 pencere arası **−10 puan** | Skor mutlak değeri kalibrasyona bağlı (eşik 40→20 değişti); DEĞİŞİM daha sağlam. |
| `vardiya_kapanmadi` | **oran** | kapanmayan **>%5** | Tek vardiya gürültü, oran düzen sorunudur. |

### Zayıf örneklem kapıları

Filo-göreli eşik küçük paydada yalan söyler. İki kapı var ve ikisi de
`tarama` çıktısında görünür:

- `YAKIT_MIN_ARAC = 5` — ölçülebilir araç 5'ten azsa kural **çalışmaz**,
  `atlandi: "ölçülebilir araç N < 5"` yazar.
- `VARDIYA_MIN_ADET = 20` — 20 vardiyadan az olan haftada oran hesaplanmaz.

> 🔴 **"0 kalem" iki farklı şeydir.** *Eşiği geçen yok* ile *kural hiç
> çalışamadı* aynı şey değil. `tarama` alanı kural başına `{aday, gecen, esik}`
> ve gerekiyorsa `atlandi` taşır; panelin "Tarama" bölümü bunu aynen basar.

---

## 3 · Önceliklendirme

```
öncelik = TABAN(kural) + aciliyet + etki − kesinlik_cezası      (her biri 0..150)
```

**TABAN sınıfı belirler, eksenler sırayı.** Sınıf sırası ölçülebilir bir
iddiadır: *geri dönülemezlik*. Belge dolmuşsa şoför yola çıkamaz (800);
bakım geçmişse arıza riski birikir (700); iş emri bekliyor (680); araç
sessizse ölçüm kaybı büyür (600); skor düşüşü (500); yakıt sapması (400);
kapanmayan vardiya düzen sorunudur (300).

- `aciliyet` — ne kadar acele. Örn. iş emri yaşı × 4.
- `etki` — parasal/operasyonel büyüklük. Örn. bakım aşımı × 3, yakıt sapma yüzdesi.
- `kesinlik_cezası` — örneklem zayıfsa (`YAKIT_ZAYIF_ORNEKLEM`) öncelik düşer.
  **Belirsiz sinyal listenin başına geçemez.**

Öncelik `Math.round` ile **tam sayıdır** (kolon `integer`; canlı kuru koşumda
`467.05845…` çıktığı görüldü ve düzeltildi).

### Tavan ve çeşitlilik — SIRAYLA

`KURAL_BASINA_TAVAN = 2` **önce**, `HAFTALIK_TAVAN = 5` **sonra** uygulanır.
Sıra önemli: tersi olsaydı 5 sessiz araç tüm listeyi yer ve hafta tek konuya
kilitlenirdi. Elenen kalem sayısı panelde yazılır ("N kalem elendi") —
sessizce kırpılmaz.

---

## 4 · Dikkat panosuyla ilişkisi: KATMANLI, BİRLEŞİK DEĞİL

| | Dikkat panosu (`/admin`) | Haftalık aksiyon |
|---|---|---|
| Sorusu | **Bugün ne var?** | **Bu hafta ne yap?** |
| Ekseni | anlık durum, 19 tür | trend + filo-göreli, 7 kural |
| Ömrü | kendiliğinden düşer | tura yazılır, geçmişi kalır |
| Kapatma | `action_snoozes` — **erteleme** | `durum = yapildi | ilgisiz` — **karar** |

**`action_snoozes` bilerek genişletilmedi.** Modeli erteleme ("şimdi değil,
sonra"); haftalık modelin gerektirdiği şey karardır ("yaptım" / "bu bize
uymuyor"). İkisini tek tabloya sıkıştırmak, geçmişte "3 hafta önce ne demişti,
düzeldi mi" sorusunu cevaplanamaz hâle getirirdi.

**Aynı sinyal iki katmanda olabilir — eşik ve İŞ farklıdır.** Sessiz araç:
Dikkat 24 saatte *"bak"*, haftalık 72 saatte *"cihaza baktır"*. Çakışma değil,
tırmanma.

**Susturma ayrı tablo istemedi:** `durum='ilgisiz'` + `kapatildi_at`
`HAFTALIK_SUSTURMA_GUN = 28` gün boyunca aynı (kural, özne) çiftini eler.
"Yaptım" susturmaz — sorun sürüyorsa gelecek hafta tekrar sorulur.

---

## 5 · Üretim ve bildirim

- Zamanlayıcı: **Pazartesi 06:30**, haftada TAM 1 (`docs/CRON-KAYITLARI.md` §6).
- `hafta_basi` tekil; ikinci tetikleme `{"zatenVardi": true}` döner, hiçbir şey
  yazmaz, kapatılmış kalemler geri gelmez.
- Kuru koşum: `?kuru=1` — üretir, **yazmaz**, bildirmez.
- Bildirim yöneticilere + filo şeflerine gider (Expo push).

### Bildirim akıbeti ÜÇ DURUMLUDUR

| `bildirim_alici` | Panelde | Anlamı |
|---|---|---|
| `NULL` | "Bildirim denenmedi" | Turu zamanlayıcı DIŞI bir yol üretti; gönderim hiç çağrılmadı |
| `0` veya jeton `0` | "N yönetici — kayıtlı cihaz yok" | Denendi, alıcı var, kayıtlı cihaz yok |
| jeton `> 0` | "N yöneticiye · M cihaza" | Gitti |

> 🔴 İlk yazımda kolonlar `not null default 0` idi ve **denenmemiş** gönderim
> panelde **başarısız** gönderim gibi görünüyordu. QA'da yakalandı, DDL
> düzeltildi. HAK61'de bugün kayıtlı push jetonu **sıfır** — ölçüldü; panel
> bunu "gitti" diye göstermez.

---

## 6 · Prova (QA harness)

İki betik var; **ikisi de gerekli** ve `npm run verify` dışında elle koşulur
(yerel Docker yığını ister).

```bash
# Yığın: Docker Postgres 16 + PostgREST + proxy  (bkz. docs/TAKIP-LINKI.md §Prova)
docker exec -i hak-qa psql -U postgres -d hak -v ON_ERROR_STOP=1 -q < db/migrations/084_haftalik_aksiyon.sql
docker exec -i hak-qa psql -U postgres -d hak -c \
  "grant all on public.haftalik_aksiyon_turlari, public.haftalik_aksiyonlar to service_role;"
docker exec -i hak-qa psql -U postgres -d hak -v ON_ERROR_STOP=1 -q < <tohum>.sql

set -a; . <qa env>; set +a

# 1) MOTOR — saf katman, gerçek cron ucu, gerçek Expo, sunucu eylemleri, kapsam
npm run verify:haftalik-aksiyon

# 2) RENDER — üretim derlemesi, gerçek çerez, gerçek HTML
npm run build && npx next start -p 3300 &
npm run verify:haftalik-render
```

⚠️ `NEXT_PUBLIC_*` **derleme anında** gömülür: QA yığınına bakan bir
`next start` için QA env'iyle YENİDEN DERLEMEK şart.

⚠️ QA yığınında yeni tabloya `grant` gerekir — gerçek Supabase'de
`service_role` varsayılan ayrıcalıklarla gelir, Docker'da gelmez. Atlanırsa
cron `permission denied for table haftalik_aksiyon_turlari` ile **500** döner.

### Bu provanın yakaladığı gerçek kusurlar

1. **Öncelik tam sayı değildi** (`467.05845…`) — `integer` kolonuna yazılamazdı.
2. **Bildirim üçüncü durumu yoktu** — denenmemiş gönderim "cihaz yok" görünüyordu.
3. **Kanıt şeridi negatif sayı basıyordu** — "−65 ölçüldü · eşik 0 gün". Şeride
   artık AŞIM giriyor, ham "kalan" kanıtta duruyor.
4. **Kapsam iddiası boştaydı** — filo geneli kalem tavana giremediği için
   `||` sayesinde teknik olarak geçiyordu; kalem doğrudan yazılıp sınandı.
5. **İki iddia i18n sözlüğüne eşleşti** — sayfaya gömülü RSC yükünde tüm sözlük
   var; iddialar artık `<script>` blokları atılmış markup'a bakıyor.

---

## 7 · Kapsam (şef / yönetici)

- Yönetici: tüm kalemler.
- Filo şefi: **kendi filosundaki** özneli kalemler + **öznesi olmayan** filo
  geneli kalemler. Kapsam dışı kalemi göremez ve **kapatamaz**
  (`kapsam_disi`) — sunucu eyleminde kapı, istemcide değil.
