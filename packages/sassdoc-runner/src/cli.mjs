#!/usr/bin/env node

import path from "node:path";
import { parseArgs } from "node:util";

import {
  SASSDOC_RUNNER_VERSION,
  inferSassDocInputKind,
  loadSassDocConfig,
  runSassDoc
} from "./index.mjs";

const { values, positionals } = parseArgs({
  options: {
    config: { type: "string", short: "c" },
    help: { type: "boolean", short: "h" },
    kind: { type: "string", short: "k" },
    "no-css-source-map": { type: "boolean" },
    "no-doc-source-map": { type: "boolean" },
    "out-dir": { type: "string", short: "o" },
    "sass-style": { type: "string" },
    "sources-content-policy": { type: "string" },
    version: { type: "boolean", short: "v" },
    "workspace-root": { type: "string" }
  },
  allowPositionals: true,
  strict: true
});

if (values.help) {
  process.stdout.write(`SassDoc ${SASSDOC_RUNNER_VERSION}\n\nUsage:\n  sassdoc --config sassdoc.config.json\n  sassdoc [options] <input...>\n\nOptions:\n  -c, --config <path>\n  -k, --kind <scss|sass>\n  -o, --out-dir <path>\n      --workspace-root <path>\n      --sources-content-policy <none|reference|embed>\n      --sass-style <expanded|compressed>\n      --no-css-source-map\n      --no-doc-source-map\n  -v, --version\n`);
  process.exit(0);
}

if (values.version) {
  process.stdout.write(`${SASSDOC_RUNNER_VERSION}\n`);
  process.exit(0);
}

try {
  const request = values.config
    ? await loadSassDocConfig(values.config)
    : createCliRequest(values, positionals);

  if (values["out-dir"]) {
    request.outputDirectory = path.resolve(request.workspaceRoot, values["out-dir"]);
  }
  if (values["sources-content-policy"]) {
    request.options.sourcesContentPolicy = values["sources-content-policy"];
  }
  if (values["sass-style"]) {
    request.options.sassStyle = values["sass-style"];
  }
  if (values["no-css-source-map"]) {
    request.options.emitCssSourceMap = false;
  }
  if (values["no-doc-source-map"]) {
    request.options.emitDocSourceMap = false;
  }

  const result = await runSassDoc(request);
  process.stdout.write(`SassDoc ${result.status}: ${result.artifacts.length} artifact(s).\n`);
  process.exitCode = result.status === "success" ? 0 : 1;
} catch (error) {
  process.stderr.write(`SassDoc failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function createCliRequest(cliValues, inputs) {
  if (inputs.length === 0) {
    throw new TypeError("At least one input or --config is required.");
  }
  const workspaceRoot = path.resolve(process.cwd(), cliValues["workspace-root"] ?? ".");
  return {
    workspaceRoot,
    outputDirectory: path.resolve(workspaceRoot, cliValues["out-dir"] ?? "dist/sassdoc"),
    inputs: inputs.map((inputPath) => ({
      kind: cliValues.kind ?? inferSassDocInputKind(inputPath),
      path: inputPath
    })),
    options: {
      emitCssSourceMap: !cliValues["no-css-source-map"],
      emitDocSourceMap: !cliValues["no-doc-source-map"],
      sourcesContentPolicy: cliValues["sources-content-policy"] ?? "none",
      sassStyle: cliValues["sass-style"] ?? "expanded",
      writeResultManifest: true
    }
  };
}
