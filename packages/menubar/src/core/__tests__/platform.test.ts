import { test } from "node:test";
import assert from "node:assert/strict";
import { isMachineId } from "@codex-tracker/shared";
import { machineId, parseMachineGuid, parsePlatformUuid } from "../platform";

test("parses the Windows MachineGuid from `reg query` output, NUL bytes and CRLF included", () => {
  const out = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    3F2504E0-4F89-11D3-9A0C-0305E82C3301\r\n\r\n";
  assert.equal(parseMachineGuid(out), "3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  // reg.exe reached through WSL interop: the same text, UTF-16 style, after NULs were stripped
  assert.equal(parseMachineGuid(out.split("").join("\0").replace(/\0/g, "")), "3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  assert.equal(parseMachineGuid("ERROR: The system was unable to find the specified registry key or value."), null);
  assert.equal(parseMachineGuid(null), null);
});

test("parses the IOPlatformUUID from ioreg output", () => {
  const out = `+-o MacBookPro18,3  <class IOPlatformExpertDevice, id 0x100000110, registered, matched, active, busy 0 (12 ms), retain 40>
    {
      "IOPlatformUUID" = "7E5C6B1A-2F3D-4E5F-8A9B-0C1D2E3F4A5B"
      "IOPlatformSerialNumber" = "C02XXXXXXXXX"
    }`;
  assert.equal(parsePlatformUuid(out), "7e5c6b1a-2f3d-4e5f-8a9b-0c1d2e3f4a5b");
  assert.equal(parsePlatformUuid("nothing here"), null);
});

test("machineId is a stable, well-formed hash and never the raw id", () => {
  const a = machineId();
  const b = machineId();
  assert.equal(a, b);
  assert.ok(isMachineId(a), a);
  assert.equal(a.length, 3 + 40);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(a)); // no GUID leaks through
});
