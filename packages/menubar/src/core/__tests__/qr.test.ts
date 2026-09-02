import { test } from "node:test";
import assert from "node:assert/strict";
import { byteCapacity, encodeQr, qrSvgPath, renderQrTerminal } from "../qr";

const URL = "https://codex.chenli.dev/cli-auth?code=RHF7-DWW8";

function isFinder(qr: ReturnType<typeof encodeQr>, ox: number, oy: number): boolean {
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      const expect = ring !== 2; // 3 dark centre, 1 light ring, 1 dark border
      if (qr.modules[oy + dy][ox + dx] !== expect) return false;
    }
  }
  return true;
}

test("picks the smallest version that fits and lays out the finder patterns", () => {
  const qr = encodeQr(URL);
  assert.equal(qr.ecc, "M");
  assert.equal(qr.version, 4); // 47 bytes: v3-M holds 42, v4-M holds 62
  assert.equal(qr.size, 33);
  assert.ok(isFinder(qr, 0, 0));
  assert.ok(isFinder(qr, qr.size - 7, 0));
  assert.ok(isFinder(qr, 0, qr.size - 7));
  // timing patterns alternate along row/column 6
  for (let i = 8; i < qr.size - 8; i++) {
    assert.equal(qr.modules[6][i], i % 2 === 0);
    assert.equal(qr.modules[i][6], i % 2 === 0);
  }
  assert.ok(qr.mask >= 0 && qr.mask <= 7);
});

test("capacity table: byte mode, level M", () => {
  // Reference values from the QR specification (byte mode, M).
  assert.equal(byteCapacity(1, "M"), 14);
  assert.equal(byteCapacity(4, "M"), 62);
  assert.equal(byteCapacity(10, "M"), 213);
  assert.equal(byteCapacity(40, "M"), 2331);
  assert.equal(byteCapacity(40, "L"), 2953);
  assert.equal(byteCapacity(40, "H"), 1273);
});

test("every version 1–40 and every level encodes, with a fixed mask", () => {
  for (let v = 1; v <= 40; v++) {
    for (const ecc of ["L", "M", "Q", "H"] as const) {
      const text = "x".repeat(Math.min(byteCapacity(v, ecc), 4 + v * 5));
      const qr = encodeQr(text, { ecc, minVersion: v, mask: v % 8 });
      assert.equal(qr.version, v);
      assert.equal(qr.size, v * 4 + 17);
      assert.equal(qr.mask, v % 8);
    }
  }
});

test("the payload is what limits the version; too much data throws", () => {
  assert.equal(encodeQr("a", { ecc: "L" }).version, 1);
  assert.equal(encodeQr("Z".repeat(2953), { ecc: "L" }).version, 40);
  assert.throws(() => encodeQr("Z".repeat(2954), { ecc: "L" }), /do not fit/);
});

test("non-ASCII text is UTF-8 encoded", () => {
  const qr = encodeQr("中文 https://例.com/?q=✓", { ecc: "M" });
  assert.ok(qr.version >= 2);
});

test("the same input always yields the same code", () => {
  const a = encodeQr(URL);
  const b = encodeQr(URL);
  assert.deepEqual(a.modules, b.modules);
  assert.equal(a.mask, b.mask);
});

test("terminal rendering: two module rows per line, quiet zone, optional ANSI", () => {
  const qr = encodeQr(URL);
  const plain = renderQrTerminal(qr, { quiet: 2, ansi: false });
  const lines = plain.split("\n");
  assert.equal(lines.length, Math.ceil((qr.size + 4) / 2));
  for (const l of lines) assert.equal([...l].length, qr.size + 4);
  assert.ok(/^[ ▀▄█]+$/.test(lines.join("")));
  // quiet zone: first line is all-light on the top row (only ▄ or space possible)
  assert.ok(/^[ ▄]+$/.test(lines[0]));
  const ansi = renderQrTerminal(qr, { quiet: 2, ansi: true, indent: ">" });
  for (const l of ansi.split("\n")) {
    assert.ok(l.startsWith(">\x1b[30;107m"));
    assert.ok(l.endsWith("\x1b[0m"));
  }
});

test("svg path covers exactly the dark modules", () => {
  const qr = encodeQr("HELLO", { ecc: "L" });
  const path = qrSvgPath(qr);
  let dark = 0;
  for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) dark += Number(m[3]);
  let expected = 0;
  for (const row of qr.modules) for (const c of row) if (c) expected++;
  assert.equal(dark, expected);
});
