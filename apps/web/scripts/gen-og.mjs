/**
 * Generates public/og.png — a 1200×630 placeholder in the brand palette
 * (bg #0b0d10 with the blue logo block + white bars). No dependencies.
 * Run: node scripts/gen-og.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1200, H = 630;
const px = new Uint8Array(W * H * 3);

function fill(x0, y0, w, h, [r, g, b]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * W + x) * 3;
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
  }
}

const BG = [0x0b, 0x0d, 0x10];
const BLUE = [0x4f, 0x7d, 0xff];
const WHITE = [0xff, 0xff, 0xff];

fill(0, 0, W, H, BG);
/* centered logo block (scaled 8× from the 24px logo) */
const S = 8, LW = 24 * S, LH = 24 * S;
const LX = (W - LW) / 2, LY = (H - LH) / 2;
fill(LX, LY, LW, LH, BLUE);
fill(LX + 5.5 * S, LY + 13 * S, 3 * S, 6 * S, WHITE);
fill(LX + 10.5 * S, LY + 8 * S, 3 * S, 11 * S, WHITE);
fill(LX + 15.5 * S, LY + 11 * S, 3 * S, 8 * S, WHITE);

/* PNG encode */
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0; // filter: none
  px.subarray(y * W * 3, (y + 1) * W * 3).forEach((v, i) => { raw[y * (W * 3 + 1) + 1 + i] = v; });
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'og.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
