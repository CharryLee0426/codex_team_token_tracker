"use strict";
/**
 * A stand-in for `node:test`, which does not exist before Node 18.
 *
 * The upstream suites are plain `test("name", fn)` calls asserting with `node:assert/strict` (which
 * Node 16 *does* have), so this only needs to collect the callbacks, run them in order, and report.
 * esbuild maps `node:test` onto this file when bundling the tests for the Node 16 run, which lets us
 * execute the project's real tests on a real Node 16 instead of trusting that they would pass.
 */
const tests = [];
let scheduled = false;

function test(name, fn) {
  if (typeof name === "function") {
    fn = name;
    name = fn.name || "(anonymous)";
  }
  // A test with no body is how node:test marks a TODO; treat it as skipped rather than a pass.
  tests.push({ name, fn: typeof fn === "function" ? fn : null });
  schedule();
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  // Let every test file finish registering before the first one runs.
  setImmediate(run);
}

async function run() {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const t of tests) {
    if (!t.fn) {
      skipped++;
      console.log(`- SKIP ${t.name}`);
      continue;
    }
    try {
      await t.fn({ name: t.name, diagnostic() {}, skip() {} });
      passed++;
      console.log(`✓ ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`✗ ${t.name}`);
      console.log(String((err && err.stack) || err).replace(/^/gm, "    "));
    }
  }
  console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""} (node ${process.versions.node})`);
  if (failed) process.exitCode = 1;
}

test.test = test;
test.default = test;
test.describe = (name, fn) => fn && fn();
test.it = test;
test.before = (fn) => fn && fn();
test.beforeEach = () => {};
test.after = () => {};
test.afterEach = () => {};
test.skip = (name) => test(name, null);
test.todo = (name) => test(name, null);
test.mock = undefined;

module.exports = test;
module.exports.test = test;
