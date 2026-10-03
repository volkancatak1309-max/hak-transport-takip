# AB Yapay Zekâ Yasası md. 50 — şeffaflık metni (TASLAK)

> ## ⚠️ AVUKAT ONAYI ŞART — YAYINLANMAZ
> Taslak. Uygulamaya (panel / mobil 1.5.0) avukat onayından sonra girer.

## Dayanak

- Tüzük (AB) 2024/1689 (AI Act), **md. 50(1)**: doğrudan gerçek kişilerle etkileşen yapay zekâ
  sistemleri, kişinin bir yapay zekâ sistemiyle etkileşimde olduğunu — bağlamdan açıkça belli
  değilse — bilmesini sağlayacak biçimde tasarlanır. Bilgi en geç **ilk etkileşimde**, açık ve
  ayırt edilebilir biçimde verilir (md. 50(5)).
- Uygulama tarihi: md. 50, **2 Ağustos 2026**'dan itibaren (md. 113) — avukat teyit edecek.
- **md. 50(2)** (sentetik ses çıktısının makine okunur işaretlenmesi) için yükümlünün kim olduğu
  (OpenAI mi, entegre sistemi sunan biz mi) **DOĞRULANACAK — avukat**.

## Metinler

### A) İlk kullanımdan önce (izin ekranı — tasarım §6.1; panelde ilk "Başlat"ta tek seferlik)

**TR**
> **Bir yapay zekâ asistanıyla konuşacaksınız.** Sesli asistan sorularınızı yapay zekâ ile
> cevaplar: sesiniz ve filonuza ait veriler (araçlar, sürücüler, vardiyalar, izinler dahil) cevap
> üretmek için OpenAI'a gönderilir. Ses kaydı saklanmaz. Cevaplar hatalı olabilir; önemli
> kararlardan önce ekrandaki veriyi kontrol edin. Ayrıntılar: Gizlilik politikası.
> [Kabul ediyorum] [Vazgeç]

**DE**
> **Sie sprechen gleich mit einem KI-Assistenten.** Der Sprachassistent beantwortet Ihre Fragen mit
> künstlicher Intelligenz: Ihre Stimme und Daten Ihrer Flotte (Fahrzeuge, Fahrer, Schichten,
> Abwesenheiten) werden dazu an OpenAI übermittelt. Es wird keine Audioaufnahme gespeichert.
> Antworten können fehlerhaft sein; prüfen Sie vor wichtigen Entscheidungen die Daten in der App.
> Details: Datenschutzerklärung.
> [Zustimmen] [Abbrechen]

**EN**
> **You are about to talk to an AI assistant.** The voice assistant answers your questions using
> artificial intelligence: your voice and data about your fleet (vehicles, drivers, shifts, leave)
> are sent to OpenAI to produce the answer. No audio recording is stored. Answers may be wrong;
> check the data in the app before important decisions. Details: Privacy policy.
> [I agree] [Cancel]

### B) Konuşma ekranında kalıcı etiket (her görüşmede görünür)

| Dil | Metin |
|---|---|
| TR | Yapay zekâ ile konuşuyorsunuz · cevaplar hatalı olabilir |
| DE | Sie sprechen mit einer KI · Antworten können fehlerhaft sein |
| EN | You are talking to an AI · answers may be wrong |

### C) Asistanın ilk cümlesi — GEREKMİYOR (öneri değil)

Ekranda kalıcı etiket varken ayrıca sesli duyuru md. 50(1) için gerekli görünmüyor; her görüşmede
konuşma süresini (ve maliyeti) uzatır. Avukat aksini isterse talimata tek cümle eklenir.

## Yerleşim

- **Panel** `/admin/asistan`: A, ilk "Başlat"ta modal; onay tarayıcıda değil sunucuda saklanmalı
  (tasarım §6.1 `asistan_onaylari` — migration 110'da YOK, 1.5.0 ile).
- **Mobil 1.5.0**: A izin ekranı (mikrofon izninden ÖNCE), B konuşma ekranının üstünde.
- Mağaza: Apple 5.1.2(i) — üçüncü tarafla veri paylaşımı için açık izin (tasarım §6.1).
