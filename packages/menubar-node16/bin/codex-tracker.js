#!/usr/bin/env node
"use strict";
// Kept to ES5 syntax on purpose: this file has to parse on whatever ancient Node the user typed the
// command with, so that a too-old runtime produces the message below instead of a SyntaxError.
var v = process.versions.node.split(".");
var major = parseInt(v[0], 10);
var minor = parseInt(v[1], 10);
if (major < 16 || (major === 16 && minor < 8)) {
  console.error(
    "codex-token-tracker-nodejs16 requires Node >= 16.8 (this is Node " +
      process.versions.node +
      ").\nNode 16.8 is the first release its bundled fetch implementation supports; 16.20.2 is the last 16.x."
  );
  process.exit(1);
}
// dist/cli.js begins by requiring dist/node16-polyfill.js (injected as an esbuild banner), which
// installs fetch and the other web globals Node 16 lacks before any application code runs.
require("../dist/cli.js");
