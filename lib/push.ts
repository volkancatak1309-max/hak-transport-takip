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
  priority: "high" | "normal";
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

/**
 * SONUÇ DÖNDÜREN GÖNDERİM — yalnız `haftalikAksiyonBildir` için.
 *
 * `gonder`/`partiGonder` bilerek `void`: mesaj yolunda sonuç kimse tarafından
 * okunmuyor ve hata mesajı düşürmemeli. Haftalık turda ise sonuç KAYDA
 * geçiyor, bu yüzden ayrı bir yol. Ölü jeton temizliği aynen yapılıyor.
 */
async function gonderSonuclu(mesajlar: ExpoMesaj[]): Promise<{ hata: string | null }> {
  let hata: string | null = null;
  for (let i = 0; i < mesajlar.length; i += PARTI) {
    const parti = mesajlar.slice(i, i + PARTI);
    const kontrol = new AbortController();
    const saat = setTimeout(() => kontrol.abort(), ZAMAN_ASIMI_MS);
    try {
      const yanit = await fetch(EXPO_UC, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(parti),
        signal: kontrol.signal,
      });
      if (!yanit.ok) {
        hata = `expo_${yanit.status}`;
        continue;
      }
      const govde = (await yanit.json()) as { data?: ExpoSonuc[] };
      const sonuclar = Array.isArray(govde.data) ? govde.data : [];
      const olu: string[] = [];
      sonuclar.forEach((s, j) => {
        if (s?.status === "error" && s.details?.error === "DeviceNotRegistered") {
          const m = parti[j];
          if (m) olu.push(m.to);
        }
      });
      await olenleriSil(olu);
    } catch (e) {
      hata = String((e as Error).name === "AbortError" ? "zaman_asimi" : (e as Error).message).slice(0, 80);
    } finally {
      clearTimeout(saat);
    }
  }
  return { hata };
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

/**
 * BELGE UYARISI BİLDİRİMİ (migration 078) — şoföre VE yönetim tarafına.
 *
 * ── NEDEN ÜÇÜNCÜ BİR GİRİŞ NOKTASI ────────────────────────────────────────
 * `mesajBildir` ve `duyuruBildir` MESAJ şeklinde: ikisi de `konusmaId` ve
 * `adres` istiyor çünkü mobil dokunuşta bir sohbet açıyor. Belge uyarısının
 * arkasında konuşma YOK. O alanları uydurup var olmayan bir sohbete
 * yönlendirmek, bildirimi dokunulunca hiçbir şey yapmayan bir şeye çevirirdi.
 *
 * ── ALICI: KİŞİ + YÖNETİM ─────────────────────────────────────────────────
 * Şoförün kendisi (belgesini o yenileyecek) VE yönetim tarafı (planlamayı o
 * yapacak). `yonetimTarafi` yeniden kullanılıyor: patronlar + O ŞOFÖRÜN
 * filosundaki şefler. İkinci bir alıcı kuralı yazmak, bildirim yüzeyiyle
 * yetki yüzeyini ayrıştırırdı — kapsam dışı bir şef, uygulamada göremediği
 * bir kişinin belgesini kilit ekranında okurdu.
 *
 * ── `adres` YERİNE `tur: "belge"` ─────────────────────────────────────────
 * Mobil bugün bir belge ekranı BİLMİYOR; bildirim dokunulunca uygulama açılır,
 * derin bağlantı yok. Veri yükünde tür ve şoför kimliği taşınıyor ki mobil
 * tarafa ekran eklendiği gün SUNUCU DEĞİŞMEDEN bağlanabilsin.
 *
 * ── KANAL ─────────────────────────────────────────────────────────────────
 * Mevcut "mesajlar" kanalı kullanılıyor. Ayrı bir kanal açmak mobil tarafta
 * `app.json` değişikliği ve sürüm çıkmayı gerektirirdi; kanal adı iki tarafta
 * AYNI olmak zorunda (bkz. KANAL sabiti). Kanal ayrımı mobil sürümle birlikte
 * gelecek bir iş.
 */
export async function belgeBildir(g: {
  soforId: string;
  soforAd: string;
  /** Kiracının tanımladığı belge etiketi — ÇEVRİLMEZ. */
  belgeTuru: string;
  /** Bitişe kalan gün; negatif = süresi doldu. */
  kalanGun: number;
  /** ISO gün (YYYY-MM-DD). */
  sonTarih: string;
}): Promise<void> {
  try {
    const yonetim = await yonetimTarafi(g.soforId);
    // Şoförün kendisi de alıcı: belgeyi o yenileyecek. `yonetimTarafi` onu
    // bilerek dışarıda bırakıyor (kendi mesajını kendine bildirmemek için),
    // burada AÇIKÇA ekleniyor.
    const alicilar = [...new Set([g.soforId, ...yonetim])];
    const jetonlar = await jetonlariGetir(alicilar);
    if (jetonlar.length === 0) return;

    const doldu = g.kalanGun < 0;
    const baslik = doldu ? `${g.belgeTuru} süresi doldu` : `${g.belgeTuru} bitiyor`;
    const govde = doldu
      ? `${g.soforAd} — ${g.sonTarih} tarihinde doldu (${Math.abs(g.kalanGun)} gün geçti)`
      : `${g.soforAd} — ${g.sonTarih} (${g.kalanGun} gün kaldı)`;

    await gonder(
      jetonlar.map(({ token }) => ({
        to: token,
        title: baslik,
        body: govde,
        data: { tur: "belge", soforId: g.soforId, sonTarih: g.sonTarih, kalanGun: g.kalanGun },
        sound: "default" as const,
        channelId: KANAL,
        priority: "high" as const,
      }))
    );
  } catch {
    // Bildirim yolu ASLA çağıranı düşürmez (modül başlığındaki gerekçe).
  }
}

/**
 * ARAÇ EKSENLİ YÖNETİM TARAFI (081) — patronlar + o ARACIN filosunun şefleri.
 *
 * `yonetimTarafi` şoför ekseninde çalışıyor (kapsam `isFleetWorker`); bakım ve
 * iş emri ise ARAÇ ekseninde. Şoför ekseninden türetmek (aracın atanmış
 * şoförüne bakmak) atamasız araçta hiç alıcı bulamazdı — ki bakımı en çok
 * gecikeni tam olarak o araçlar.
 */
async function aracYonetimTarafi(vehicleId: string): Promise<string[]> {
  // test-visible: alıcılar YÖNETİM tarafı (yonetimTarafi'ndaki gerekçenin
  // aynısı) — test hesabı zaten patron ve bu bildirim ona yeni bir şey
  // sızdırmaz; elemek ise push yolunu test hesabından DENENEMEZ kılardı.
  const { data, error } = await supabaseAdmin
    .from("workers")
    .select("id, is_admin, managed_fleet")
    .eq("is_active", true);
  if (error || !data) return [];

  const satirlar = data as { id: string; is_admin: boolean; managed_fleet: string | null }[];
  const alicilar: string[] = [];
  const kapsamlar = new Map<string, FleetScope>();

  for (const w of satirlar) {
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
    if (kapsam.isFleetVehicle(vehicleId)) alicilar.push(w.id);
  }
  return alicilar;
}

/**
 * PERİYODİK BAKIM BİLDİRİMİ (081).
 *
 * ── ALICI: YALNIZ YÖNETİM ──────────────────────────────────────────────────
 * Şoför bilerek dışarıda: bakım randevusunu o almıyor, aracı servise yönetim
 * gönderiyor. Şoföre bildirmek, elinden bir şey gelmeyen bir kişiyi haftada
 * bir dürtmek olurdu — `belgeBildir`de şoförün alıcı OLMASININ sebebi tam
 * tersiydi (belgeyi o yeniliyor).
 *
 * ── `tur: "bakim"` ─────────────────────────────────────────────────────────
 * `belgeBildir` ile aynı desen: mobilde bakım ekranı henüz yok, veri yükü
 * bugünden taşınıyor ki ekran eklendiği gün SUNUCU DEĞİŞMEDEN bağlansın.
 */
export async function bakimBildir(g: {
  vehicleId: string;
  plaka: string;
  /** Bakım tipi — kiracı verisi, ÇEVRİLMEZ. */
  tip: string;
  /** Tetikleyen eksen. */
  eksen: "km" | "sure";
  /** Kalan km (eksen='km') ya da kalan gün (eksen='sure'); negatif = geçti. */
  kalan: number;
  gecti: boolean;
}): Promise<void> {
  try {
    const alicilar = await aracYonetimTarafi(g.vehicleId);
    const jetonlar = await jetonlariGetir(alicilar);
    if (jetonlar.length === 0) return;

    const birim = g.eksen === "km" ? "km" : "gün";
    const baslik = g.gecti
      ? `${g.plaka} — ${g.tip} bakımı gecikti`
      : `${g.plaka} — ${g.tip} bakımı yaklaşıyor`;
    const govde = g.gecti
      ? `${Math.abs(g.kalan)} ${birim} geçti`
      : `${Math.abs(g.kalan)} ${birim} kaldı`;

    await gonder(
      jetonlar.map(({ token }) => ({
        to: token,
        title: baslik,
        body: govde,
        data: {
          tur: "bakim",
          aracId: g.vehicleId,
          plaka: g.plaka,
          eksen: g.eksen,
          kalan: g.kalan,
          gecti: g.gecti,
        },
        sound: "default" as const,
        channelId: KANAL,
        priority: "high" as const,
      }))
    );
  } catch {
    // Bildirim yolu ASLA çağıranı düşürmez (modül başlığındaki gerekçe).
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

/**
 * HAFTALIK AKSİYON BİLDİRİMİ (084) — YÖNETİM TARAFINA.
 *
 * ═══ NEDEN SONUÇ DÖNDÜRÜYOR — bu modülde bir İSTİSNA ═══
 *
 * Diğer bildirim fonksiyonları `void`: "bildirim mesajı düşürmez" ilkesi.
 * Burada da hiçbir şey FIRLATMIYOR ama SONUÇ dönüyor, çünkü haftalık tur
 * bildirimin akıbetini KAYDEDİYOR (`haftalik_aksiyon_turlari.bildirim_*`).
 * Gerekçe ölçülebilir: HAK61'de bugün push jetonu SIFIR (25.08.2026) — yani
 * gönderim yolu kusursuz çalışsa bile hiçbir cihaz çalmaz. Bunu "gitti"
 * saymak yalan olurdu; panel "0 cihaza gitti" diyebilmeli.
 *
 * ═══ ALICI: PATRONLAR + TÜM ŞEFLER ═══
 *
 * Haftalık panel FİLO GENELİ bir yorum; kalemleri belirli bir şoföre ya da
 * araca bağlı olsa bile liste bir bütün. Bu yüzden kapsam SORULMUYOR: şef
 * kendi filosunun kalemlerini panelde zaten kapsam süzgecinin ardından görür
 * (`requireFleetView`). Bildirim METNİNDE isim/plaka YOK — yalnız sayı ve
 * en yüksek öncelikli kalemin BAŞLIĞI; başlık zaten panelde göreceği cümle.
 *
 * ⚠️ Şoförlere GİTMEZ. Bu bir yönetim işi listesi; şoförün elinden gelen bir
 * şey yok ve haftada bir dürtmek kanalı susturmaktan başka işe yaramaz
 * (`bakimBildir`in aynı gerekçesi).
 */
export async function haftalikAksiyonBildir(g: {
  haftaBasi: string;
  aksiyonSayisi: number;
  /** En yüksek öncelikli kalemin başlığı — null ise "temiz hafta". */
  ilkBaslik: string | null;
}): Promise<{ alici: number; jeton: number; hata: string | null }> {
  try {
    // test-visible: alıcılar YÖNETİM tarafı (yonetimTarafi'ndaki gerekçenin
    // aynısı). Test hesabı patron ve panelde bu listeyi zaten görüyor.
    const { data, error } = await supabaseAdmin
      .from("workers")
      .select("id, is_admin, managed_fleet")
      .eq("is_active", true);
    if (error || !data) return { alici: 0, jeton: 0, hata: error?.message ?? "workers okunamadi" };

    const alicilar = (data as { id: string; is_admin: boolean; managed_fleet: string | null }[])
      .filter((w) => w.is_admin === true || w.managed_fleet === "bordo" || w.managed_fleet === "mavi")
      .map((w) => w.id);
    if (alicilar.length === 0) return { alici: 0, jeton: 0, hata: null };

    const jetonlar = await jetonlariGetir(alicilar);
    if (jetonlar.length === 0) {
      // SESSİZ BAŞARI DEĞİL: alıcı var ama kayıtlı cihaz yok. Tur bunu yazar.
      return { alici: alicilar.length, jeton: 0, hata: "kayitli_cihaz_yok" };
    }

    const baslik =
      g.aksiyonSayisi === 0
        ? "Bu hafta aksiyon yok"
        : `Bu hafta ${g.aksiyonSayisi} aksiyon`;
    const govde = g.ilkBaslik ?? "Filoda eşiği geçen bir kalem çıkmadı.";

    const sonuc = await gonderSonuclu(
      jetonlar.map(({ token }) => ({
        to: token,
        title: baslik,
        body: govde,
        data: { tur: "haftalik_aksiyon", haftaBasi: g.haftaBasi, adet: g.aksiyonSayisi },
        sound: "default" as const,
        channelId: KANAL,
        // Haftalık özet ACİL DEĞİL: normal öncelik, Doze modunda beklesin.
        priority: "normal" as const,
      }))
    );
    return { alici: alicilar.length, jeton: jetonlar.length, hata: sonuc.hata };
  } catch (e) {
    return { alici: 0, jeton: 0, hata: String((e as Error).message).slice(0, 160) };
  }
}

/**
 * MEVZUAT ERKEN UYARISI — ŞOFÖRE VE YÖNETİME (086).
 *
 * ⚠️ `void` DÖNMÜYOR, SONUÇ DÖNÜYOR — bilinçli istisna (haftalikAksiyonBildir
 * ile aynı gerekçe): `mevzuat_uyarilari` satırı gönderimin akıbetini kaydeder
 * ve panel "uyarı gerçekten ulaştı mı" sorusunu cevaplayabilmelidir. HAK61'de
 * kayıtlı push jetonu SIFIR — ölçüldü; "gönderildi" demek yalan olurdu.
 *
 * ⚠️ İKİ AYRI ALICI, İKİ AYRI ÖNCELİK: şoförün uyarısı ACİLDİR (yolda, karar
 * vermesi gerekiyor) → `high`. Yöneticininki durum bilgisidir → `normal`,
 * Doze modunda bekleyebilir.
 */
export async function mevzuatUyarisiBildir(g: {
  workerId: string;
  ad: string;
  kural: { kural: string; temel: string; dayanak: string; esikDk: number; kalanDk: number | null; tur: string; gerekenMolaDk: number | null };
  kademe: "erken" | "yaklasti" | "son" | "ihlal";
}): Promise<{ soforJeton: number; yoneticiJeton: number; hata: string | null }> {
  try {
    const { uyariMetni } = await import("@/lib/mevzuat");
    const metin = uyariMetni(
      g.kural as unknown as Parameters<typeof uyariMetni>[0],
      g.kademe
    );

    const [soforJetonlar, yonetim] = await Promise.all([
      jetonlariGetir([g.workerId]),
      yonetimTarafi(g.workerId),
    ]);
    const yoneticiJetonlar = await jetonlariGetir(yonetim);

    const mesajlar: ExpoMesaj[] = [
      ...soforJetonlar.map(({ token }) => ({
        to: token,
        title: metin.baslik,
        body: metin.govde,
        data: { tur: "mevzuat_uyari", kural: g.kural.kural, kademe: g.kademe },
        sound: "default" as const,
        channelId: KANAL,
        priority: "high" as const,
      })),
      ...yoneticiJetonlar.map(({ token }) => ({
        to: token,
        title: `${g.ad} — ${metin.baslik.toLowerCase()}`,
        body: metin.govde,
        data: { tur: "mevzuat_uyari", kural: g.kural.kural, kademe: g.kademe, workerId: g.workerId },
        sound: "default" as const,
        channelId: KANAL,
        priority: "normal" as const,
      })),
    ];

    if (mesajlar.length === 0) {
      return { soforJeton: 0, yoneticiJeton: 0, hata: "kayitli_cihaz_yok" };
    }

    const sonuc = await gonderSonuclu(mesajlar);
    return {
      soforJeton: soforJetonlar.length,
      yoneticiJeton: yoneticiJetonlar.length,
      hata: sonuc.hata,
    };
  } catch (e) {
    return { soforJeton: 0, yoneticiJeton: 0, hata: String((e as Error).message).slice(0, 160) };
  }
}
