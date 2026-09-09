#!/usr/bin/env node
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const staticDir = path.join(rootDir, 'static');

const inputFile = process.argv[2] || path.join(staticDir, 'og-preview.png');

if (!fs.existsSync(inputFile)) {
  console.error(`Error: Source file '${inputFile}' not found.`);
  process.exit(1);
}

async function run() {
  console.log(`Processing icon from: ${inputFile}`);

  const img = sharp(inputFile);
  const meta = await img.metadata();

  // If input already has alpha, use as-is; otherwise detect squircle and mask
  let basePipeline = img;
  if (!meta.hasAlpha) {
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    // Sample profile to locate glowing rim
    let profileX = [];
    for (let x = 0; x < 512; x++) {
      const idx = (512 * info.width + x) * 3;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      profileX.push({ x, lum });
    }
    const leftPeak = profileX.filter((p) => p.x > 80 && p.x < 250).sort((a, b) => b.lum - a.lum)[0];
    if (leftPeak) {
      const left = leftPeak.x;
      const right = info.width - left;
      const top = left;
      const size = right - left;
      const r = Math.round(size * 0.225);
      const maskSvg = Buffer.from(`<svg width="${size}" height="${size}">
        <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/>
      </svg>`);

      basePipeline = sharp(inputFile)
        .extract({ left, top, width: size, height: size })
        .composite([{ input: maskSvg, blend: 'dest-in' }]);
    }
  }

  const baseBuf = await basePipeline.png().toBuffer();

  // 1. Full 1024x1024 Open Graph Preview
  await sharp(baseBuf).resize(1024, 1024).png().toFile(path.join(staticDir, 'og-preview.png'));

  // 2. Android / Chrome PWA icons
  await sharp(baseBuf).resize(512, 512).png().toFile(path.join(staticDir, 'icon-512.png'));
  await sharp(baseBuf).resize(192, 192).png().toFile(path.join(staticDir, 'icon-192.png'));

  // 3. Apple Touch Icon (180x180)
  await sharp(baseBuf).resize(180, 180).png().toFile(path.join(staticDir, 'apple-touch-icon.png'));

  // 4. Favicons
  await sharp(baseBuf).resize(64, 64).png().toFile(path.join(staticDir, 'favicon.png'));
  await sharp(baseBuf).resize(32, 32).png().toFile(path.join(staticDir, 'favicon-32x32.png'));

  console.log('✅ All icons regenerated with clean transparent squircle cutouts:');
  console.log('  - apple-touch-icon.png (180x180)');
  console.log('  - icon-192.png (192x192)');
  console.log('  - icon-512.png (512x512)');
  console.log('  - og-preview.png (1024x1024)');
  console.log('  - favicon.png (64x64)');
  console.log('  - favicon-32x32.png (32x32)');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
