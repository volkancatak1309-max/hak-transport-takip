# Runbook — Aksiyon Merkezi kart dili (dal `aksiyon-kart-dili`)

**Durum (03.10.2026):** kod dalda, main'e alınmadı, **dağıtılmadı**. Dağıtım Volkan'ın onayından
sonra. Migration YOK — veritabanında çalıştırılacak bir şey yok.

## Kusur

Mobil Aksiyon Merkezi'nin "Bu hafta" kartları (ve panelde `/admin/haftalik`) başlık ile gerekçeyi
**sunucuda sabit Türkçe şablonla** üretilmiş metin olarak gösteriyordu
(`haftalik_aksiyonlar.baslik` / `.gerekce`, migration 084). Uygulamayı İngilizce ya da Almanca
kullanan yönetici kartı Türkçe görüyordu — Apple incelemecisi dahil (2.1 cevabında açıklandı).
Almanca kiracıda (Sendigo) bile kartlar Türkçeydi. Kanıt şeridinin birimi ("gün", "saat", "puan")
de Türkçe ham geliyordu.

## Çözüm (migration gerekmedi)

Kart zaten yapısal veri taşıyor: `kural` (tür) + `kanit` (jsonb: ölçülen, eşik, birim, kurala özel
alanlar) + özne kimliği. Metin **okuma anında**, okurun dilinde, mevcut i18n sözlüğüyle kurulur.

| Parça | Dosya |
|---|---|
| Saf metin kurucu (9 kural, EN/DE/TR, geri düşüş) | `lib/haftalik-metin.ts` |
| Mobil isteğin dili: `?dil=` → `Accept-Language` ilk etiketi → kurulumun dili | `lib/istek-dili.ts` |
| Sözlük | `messages/{tr,de,en}.json` › `haftalikMetin` |
| Mobil uç (okurun dili, kök `dil` alanı, `kanit.birim` çevrili + `kanit.birimKodu` ham) | `app/api/mobile/haftalik/route.ts` |
| Panel (`/admin/haftalik`, kullanıcının panel dili) | `app/actions/haftalik-aksiyon.ts` |
| Üretici: kayıt metni **kurulumun dilinde** (Sendigo artık Almanca), `kanit.metinDili` yazılır; bildirimdeki ilk başlık da bu metinden | `lib/haftalik-aksiyon-db.ts` (`kiracininDilinde`) |
| Kurallar: özne adı + yeniden kurmak için eksik kanıt alanları (`esikYuzde`, `aciklama` 80 kr., `yasalDayanak`) | `lib/haftalik-aksiyon.ts` |

**Geriye dönük uyum:** `baslik`/`gerekce` kolonları aynen yazılmaya devam ediyor. Okurun dili
saklanan metnin diliyse (eski satırlarda `metinDili` yok → `tr`) metin **AYNEN** döner — Türkçe
kullanan yöneticide hiçbir şey değişmez. Başka dilde yeniden kurulamayan kart (ör. özne silinmiş)
saklanan metne düşer; kart asla boş çıkmaz.

**Eski kartlar için geçiş:** gerekmiyor. Dokuz kuralın hepsi eski satırdan da kuruluyor (yakıtta
eşik yüzdesi eşik/ortalamadan türetiliyor; iş emrinde alıntısız cümle; saklamada dayanaksız çıpa
cümlesi). Yeni satırlar ek alanlarla tam metni taşır.

## Ölçüm (yerel)

- `npm run lint:haftalik-metin` (zincirde): gerçek kural fonksiyonları + gerçek sözlük; 9 kural ×
  EN/DE kuruluyor, Türkçe kalmıyor, TR okurda metin aynen, eski satır, geri düşüş, birim, çoğul —
  **95/95**.
- `npm run verify:haftalik-dil` (kuru koşum, gerçek `GET /api/mobile/haftalik`): şirket dili TR iken
  `Accept-Language: en` → İngilizce, `de` → Almanca, başlıksız → Türkçe aynen, `?dil=en` kazanır,
  `fr` → şirket dili; üretici şirket dili DE iken Almanca yazıyor — **17/17**.

## Mobil (değiştirilmedi — yapılacaklar listesi)

1. `lib/api.ts` → `apiRequest`: başlıklara `'accept-language': i18n.language` ekle. Bu yapılmadan:
   - **Android**: React Native başlığı kendiliğinden göndermez → kartlar kurulumun dilinde kalır.
   - **iOS**: sistemin ağ katmanı `Accept-Language`ı cihaz diline ve uygulamanın desteklediği
     dillere (app.json `locales` tr/de/en) göre kendiliğinden ekliyor olmalı — **ÖLÇÜLMEDİ**;
     uygulama içi dil seçimi (Menü › Ayarlar › Dil) bu başlığa yansımaz.
2. `lib/haftalik-api.ts` başındaki "🔴 baslik ve gerekce SUNUCUDA ÜRETİLİYOR — TÜRKÇE" notu
   güncellenmeli (artık okurun dilinde).
3. İsteğe bağlı: kök `dil` alanı ekranda gösterilmiyor; gerek yok.

## Dağıtım (onaydan sonra)

1. `aksiyon-kart-dili` → main (PR + birleştirme). Vercel üç projeyi (galzura-demo, hak-transport-takip
   = HAK61, sendigo) main'den kendisi dağıtır; env değişikliği yok.
2. Doğrulama (her kiracıda, salt okuma): panelde `/admin/haftalik` dil İngilizceyken kart İngilizce;
   mobil Aksiyon Merkezi "Bu hafta" kartı iPhone'da cihaz dili İngilizceyken İngilizce
   (Android'de mobil madde 1'e kadar kurulumun dili).
3. Geri alma: birleştirme commit'ini geri al (veritabanı değişmedi; yeni satırların `kanit`'inde
   fazladan alanlar kalır, eski kod onları okumaz).

## Kapsam dışı (bilerek)

- `/admin/haftalik` tarama satırlarının eşik yazıları (`haftalik_aksiyon_turlari.tarama` içinde
  Türkçe, ör. "bakım anı geçti") — yalnız panelin teşhis bölümü, Aksiyon Merkezi kartı değil.
- Diğer mobil uçlardaki kurulum dili etiketleri (`lib/mobile-labels.ts`: filo etiketi; pano DTC
  açıklaması; izin türü etiketi) — aynı desen, aynı `istekDili` ile ayrıca ele alınabilir.
