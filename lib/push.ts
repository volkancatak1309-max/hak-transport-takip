import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { getFleetScope, type FleetScope } from "@/lib/fleet-scope";
import { onizleme } from "@/lib/messaging";

/**
 * PUSH GÖNDERİMİ — Expo Push Service.
 *
 * ── NEDEN SUNUCUDAN ────────────────────────────────────────────────────────
 * Bildirimi tetikleyen olay burada oluyor: mesaj bu süreçte yazılıyor ve
 * alıcının kim olduğu ancak burada biliniyor. İstemci kendi kendine bildirim
 * üretemez — uygulama kapalıyken çalışan bir kod yok; kanalın güvenilmez
 * olmasının sebebi tam olarak buydu.
 *
 * ── NEDEN EXPO SERVİSİ, DOĞRUDAN FCM/APNs DEĞİL ────────────────────────────
 * Doğrudan gitmek iki ayrı protokol, iki ayrı kimlik doğrulama (FCM v1 OAuth
 * + APNs JWT) ve iki ayrı yeniden deneme mantığı demekti. Expo'nun ucu ikisini
 * tek gövdede topluyor ve jeton biçimi zaten `ExponentPushToken[...]`.
 * Sağlayıcı sırları EAS'te duruyor; BU SUNUCUDA hiçbir FCM/APNs anahtarı yok
 * — kasıtlı: panel sızsa bile bildirim altyapısı ele geçmez.
 *
 * ── HATA ASLA MESAJI DÜŞÜRMEZ ──────────────────────────────────────────────
 * Bu modüldeki hiçbir yol fırlatmıyor. Bildirim gönderilemezse mesaj YİNE DE
 * yazılmış olur ve uygulama açıldığında görünür. Tersi kabul edilemezdi:
 * Expo'nun ucu yavaşladığı için mesaj gönderiminin 500 dönmesi, çalışan bir
 * özelliği çalışmayan bir bağımlılığa bağlamak olurdu.
 */

const EXPO_UC = "https://exp.host/--/api/v2/push/send";

/** Expo'nun tek istekte kabul ettiği üst sınır. */
const PARTI = 100;

/**
 * Gönderim bir İSTEK YOLUNUN içinde duruyor; sınırsız beklemek kullanıcının
 * "Gönder"ine yansırdı. 8 sn: Expo normalde 1 sn altında yanıtlıyor.
 */
const ZAMAN_ASIMI_MS = 8000;

/** `app.json`'daki `defaultChannel` ve mobil `MESAJ_KANALI` ile AYNI olmak zorunda. */
const KANAL = "mesajlar";

type ExpoMesaj = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: "default";
  channelId: string;
  priority: "high";
};

type ExpoSonuc = {
  status?: string;
  details?: { error?: string };
};

/**
 * Alıcıların cihaz adresleri, SAHİBİYLE birlikte. Alıcı yoksa sorgu atılmaz.
 *
 * Sahip bilgisi duyuru yolunda şart: orada her alıcının bildirimi KENDİ
 * konuşmasını işaret ediyor, yani jetondan kişiye geri dönebilmek gerekiyor.
 * Tek konuşmalık yolda kullanılmıyor ama iki ayrı sorgu yazmak, aynı tabloya
 * iki farklı doğruluk kaynağı kurmak olurdu.
 */
async function jetonlariGetir(workerIds: string[]): Promise<{ token: string; workerId: string }[]> {
  if (workerIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("push_tokens")
    .select("token, worker_id")
    .in("worker_id", workerIds);
  if (error || !data) return [];
  return (data as { token: string; worker_id: string }[]).map((r) => ({
    token: r.token,
    workerId: r.worker_id,
  }));
}

/**
 * ÖLÜ JETONLARI SİL.
 *
 * Kullanıcı uygulamayı sildiğinde ya da bildirimleri kapattığında sunucuya
 * HİÇBİR haber gelmez; tek sinyal Expo'nun `DeviceNotRegistered` cevabıdır.
 * Silinmezse tablo ölü satırlarla büyür ve her mesajda boşa istek atılır.
 * SADECE bu hata koduna bakılıyor: geçici ağ hataları jetonu geçersiz yapmaz
 * ve onlara bakıp silmek, çalışan bir cihazı sessizce kanaldan düşürürdü.
 */
async function olenleriSil(tokenlar: string[]): Promise<void> {
  if (tokenlar.length === 0) return;
  await supabaseAdmin.from("push_tokens").delete().in("token", tokenlar);
}

async function partiGonder(parti: ExpoMesaj[]): Promise<void> {
  const kontrol = new AbortController();
  const saat = setTimeout(() => kontrol.abort(), ZAMAN_ASIMI_MS);
  try {
    const yanit = await fetch(EXPO_UC, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(parti),
      signal: kontrol.signal,
    });
    if (!yanit.ok) return;

    const govde = (await yanit.json()) as { data?: ExpoSonuc[] };
    const sonuclar = Array.isArray(govde.data) ? govde.data : [];

    // Sıra GARANTİLİ: Expo cevapları gönderilen dizinin sırasında döndürüyor.
    const olu: string[] = [];
    sonuclar.forEach((s, i) => {
      if (s?.status === "error" && s.details?.error === "DeviceNotRegistered") {
        const m = parti[i];
        if (m) olu.push(m.to);
      }
    });
    await olenleriSil(olu);
  } catch {
    // Zaman aşımı ya da ağ: bildirim düşmedi, mesaj yazıldı. Sessiz geçilir.
  } finally {
    clearTimeout(saat);
  }
}

/** Gövdeleri 100'lük partilere böler. */
async function gonder(mesajlar: ExpoMesaj[]): Promise<void> {
  for (let i = 0; i < mesajlar.length; i += PARTI) {
    await partiGonder(mesajlar.slice(i, i + PARTI));
  }
}

/**
 * BİREBİR KONUŞMADA YÖNETİM TARAFI kimler.
 *
 * ── PATRONLAR ──────────────────────────────────────────────────────────────
 * `erisimCoz` patrona HER konuşmayı açıyor; bildirimi de hepsi alır.
 *
 * ── ŞEFLER: KAPSAM SORULUYOR, VARSAYILMIYOR ────────────────────────────────
 * Şefe yalnız KENDİ filosundaki şoförün mesajı gider. "Bütün şeflere gönder"
 * demek, bildirim metninde şoförün ADINI ve mesajının ÖNİZLEMESİNİ kapsamı
 * dışındaki bir şefe göstermek olurdu — uygulamada 403 aldığı bir veriyi
 * kilit ekranında okurdu. Bildirim yüzeyi de bir yetki yüzeyidir.
 *
 * Kapsam sorgusu pahalı değil: filo sayısı ikiyle sınırlı (059) ve
 * `getFleetScope` istek başına önbellekli — en fazla iki ek sorgu.
 */
async function yonetimTarafi(soforId: string): Promise<string[]> {
  // test-visible: alıcılar YÖNETİM tarafı — patronlar ve kapsamdaki şefler.
  // Test hesabı da patron ve `erisimCoz` ona zaten HER konuşmayı açıyor;
  // bildirimin ona da gitmesi yeni bir şey sızdırmaz, mevcut yetkisini
  // tekrarlar. Elemek ise birebir push yolunu test hesabından DENENEMEZ
  // kılardı — `uyeleriDogrula`daki (lib/messaging-groups.ts) aynı tuzak:
  // otomatik dahil etme eler, ama burada dahil edilen kişi zaten yetkili.
  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("id, is_admin, managed_fleet")
    .eq("is_active", true);
  if (error || !data) return [];

  const satirlar = data as { id: string; is_admin: boolean; managed_fleet: string | null }[];
  const alicilar: string[] = [];
  const kapsamlar = new Map<string, FleetScope>();

  for (const w of satirlar) {
    // Kendi yazdığı mesaj kendine bildirilmez.
    if (w.id === soforId) continue;

    if (w.is_admin === true) {
      alicilar.push(w.id);
      continue;
    }

    const filo = w.managed_fleet;
    if (filo !== "bordo" && filo !== "mavi") continue;

    let kapsam = kapsamlar.get(filo);
    if (!kapsam) {
      kapsam = await getFleetScope(filo);
      kapsamlar.set(filo, kapsam);
    }
    if (kapsam.isFleetWorker(soforId)) alicilar.push(w.id);
  }

  return alicilar;
}

/** Gruptaki AKTİF üyeler (çıkarılmış olanlar hariç), gönderen dışında. */
async function grupUyeleri(konusmaId: string, gonderenId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("conversation_members")
    .select("worker_id")
    .eq("conversation_id", konusmaId)
    .is("left_at", null);
  if (error || !data) return [];
  return (data as { worker_id: string }[])
    .map((r) => r.worker_id)
    .filter((id) => id !== gonderenId);
}

export type BildirimGirdisi = {
  /** Mobil ile AYNI adres: grupta `konusmaId`, birebirde `soforId`. */
  adres: string;
  konusmaId: string;
  tur: "birebir" | "grup";
  /** Grubun adı; birebirde null. */
  grupAdi: string | null;
  /** Birebir konuşmanın sahibi şoför; grupta null. */
  soforId: string | null;
  gonderenId: string;
  gonderenAd: string;
  govde: string;
};

/**
 * MESAJ BİLDİRİMİ — alıcıları çözer, gövdeyi kurar, gönderir.
 *
 * ── BAŞLIK/GÖVDE KURGUSU (kapsam md. 4 ve 5) ───────────────────────────────
 * Birebir:  başlık = GÖNDEREN ADI,  gövde = mesaj önizlemesi
 * Grup:     başlık = GRUP ADI,      gövde = "Gönderen: mesaj"
 *
 * Grupta gönderen adı gövdeye giriyor, başlığa değil: kilit ekranında başlık
 * kırpılıyor ve "hangi grup" bilgisi "kim yazdı"dan önce geliyor — kullanıcı
 * önce hangi odaya bakacağına karar veriyor. WhatsApp ve Slack da bu sırada.
 *
 * ── `adres` NEDEN VERİDE ───────────────────────────────────────────────────
 * Mobil taraf iki şey için okuyor: dokunulunca doğru sohbeti açmak (md. 4) ve
 * o sohbet ZATEN AÇIKSA bildirimi bastırmak (md. 6). İkisi de aynı adresle
 * çalışıyor; ikinci bir kimlik göndermek iki tarafın eşleşmesini şansa
 * bırakırdı.
 *
 * ── ÖNİZLEME: `onizleme()` YENİDEN KULLANILIYOR ────────────────────────────
 * Liste satırındaki `last_message_preview` ile AYNI kırpma. İkinci bir kırpma
 * kuralı yazmak, bildirimde ve listede farklı uzunlukta iki metin üretirdi.
 */
export async function mesajBildir(g: BildirimGirdisi): Promise<void> {
  try {
    const alicilar =
      g.tur === "grup"
        ? await grupUyeleri(g.konusmaId, g.gonderenId)
        : g.soforId === g.gonderenId
          ? // Şoför kendi konuşmasına yazdı → yönetim tarafı okur.
            await yonetimTarafi(g.soforId)
          : // Yönetici şoförün konuşmasına yazdı → tek alıcı, o şoför.
            g.soforId
            ? [g.soforId]
            : [];

    if (alicilar.length === 0) return;

    const jetonlar = await jetonlariGetir(alicilar);
    if (jetonlar.length === 0) return;

    const kisa = onizleme(g.govde);
    const baslik = g.tur === "grup" ? (g.grupAdi ?? "Grup") : g.gonderenAd;
    const govde = g.tur === "grup" ? `${g.gonderenAd}: ${kisa}` : kisa;

    await gonder(
      jetonlar.map(({ token }) => ({
        to: token,
        title: baslik,
        body: govde,
        data: { adres: g.adres, konusmaId: g.konusmaId, tur: g.tur },
        sound: "default" as const,
        channelId: KANAL,
        // Mesaj kullanıcının BEKLEDİĞİ bir şey; Android'de normal öncelik
        // Doze modunda saatlerce gecikebiliyor.
        priority: "high" as const,
      }))
    );
  } catch {
    // Bildirim yolu mesajı ASLA düşürmez (modül başlığındaki gerekçe).
  }
}

export type DuyuruHedefi = { soforId: string; konusmaId: string };

/**
 * DUYURU BİLDİRİMİ — tek yazıda N şoför, her biri KENDİ konuşmasında.
 *
 * ── NEDEN AYRI FONKSİYON, DÖNGÜDE `mesajBildir` DEĞİL ──────────────────────
 * Duyuru N ayrı konuşmaya N ayrı mesaj yazıyor. `mesajBildir` döngüde
 * çağrılsaydı N jeton sorgusu ve N ayrı Expo isteği olurdu; 30 şoförlü filoda
 * 60 gidiş-geliş. Burada TEK sorgu ve tek partide gönderim var — Expo zaten
 * istek başına 100 mesaj kabul ediyor.
 *
 * ── HER BİLDİRİM FARKLI ADRES TAŞIR ────────────────────────────────────────
 * Alıcı dokununca KENDİ konuşması açılmalı; ortak bir "duyurular" ekranı yok.
 * Bu yüzden gövde jeton başına kuruluyor, tek şablonla değil.
 *
 * ── BAŞLIK: DUYURU DA BİREBİR MESAJDIR ─────────────────────────────────────
 * Şoför tarafında duyuru, yönetimden gelen sıradan bir mesaj olarak görünüyor
 * (aynı konuşma, aynı liste satırı). Bildirimin de öyle görünmesi gerekir:
 * başlık gönderenin adı. "Duyuru" diye ayrı bir etiket, uygulamada karşılığı
 * olmayan bir ayrım uydururdu.
 */
export async function duyuruBildir(g: {
  hedefler: DuyuruHedefi[];
  gonderenId: string;
  gonderenAd: string;
  govde: string;
}): Promise<void> {
  try {
    const hedefler = g.hedefler.filter((h) => h.soforId !== g.gonderenId);
    if (hedefler.length === 0) return;

    const jetonlar = await jetonlariGetir(hedefler.map((h) => h.soforId));
    if (jetonlar.length === 0) return;

    const konusmaOf = new Map(hedefler.map((h) => [h.soforId, h.konusmaId]));
    const kisa = onizleme(g.govde);

    const mesajlar: ExpoMesaj[] = [];
    for (const { token, workerId } of jetonlar) {
      const konusmaId = konusmaOf.get(workerId);
      // Jetonu var ama bu duyurunun hedefi değil → atlanır (olmamalı, ama
      // sessizce yanlış konuşmaya yönlendirmektense hiç göndermemek doğru).
      if (!konusmaId) continue;
      mesajlar.push({
        to: token,
        title: g.gonderenAd,
        body: kisa,
        data: { adres: konusmaId, konusmaId, tur: "birebir" },
        sound: "default",
        channelId: KANAL,
        priority: "high",
      });
    }

    await gonder(mesajlar);
  } catch {
    // Duyuru yazıldı; bildirim yolu onu düşürmez.
  }
}
