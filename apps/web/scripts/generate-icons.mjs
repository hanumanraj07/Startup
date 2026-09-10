import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

// A simple, real mark: brand-blue rounded square with a white location pin —
// "someone on the ground, wherever you need them." No placeholder pixels.
const svg = (size, radius) => `
<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="${radius}" fill="#2B4FD8"/>
  <path d="M256 96c-61.9 0-112 50.1-112 112 0 84 112 208 112 208s112-124 112-208c0-61.9-50.1-112-112-112z"
        fill="#ffffff"/>
  <circle cx="256" cy="208" r="48" fill="#2B4FD8"/>
</svg>`;

async function make(size, radius, outPath) {
  await sharp(Buffer.from(svg(size, radius))).resize(size, size).png().toFile(outPath);
  console.log('wrote', outPath);
}

await make(512, 96, 'public/icon-512.png');
await make(192, 36, 'public/icon-192.png');
await make(180, 36, 'public/apple-touch-icon.png');
await make(32, 6, 'public/favicon-32.png');

// Maskable variant needs safe-area padding (icon content within the inner
// ~80% so platform masks don't clip it) — same mark, smaller, on a full-bleed
// square background, no rounding (the OS applies its own mask shape).
const maskableSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#2B4FD8"/>
  <g transform="translate(76.8,76.8) scale(0.7)">
    <path d="M256 96c-61.9 0-112 50.1-112 112 0 84 112 208 112 208s112-124 112-208c0-61.9-50.1-112-112-112z" fill="#ffffff"/>
    <circle cx="256" cy="208" r="48" fill="#2B4FD8"/>
  </g>
</svg>`;
await sharp(Buffer.from(maskableSvg)).resize(512, 512).png().toFile('public/icon-512-maskable.png');
console.log('wrote public/icon-512-maskable.png');
