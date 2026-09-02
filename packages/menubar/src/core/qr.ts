/**
 * Dependency-free QR code encoder (ISO/IEC 18004, byte mode, versions 1–40, all four error-correction
 * levels) plus renderers for the terminal (Unicode half blocks) and the popover (an SVG path).
 *
 * Used by `codex-tracker login`: a headless box (WSL2, a build server, an SSH session) has no browser
 * to open the approval link in, so the CLI prints the link and a QR code of it — the user scans it
 * with a phone, or opens the link on any other computer, and approves the device from there.
 *
 * Runs on Node 16 (the nodejs16 package bundles this file) and in the popover renderer.
 */

export type EccLevel = "L" | "M" | "Q" | "H";

export interface QrCode {
  version: number;
  ecc: EccLevel;
  mask: number;
  size: number;
  /** modules[y][x] — true = dark. */
  modules: boolean[][];
}

const ECC_INDEX: Record<EccLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };
const ECC_FORMAT_BITS: Record<EccLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Indexed [ecc][version]; index 0 is a placeholder.
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ECC_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver: number, ecc: EccLevel): number {
  const e = ECC_INDEX[ecc];
  return Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[e][ver] * NUM_ECC_BLOCKS[e][ver];
}

function byteCountBits(ver: number): number {
  return ver <= 9 ? 8 : 16;
}

/** Data capacity in bytes of byte mode at a version/level (mode + count indicator subtracted). */
export function byteCapacity(ver: number, ecc: EccLevel): number {
  return Math.floor((numDataCodewords(ver, ecc) * 8 - 4 - byteCountBits(ver)) / 8);
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

// ---- Reed–Solomon over GF(2^8) with the QR polynomial 0x11D ----
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result: number[] = new Array(degree).fill(0);
  result[degree - 1] = 1; // x^0 coefficient
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMultiply(divisor[i], factor);
  }
  return result;
}

function addEccAndInterleave(ver: number, ecc: EccLevel, data: number[]): number[] {
  const e = ECC_INDEX[ecc];
  const numBlocks = NUM_ECC_BLOCKS[e][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[e][ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const rem = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0); // placeholder so every block has the same length
    blocks.push(dat.concat(rem));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      // skip the padding byte of short blocks
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// ---- Matrix construction ----
class Matrix {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(size: number) {
    this.size = size;
    this.modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  setFunction(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  drawFinder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) this.setFunction(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }

  drawAlignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  drawFormatBits(ecc: EccLevel, mask: number) {
    const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    // around the top-left finder
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(i));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(i));
    // next to the other two finders
    for (let i = 0; i < 8; i++) this.setFunction(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFunction(8, this.size - 15 + i, bit(i));
    this.setFunction(8, this.size - 8, true); // always dark
  }

  drawVersion(ver: number) {
    if (ver < 7) return;
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  drawFunctionPatterns(ver: number, ecc: EccLevel) {
    for (let i = 0; i < this.size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);
    const align = alignmentPositions(ver);
    const n = align.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0))) this.drawAlignment(align[i], align[j]);
      }
    }
    this.drawFormatBits(ecc, 0); // placeholder; redrawn for the chosen mask
    this.drawVersion(ver);
  }

  drawCodewords(data: number[]) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  penalty(): number {
    let result = 0;
    const size = this.size;
    const m = this.modules;
    // adjacent runs, and finder-like patterns, in rows and columns
    for (let y = 0; y < size; y++) {
      let runColor = false;
      let runX = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < size; x++) {
        if (m[y][x] === runColor) {
          runX++;
          if (runX === 5) result += PENALTY_N1;
          else if (runX > 5) result++;
        } else {
          finderPenaltyAddHistory(runX, runHistory, size);
          if (!runColor) result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = m[y][x];
          runX = 1;
        }
      }
      result += finderPenaltyTerminateAndCount(runColor, runX, runHistory, size) * PENALTY_N3;
    }
    for (let x = 0; x < size; x++) {
      let runColor = false;
      let runY = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < size; y++) {
        if (m[y][x] === runColor) {
          runY++;
          if (runY === 5) result += PENALTY_N1;
          else if (runY > 5) result++;
        } else {
          finderPenaltyAddHistory(runY, runHistory, size);
          if (!runColor) result += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = m[y][x];
          runY = 1;
        }
      }
      result += finderPenaltyTerminateAndCount(runColor, runY, runHistory, size) * PENALTY_N3;
    }
    // 2×2 blocks of the same color
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += PENALTY_N2;
      }
    }
    // balance of dark modules
    let dark = 0;
    for (const row of m) for (const c of row) if (c) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  }
}

function finderPenaltyCountPatterns(h: number[]): number {
  const n = h[1];
  const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
  return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
}

function finderPenaltyTerminateAndCount(currentRunColor: boolean, currentRunLength: number, h: number[], size: number): number {
  if (currentRunColor) {
    finderPenaltyAddHistory(currentRunLength, h, size);
    currentRunLength = 0;
  }
  currentRunLength += size; // light border
  finderPenaltyAddHistory(currentRunLength, h, size);
  return finderPenaltyCountPatterns(h);
}

function finderPenaltyAddHistory(currentRunLength: number, h: number[], size: number) {
  if (h[0] === 0) currentRunLength += size; // light border before the first run
  h.pop();
  h.unshift(currentRunLength);
}

function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

export interface EncodeOptions {
  ecc?: EccLevel;
  minVersion?: number;
  maxVersion?: number;
  /** Force a mask (0–7) instead of picking the lowest-penalty one; for tests. */
  mask?: number;
}

/** Encode `text` (UTF-8, byte mode) into the smallest QR version that fits. Throws when it does not fit v40. */
export function encodeQr(text: string, opts: EncodeOptions = {}): QrCode {
  const ecc = opts.ecc ?? "M";
  const bytes = utf8Bytes(text);
  const minVersion = Math.max(1, opts.minVersion ?? 1);
  const maxVersion = Math.min(40, opts.maxVersion ?? 40);
  let version = -1;
  for (let v = minVersion; v <= maxVersion; v++) {
    if (bytes.length <= byteCapacity(v, ecc)) {
      version = v;
      break;
    }
  }
  if (version < 0) throw new Error(`QR: ${bytes.length} bytes do not fit in version ${maxVersion} at level ${ecc}`);

  // bit stream: mode, count, data, terminator, byte alignment, pad codewords
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, byteCountBits(version));
  for (const b of bytes) push(b, 8);
  const capacityBits = numDataCodewords(version, ecc) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }

  const size = version * 4 + 17;
  const m = new Matrix(size);
  m.drawFunctionPatterns(version, ecc);
  m.drawCodewords(addEccAndInterleave(version, ecc, data));

  let mask = opts.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let i = 0; i < 8; i++) {
      m.applyMask(i);
      m.drawFormatBits(ecc, i);
      const p = m.penalty();
      if (p < best) {
        best = p;
        mask = i;
      }
      m.applyMask(i); // undo (XOR)
    }
  }
  m.applyMask(mask);
  m.drawFormatBits(ecc, mask);
  return { version, ecc, mask, size, modules: m.modules };
}

// ---- Renderers ----

export interface TerminalRenderOptions {
  /** Quiet zone in modules on every side (the standard asks for 4; 2 scans fine on a screen). */
  quiet?: number;
  /** Emit ANSI colours so the code is black-on-white whatever the terminal theme. */
  ansi?: boolean;
  /** Left margin, in characters, prepended to every line. */
  indent?: string;
}

/**
 * Render for a terminal: two module rows per text line using ▀ ▄ █ and space. With `ansi`, every line
 * is painted black-on-white explicitly, so it scans on light *and* dark terminal themes; without it
 * the glyphs use the terminal's default colours (dark on light is what a scanner wants, so a dark
 * theme's light-on-dark output is inverted — most phone cameras cope, but `ansi` is safer).
 */
export function renderQrTerminal(qr: QrCode, opts: TerminalRenderOptions = {}): string {
  const quiet = opts.quiet ?? 2;
  const indent = opts.indent ?? "";
  const size = qr.size + quiet * 2;
  const dark = (x: number, y: number): boolean => {
    const mx = x - quiet;
    const my = y - quiet;
    if (mx < 0 || my < 0 || mx >= qr.size || my >= qr.size) return false;
    return qr.modules[my][mx];
  };
  const lines: string[] = [];
  for (let y = 0; y < size; y += 2) {
    let line = "";
    for (let x = 0; x < size; x++) {
      const top = dark(x, y);
      const bottom = y + 1 < size ? dark(x, y + 1) : false;
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(opts.ansi ? `${indent}\x1b[30;107m${line}\x1b[0m` : indent + line);
  }
  return lines.join("\n");
}

/** One `<path d>` string covering every dark module, in module units (viewBox `0 0 size size`). */
export function qrSvgPath(qr: QrCode): string {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.modules[y][x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < qr.size && qr.modules[y][x + run]) run++;
      parts.push(`M${x} ${y}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return parts.join("");
}
