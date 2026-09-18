import type { NextRequest } from "next/server";
import { requireMobileFleetView } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { sinirDenetle } from "@/lib/rate-limit";
import { computeAnalyticsRange } from "@/lib/analytics";
import { startOfDayViennaFromYmd, endOfDayViennaFromYmd } from "@/lib/format";
import { buildFleetComparison } from "@/lib/fleet-compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/fleets/karsilastir?donem=hafta|ay|ozel&from=&to= — filo karnesi.
 *
 * ── KAPI: requireMobileFleetView ──────────────────────────────────────────
 * Kardeş filo uçlarından (requireMobileAdmin) BİLEREK farklı. Onlar filo
 * TANIMINI değiştiriyor — şefin karşı filodan araç çekmesine kapı açardı.
 * Burası SALT OKUMA: şefin kendi filosunun karnesini görmesi, yönettiği işin
 * ta kendisidir. Kapsam daraltması `getFleetScope` ile ve FAIL-CLOSED: kapsam
 * çözülemezse boş kümeye düşer, kısıtsıza DEĞİL.
 *
 * ŞEF "DİĞERLERİ"Nİ GÖRMEZ — toplamını bile. İstenmedi ve doğrusu da bu: bir
 * karşılaştırma ucunda "diğerleri toplamı", karşı filonun km'sini ve alarm
 * sayısını sızdırmanın kibar biçimidir. Şefin yanıtında yalnız kendi filosu
 * olur; `sahipsiz` kovası da null döner (o araçlar onun filosunda değil).
 *
 * ── `?donem=` (kardeş uçlarda `?range=` DEĞİL) ────────────────────────────
 * `/driver-scores` ve `/_performans` ailesi `?donem=` konuşuyor; bu uç o
 * ailenin devamı. `gun` ve `tumzaman` BİLEREK yok: günlük pencerede yakıt
 * ölçülemiyor (L/100km en az FUEL_L100_MIN_DAYS gün ister) ve "tüm zaman"
 * bir KARŞILAŞTIRMA değil bir arşiv sorusu.
 *
 * ── YENİ FORMÜL YOK ───────────────────────────────────────────────────────
 * Bütün sayılar Analiz/Performans/Yakıt raporunun KENDİ toplayıcılarından
 * gelir; bu uç yalnız girdileri filoya göre süzüp aynı fonksiyonları çağırır
 * (lib/fleet-compare.ts). Yanıttaki `denklik` bloğu Σ(filolar) === toplayıcının
 * kendi toplamı kimliğini İSTEMCİYE KANITLAR — ikinci bir çağrı gerekmeden.
 *
 * ⚠️ `km` 052 EKSENİDİR, Analiz'in `km`i ile AYNI SAYI DEĞİLDİR (iki ayrı
 * ölçüm yöntemi; gerekçe ve canlı fark lib/fleet-compare.ts başlığında).
 * Vardiya sayısı, alarm ve rölanti Analiz ile birebir eşittir.
 *
 * ── HIZ SINIRI: kişi başına dakikada 10 ───────────────────────────────────
 * `lib/rate-limit.ts` — `/kiraci-sorgu` ile AYNI kalıp (süreç içi kayan
 * pencere). 098'in `upload_rate` tablosu BİLEREK kullanılmadı: o bir YAZMA
 * sayacı ve okuma ucunu oraya bağlamak her okumayı bir UPDATE'e çevirirdi
 * (rate-limit.ts'in kendi başlığında yazılı gerekçe). Sayaç süreç içidir ve
 * soğuk başlangıçta sıfırlanır — dağıtık bir yükü durdurmaz, tek bir istemcinin
 * bu pahalı ucu saniyede yoklamasını durdurur. Uç PAHALI: altı toplayıcı
 * çalışıyor, ikisi RPC.
 */

const DONEMLER = ["hafta", "ay", "ozel"] as const;
type Donem = (typeof DONEMLER)[number];

/** Kişi başına dakikada kaç karşılaştırma. */
const TAVAN = 10;
const PENCERE_SN = 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const guard = await requireMobileFleetView(req);
  if (!guard.ok) return guard.response;

  // Sınır KİMLİĞE bağlı, IP'ye değil: aynı şef iki cihazdan da tek kotadan
  // harcasın (098'in "kota kişiye aittir" kararıyla aynı eksen).
  const sinir = sinirDenetle(
    `filo-karsilastir:${guard.actor.worker.id}`,
    TAVAN,
    PENCERE_SN
  );
  if (!sinir.ok) {
    return Response.json(
      { ok: false, error: "hiz_siniri", retryAfter: sinir.tekrarSn },
      { status: 429, headers: { "Retry-After": String(sinir.tekrarSn) } }
    );
  }

  const url = new URL(req.url);
  const ham = url.searchParams.get("donem");
  const donem = (ham ?? "hafta") as Donem;
  if (!(DONEMLER as readonly string[]).includes(donem)) {
    return mobileError(400, "invalid_donem", { kabul: DONEMLER });
  }

  let range;
  if (donem === "ozel") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) {
      return mobileError(400, "missing_fields", { alan: from ? "to" : "from" });
    }
    if (!YMD.test(from) || !YMD.test(to)) {
      return mobileError(400, "invalid_tarih", { sebep: "bicim" });
    }
    // Doğrulama İKİNCİ bir takvim uygulaması DEĞİL: kararı pencereyi kuran
    // fonksiyonlar veriyor (var olmayan günde null) — `_rapor/aralik.ts` ile
    // aynı yaklaşım.
    const start = startOfDayViennaFromYmd(from);
    const end = endOfDayViennaFromYmd(to);
    if (!start || !end) return mobileError(400, "invalid_tarih", { sebep: "gun" });
    if (start.getTime() > end.getTime()) {
      return mobileError(400, "invalid_tarih", { sebep: "sira" });
    }
    range = { start, end };
  } else {
    // Panelin kendi pencere fonksiyonu — "son 7/30 gün" iki yüzeyde iki farklı
    // pencere olmasın.
    range = computeAnalyticsRange(donem);
  }

  let sonuc;
  try {
    sonuc = await buildFleetComparison(range, guard.actor.fleetScope);
  } catch {
    // Sessiz eksik YASAK: bir toplayıcı düşerse boş/yarım karne göstermek
    // yerine hata döneriz — "filo 0 km yapmış" demek, ölçememekten kötüdür.
    return mobileError(503, "db_error");
  }

  return Response.json({
    ok: true,
    donem: {
      tur: donem,
      from: range.start.toISOString(),
      to: range.end.toISOString(),
    },
    kapsam: { isChief: guard.actor.isChief, filo: guard.actor.fleet },
    filolar: sonuc.filolar,
    /**
     * NORMALİZE KIYAS (18.09.2026) — beş metrik, büyüklükten arındırılmış.
     * Ham toplam filo BÜYÜKLÜĞÜNÜ ölçer: 19 araçlı filo elbette daha çok km
     * yapar. Her metrik kendi paydasına bölünür (km/araç · alarm/100km ·
     * L/100km · rölanti saat/vardiya · skor) ve filo ortalamasına göre yüzde
     * farkı taşınır. `enIyi`/`enKotu` YALNIZ yönlü metriklerde dolu —
     * `kmPerArac` yönsüzdür (çok km yapmak ne iyi ne kötü, iş hacmidir).
     */
    normalize: sonuc.normalize,
    sahipsiz: sonuc.sahipsiz,
    toplam: sonuc.toplam,
    // Kimlik kanıtı yanıtta: bir gün bozulursa istemci GÖREBİLSİN.
    denklik: sonuc.denklik,
    oran: sonuc.oran,
    kmKaynagi: sonuc.kmKaynagi,
    yakitKaynagi: sonuc.yakitKaynagi,
    kirpildi: sonuc.kirpildi,
    sayimTestHaric: sonuc.sayimTestHaric,
  });
}
