import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "..", "public");

const BRAND_BG = "#FF6B00";

async function makeIcon(size, output) {
  const padding = Math.round(size * 0.18);
  const inner = size - padding * 2;
  const logoBuf = await sharp(join(PUBLIC, "logo-original.png"))
    .resize({ width: inner, height: inner, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BRAND_BG,
    },
  })
    .composite([{ input: logoBuf, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(join(PUBLIC, output));
  console.log(`✓ ${output} (${size}x${size})`);
}

async function makeAppleTouch() {
  const padding = 40;
  const logoBuf = await sharp(join(PUBLIC, "logo-original.png"))
    .resize({ width: 180 - padding * 2, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({
    create: { width: 180, height: 180, channels: 4, background: BRAND_BG },
  })
    .composite([{ input: logoBuf, gravity: "center" }])
    .png()
    .toFile(join(PUBLIC, "apple-touch-icon.png"));
  console.log("✓ apple-touch-icon.png");
}

await mkdir(PUBLIC, { recursive: true });
await makeIcon(192, "icon-192.png");
await makeIcon(512, "icon-512.png");
await makeAppleTouch();
