import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_ELECTRON_VERSION,
  binaryFromPackageDir,
  ensureManagedElectronDir,
  managedElectronDir,
  platformExecutablePath,
} from "../electron-install";

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ctrack-electron-"));
}

test("the default Electron version is a concrete release, not a range", () => {
  assert.match(DEFAULT_ELECTRON_VERSION, /^\d+\.\d+\.\d+$/);
});

test("the managed runtime lives under <config dir>/electron/<version>", () => {
  assert.equal(managedElectronDir("/cfg", "38.8.6"), path.join("/cfg", "electron", "38.8.6"));
  assert.equal(managedElectronDir("/cfg"), path.join("/cfg", "electron", DEFAULT_ELECTRON_VERSION));
});

test("ensureManagedElectronDir lays the directory out like the electron npm package", () => {
  const home = scratch();
  try {
    const dir = ensureManagedElectronDir(home, "22.3.27");
    assert.equal(dir, managedElectronDir(home, "22.3.27"));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    assert.equal(manifest.name, "electron");
    assert.equal(manifest.version, "22.3.27");
    // idempotent: a second call leaves an existing manifest alone
    const before = fs.statSync(path.join(dir, "package.json")).mtimeMs;
    ensureManagedElectronDir(home, "22.3.27");
    assert.equal(fs.statSync(path.join(dir, "package.json")).mtimeMs, before);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("binaryFromPackageDir resolves path.txt relative to dist/, and only when the file exists", () => {
  const dir = scratch();
  try {
    assert.equal(binaryFromPackageDir(dir), null, "no path.txt yet");
    const rel = platformExecutablePath();
    fs.writeFileSync(path.join(dir, "path.txt"), rel + "\n");
    assert.equal(binaryFromPackageDir(dir), null, "path.txt present but the binary is not");
    const exe = path.join(dir, "dist", rel);
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, "");
    assert.equal(binaryFromPackageDir(dir), exe);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
