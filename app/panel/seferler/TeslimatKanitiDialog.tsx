"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImzaPad } from "@/components/teslimat/ImzaPad";
import { resizeImage } from "@/lib/image-resize";
import { getGeoFix } from "@/app/panel/geo";
import { teslimatKanitiBirak, teslimatFotoEkle } from "@/app/actions/teslimat";

/**
 * TESLİMAT KANITI BIRAKMA — şoför yüzeyi.
 *
 * ═══ SIRA: ÖNCE KAYIT, SONRA FOTOĞRAFLAR ═══
 *
 * Kanıt kaydı bir istekte açılıyor (imza + alıcı + not + konum), fotoğraflar
 * ayrı ayrı ekleniyor. Sebebi ölçülebilir bir sınır: Next sunucu eylemi
 * gövdesi varsayılan ~1 MB ve ePOD birden çok fotoğraf kabul ediyor.
 *
 * Yan fayda: bir fotoğraf yüklenemezse kanıt kaydı YİNE DE duruyor — imza ve
 * damga kaybolmuyor, ekran hangi fotoğrafın düştüğünü söylüyor.
 *
 * ═══ KONUM: KANITIN YARISI ═══
 *
 * GPS teslimat anında bir kez alınıyor ve HEM kayda HEM her fotoğrafa
 * yazılıyor. Reddedilirse null geçiyor ve akış durmuyor: konum en iyi çabadır,
 * ön koşul değil (app/panel/geo.ts ile aynı kural).
 */

const MAX_FOTO = 5;

export function TeslimatKanitiDialog({
  seferId,
  acik,
  kapat,
  tamamlandi,
}: {
  seferId: string;
  acik: boolean;
  kapat: () => void;
  tamamlandi: () => void;
}) {
  const t = useTranslations("teslimat");
  const [imza, setImza] = useState("");
  const [alici, setAlici] = useState("");
  const [not, setNot] = useState("");
  const [fotolar, setFotolar] = useState<File[]>([]);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const dosyaRef = useRef<HTMLInputElement | null>(null);

  const kanitVar = Boolean(imza || fotolar.length > 0 || not.trim() || alici.trim());

  async function fotoSec(e: React.ChangeEvent<HTMLInputElement>) {
    const secilen = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (secilen.length === 0) return;
    const yer = MAX_FOTO - fotolar.length;
    if (yer <= 0) {
      toast.error(t("foto_tavan", { n: MAX_FOTO }));
      return;
    }
    // Küçültme İSTEMCİDE: 1600px/q0.85. Ham telefon fotoğrafı 3-8 MB gelir ve
    // hem sunucu tavanını hem kova sınırını aşar.
    const kucuk = await Promise.all(
      secilen.slice(0, yer).map((f) => resizeImage(f, "teslimat.jpg"))
    );
    setFotolar((o) => [...o, ...kucuk]);
  }

  async function gonder() {
    if (!kanitVar || gonderiliyor) return;
    setGonderiliyor(true);

    const fix = await getGeoFix();

    const fd = new FormData();
    fd.set("seferId", seferId);
    fd.set("imzaSvg", imza);
    fd.set("aliciAd", alici);
    fd.set("notlar", not);
    fd.set("fotoSayisi", String(fotolar.length));
    if (fix.lat !== null) fd.set("lat", String(fix.lat));
    if (fix.lng !== null) fd.set("lng", String(fix.lng));
    if (fix.accuracy !== null) fd.set("accuracy", String(fix.accuracy));

    const r = await teslimatKanitiBirak(fd);
    if (!r.ok) {
      setGonderiliyor(false);
      toast.error(t(`hata_${r.hata}`));
      return;
    }

    let dusen = 0;
    for (const f of fotolar) {
      const ff = new FormData();
      ff.set("teslimatId", r.id);
      ff.set("foto", f);
      if (fix.lat !== null) ff.set("lat", String(fix.lat));
      if (fix.lng !== null) ff.set("lng", String(fix.lng));
      if (fix.accuracy !== null) ff.set("accuracy", String(fix.accuracy));
      const fr = await teslimatFotoEkle(ff);
      if (!fr.ok) dusen++;
    }

    setGonderiliyor(false);
    if (dusen > 0) toast.warning(t("foto_kismi", { n: dusen }));
    else toast.success(t("kaydedildi"));

    setImza("");
    setAlici("");
    setNot("");
    setFotolar([]);
    tamamlandi();
  }

  return (
    <Dialog open={acik} onOpenChange={(o) => !o && !gonderiliyor && kapat()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("baslik")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm">{t("imza")}</Label>
            <ImzaPad onChange={setImza} disabled={gonderiliyor} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm" htmlFor="alici">
              {t("alici")}
            </Label>
            <Input
              id="alici"
              value={alici}
              onChange={(e) => setAlici(e.target.value.slice(0, 80))}
              placeholder={t("alici_ipucu")}
              className="h-11"
              disabled={gonderiliyor}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">{t("foto")}</Label>
            <input
              ref={dosyaRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={fotoSec}
              className="hidden"
            />
            <div className="flex flex-wrap items-center gap-2">
              {fotolar.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-xs"
                >
                  {t("foto_no", { n: i + 1 })}
                  <button
                    type="button"
                    onClick={() => setFotolar((o) => o.filter((_, j) => j !== i))}
                    disabled={gonderiliyor}
                    aria-label={t("foto_sil")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => dosyaRef.current?.click()}
                disabled={gonderiliyor || fotolar.length >= MAX_FOTO}
                className="h-9"
              >
                <Camera className="size-4" />
                {t("foto_ekle")}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm" htmlFor="not">
              {t("not")}
            </Label>
            <Textarea
              id="not"
              value={not}
              onChange={(e) => setNot(e.target.value.slice(0, 500))}
              rows={2}
              disabled={gonderiliyor}
            />
          </div>

          {/*
            DAMGA UYARISI — kanıtın değeri burada. Şoför neyin kaydedildiğini
            bilmeli: saat sunucudan, konum telefondan.
          */}
          <p className="flex items-start gap-2 rounded-lg bg-accent-gold/10 p-2.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-px size-3.5 shrink-0" />
            {t("damga_notu")}
          </p>

          <Button onClick={gonder} disabled={!kanitVar || gonderiliyor} className="w-full">
            {gonderiliyor ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {t("kaydet")}
          </Button>
          {!kanitVar && <p className="text-center text-xs text-muted-foreground">{t("kanit_sart")}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
