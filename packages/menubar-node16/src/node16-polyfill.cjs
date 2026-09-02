"use strict";
/**
 * Node 16 runtime shims for codex-token-tracker-nodejs16.
 *
 * This file is prepended (via an esbuild `banner`) to every Node-side bundle, so it runs before a
 * single line of application or vendored code is evaluated. That ordering matters: libraries we
 * bundle (Convex's HTTP client, `ws`) capture globals at module scope.
 *
 * Everything here is installed **only when missing**, so the exact same bundle runs unchanged on
 * Node 18/20/22 and inside Electron (whose main process already ships a modern Node). On those
 * runtimes this file is a no-op.
 *
 * What Node 16.15 is missing, and where we source the replacement:
 *   fetch / Headers / Request / Response / FormData / File  → undici (Node 18's fetch *is* undici)
 *   Blob                                                    → node:buffer   (present since 16.7)
 *   ReadableStream / WritableStream / TransformStream       → node:stream/web (present since 16.5)
 *   crypto (WebCrypto global)                               → node:crypto webcrypto
 *   structuredClone                                         → node:v8 serialize/deserialize
 *
 * Deliberately NOT polyfilled: Array.prototype.findLast/findLastIndex and friends. Nothing in the
 * bundle uses them (verified against the built output), and patching Array.prototype is the one
 * change that could perturb unrelated code. If a future dependency needs them, add them here.
 */

/** Define a global only if the runtime does not already provide it. */
function provide(name, factory) {
  if (typeof globalThis[name] !== "undefined") return false;
  let value;
  try {
    value = factory();
  } catch (err) {
    return err;
  }
  if (value === undefined || value === null) return false;
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
  return true;
}

// ---------------------------------------------------------------------------
// fetch and its companion classes
// ---------------------------------------------------------------------------
if (typeof globalThis.fetch === "undefined") {
  let undici;
  try {
    undici = require("undici");
  } catch (err) {
    throw new Error(
      "codex-token-tracker-nodejs16 needs a `fetch` implementation on Node " +
        process.versions.node +
        ", but the bundled `undici` dependency could not be loaded (" +
        (err && err.message ? err.message : String(err)) +
        ").\n" +
        "Reinstall the package (`npm install -g codex-token-tracker-nodejs16`), or upgrade to Node 18+ where fetch is built in."
    );
  }
  if (typeof undici.fetch !== "function") {
    throw new Error(
      "codex-token-tracker-nodejs16: the installed `undici` does not export fetch. Node >= 16.8 is required; this process is Node " +
        process.versions.node +
        "."
    );
  }
  // undici's fetch reads `globalThis.fetch`-adjacent classes off its own module, so installing the
  // whole family together keeps instanceof checks (e.g. `res instanceof Response`) coherent.
  Object.defineProperty(globalThis, "fetch", {
    value: function fetch(input, init) {
      return undici.fetch(input, init);
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
  for (const name of ["Headers", "Request", "Response", "FormData", "File", "FileReader"]) {
    if (undici[name]) provide(name, () => undici[name]);
  }
}

// ---------------------------------------------------------------------------
// Web platform globals that Node only exposed later. Present on Node 18+, so these are the
// difference between "Node 16 behaves like Node 20" and "Node 16 quietly takes a different branch".
// ---------------------------------------------------------------------------
provide("Blob", () => require("buffer").Blob);

for (const name of ["ReadableStream", "WritableStream", "TransformStream", "ByteLengthQueuingStrategy", "CountQueuingStrategy"]) {
  provide(name, () => require("stream/web")[name]);
}

provide("crypto", () => require("crypto").webcrypto);

provide("structuredClone", () => {
  const v8 = require("v8");
  return function structuredClone(value) {
    return v8.deserialize(v8.serialize(value));
  };
});

module.exports = {};
