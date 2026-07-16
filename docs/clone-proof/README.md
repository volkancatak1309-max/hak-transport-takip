# Klon Kanıtı — Alarmlar + Yönetici

Bu klasör, `docs/REVEAL-CLONE-SPEC.md`'de bölge bölge çıkarılan ölçülerin
uygulanmış hâlinin kanıtıdır. Kanıt **yazılı**; görseller repoya girmiyor —
nedeni aşağıda.

## Görseller neden repoda değil

Bu repo **public**. İki ayrı engel var, ikisi de tek başına yeterli:

1. **Telif** — referans görüntüler Verizon Connect Reveal'ın ürün arayüzü.
   Verizon'un telifli ekranlarını public bir repoya koymak doğru değil.
2. **Gizlilik** — kendi ekran görüntülerimizde gerçek şoför adı ve plaka var
   (yan panel kullanıcı adı, `ÇALIŞAN` ve `PLAKA` kolonları, "Dikkat/Aksiyon"
   satırları). Blur denendi ve **sızdırdı**: isim kolonu bulanıklaştı ama PLAKA
   kolonu — içinde gerçek kimlik taşıyanlar da vardı — açıkta kaldı. Git geçmişi
   kalıcı; tek kaçan seçici kalıcı sızıntı demek. Seçici kovalamak yerine
   görselleri hiç koymuyoruz.

**Görseller yerelde, Volkan'ın makinesinde** (oturum scratchpad'i):

```
…\scratchpad\clone-proof\pair-alerts.png       ← Reveal | bizim — Alarmlar, aynı kare
…\scratchpad\clone-proof\pair-dashboard.png    ← Reveal | bizim — Yönetici, aynı kare
…\scratchpad\shots\clone-alarm-overview.png
…\scratchpad\shots\clone-alarm-drill.png       ← tile → log drill
…\scratchpad\shots\clone-alarm-log.png
…\scratchpad\shots\clone-dash.png              ← veri dolu aralık
…\scratchpad\shots\clone-dash-empty.png        ← boş aralık (tile'lar duruyor)
```

Tam kök: `%LOCALAPPDATA%\Temp\claude\C--Users-90553-Desktop-business-hak-transport-takip\c3941a1d-8a4c-4960-9cb0-fcca52d5b418\scratchpad\`

Canlı hâli preview URL'inde zaten görünüyor (auth arkasında).

## A — Alarmlar (`/admin/alarmlar`)

| Bölge | Reveal | Bizim | Durum |
|---|---|---|---|
| A1 alt sekme | Overview · Alert log · My alerts | Genel Bakış · Alarm Kaydı | Uyarlandı — "My alerts" yok, kişisel alarm aboneliği ürünümüzde yok |
| A2 başlık | ~28px semibold + açıklama + CREATE ALERT | ~28px semibold + açıklama | Uyarlandı — CREATE yok: alarmı cihaz üretir, kullanıcı tanımlamaz |
| A3 filtre | Tek satır, iki dropdown (Show alerts triggered · Sort by) | Tek satır, iki dropdown (Gösterilen · Sırala) | Birebir |
| A4 tile ızgara | 3 kolon, tile = olay tipi, son tetiklenme + sayaç + rozet | Aynı | Birebir |
| A5 log | Tablo + basit dropdown filtreler | Araç · Olay tipi · Şiddet, hepsi "Tümü" varsayılan | Birebir |

Uyarlanan üç kalem ürün farkı, stil tercihi değil — Reveal alarm **tanımlama**
ürünü, biz cihazın bildirdiğini **gösteriyoruz**.

### REJECTION-1'deki dört hata — Playwright ile doğrulandı

1. **"Tümü" yok** → üç log filtresi de `Tümü` varsayılanıyla açılıyor
   (`["Araç | Tümü", "Olay tipi | Tümü", "Şiddet | Tümü"]`).
2. **Mükerrer "Şiddet"** → silindi; `label` sayımı tam üç: Araç, Olay tipi, Şiddet.
3. **Kart tıklanınca bir şey olmuyor** → tile tıklaması Alarm Kaydı sekmesine
   geçiyor, Olay tipi'ni set ediyor, tablo **50 → 37** satıra iniyor.
4. **Tip drill yok** → aynı mekanizma; her tile kendi tipine filtreliyor.

Konsol: **0 hata**.

## B — Yönetici (`/admin`)

| Bölge | Reveal | Bizim | Durum |
|---|---|---|---|
| B2 ızgara | 6 tile, 3×2 | 6 tile, 3×2 (Saat · KM · Puan · Teslim · AZG · Tamamlanan) | Birebir |
| Tile gövde | Yatay bar leaderboard | Aynı — etiket 78px sağa dayalı + bar h3.5 + değer 62px tabular-nums | Birebir |
| Tile yüksekliği | Sabit | `h-[230px]` — satır sayısı değişse de ızgara zıplamaz | Birebir |
| Alt scope | `border-t` + gri scope şeridi | Aynı ("Şoför · <aralık>") | Birebir |
| Renk | Reveal yeşil/kırmızı | Bizim palet: sky / puan eşikli gold / AZG kritik | Bilinçli sapma — palet bizim |

### Boş-aralık düzeltmesi

`{perf.length > 0 && …}` kapısı **tüm** ızgarayı gizliyordu: veri olmayan bir
aralıkta sayfa başlıktan doğrudan "Bugünün Operasyon Özeti"ne atlıyor, vitrin
kayboluyordu. Reveal ızgarasını hiç gizlemez. Kapı kaldırıldı; `RankingTile`
zaten `rows=[]` için ortalanmış `emptyLabel` render ediyor.

Doğrulama — aynı sayfa, iki aralık:

- `?range=today` (veri yok) → 6 tile duruyor, 6 × "Veri yok", ızgara sağlam.
- `?range=custom&from=2026-06-01&to=2026-06-30` → 6 tile, her biri 5 bar satırı.

Konsol: **0 hata**.

## Yöntem

Ölçüler ekrandan çıkarıldı, uydurulmadı — bkz. `docs/REVEAL-CLONE-SPEC.md`.
Doğrulama Playwright ile canlı DOM üzerinden (sayım + tıklama + konsol), göz
kararıyla değil. Yan yana kareler `scratchpad/compose.mjs` ile üretildi.
