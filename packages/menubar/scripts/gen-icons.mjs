// Generates tray/app icons as PNGs with no dependencies (tiny PNG encoder + supersampled rasterizer).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "assets");
fs.mkdirSync(assets, { recursive: true });

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Render with `ss`× supersampling. `shapes` = list of {kind:'rrect', x,y,w,h,r,color:[r,g,b,a]} in unit coords (0..1). */
function render(size, shapes, ss = 8) {
  const S = size * ss;
  const buf = new Float32Array(S * S * 4);
  for (const sh of shapes) {
    const x0 = sh.x * S, y0 = sh.y * S, x1 = (sh.x + sh.w) * S, y1 = (sh.y + sh.h) * S, r = sh.r * S;
    const [cr, cg, cb, ca] = sh.color;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const px = x + 0.5, py = y + 0.5;
        if (px < x0 || px > x1 || py < y0 || py > y1) continue;
        // rounded corners
        const cx = Math.min(Math.max(px, x0 + r), x1 - r), cy = Math.min(Math.max(py, y0 + r), y1 - r);
        if ((px - cx) ** 2 + (py - cy) ** 2 > r * r) continue;
        const i = (y * S + x) * 4;
        const a = ca;
        buf[i] = buf[i] * (1 - a) + cr * a;
        buf[i + 1] = buf[i + 1] * (1 - a) + cg * a;
        buf[i + 2] = buf[i + 2] * (1 - a) + cb * a;
        buf[i + 3] = buf[i + 3] * (1 - a) + a;
      }
    }
  }
  const outBuf = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const i = ((y * ss + dy) * S + (x * ss + dx)) * 4;
          r += buf[i] * buf[i + 3]; g += buf[i + 1] * buf[i + 3]; b += buf[i + 2] * buf[i + 3]; a += buf[i + 3];
        }
      }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      if (a > 0) {
        outBuf[o] = Math.round((r / a) * 255); outBuf[o + 1] = Math.round((g / a) * 255); outBuf[o + 2] = Math.round((b / a) * 255);
      }
      outBuf[o + 3] = Math.round((a / n) * 255);
    }
  }
  return outBuf;
}

/** Three rising bars (token chart glyph) inside a unit box with padding. */
function bars(color, pad = 0.12) {
  const inner = 1 - pad * 2;
  const gap = inner * 0.12;
  const bw = (inner - gap * 2) / 3;
  const heights = [0.45, 0.72, 1];
  return heights.map((h, i) => ({
    kind: "rrect",
    x: pad + i * (bw + gap),
    y: pad + inner * (1 - h),
    w: bw,
    h: inner * h,
    r: bw * 0.28,
    color,
  }));
}

const black = [0, 0, 0, 1];
const white = [1, 1, 1, 1];
const indigo = [0x63 / 255, 0x66 / 255, 0xf1 / 255, 1];

const files = {
  "trayTemplate.png": [16, bars(black)],
  "trayTemplate@2x.png": [32, bars(black)],
  "tray-win.png": [32, bars(white)],
  "tray-win-light.png": [32, bars(black)],
  "icon.png": [256, [{ kind: "rrect", x: 0, y: 0, w: 1, h: 1, r: 0.22, color: indigo }, ...bars(white, 0.24)]],
};
for (const [name, [size, shapes]] of Object.entries(files)) {
  fs.writeFileSync(path.join(assets, name), encodePNG(size, size, render(size, shapes)));
  console.log(`wrote assets/${name} (${size}×${size})`);
}
