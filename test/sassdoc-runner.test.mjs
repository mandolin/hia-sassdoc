import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SASSDOC_CONFIG_SCHEMA_ID,
  SASSDOC_CONFIG_SCHEMA_VERSION,
  inferSassDocInputKind,
  loadSassDocConfig,
  runSassDoc
} from "../packages/sassdoc-runner/src/index.mjs";
import { sassdocProducer } from "../packages/sassdoc-producer/src/index.mjs";

const source = `/**
 * @component Button
 * @selector .button
 * @token color.button.foreground
 * @custom-property --button-color
 */
$button-color: #0f766e;

.button {
  --button-color: #{$button-color};
}
`;

test("runSassDoc emits producer result artifacts", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-"));
  try {
    await writeFile(path.join(workspaceRoot, "button.scss"), source, "utf8");
    const result = await runSassDoc({
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, "dist"),
      inputs: [{ kind: "scss", path: "button.scss", artifactBasePath: "button" }],
      options: { writeResultManifest: true }
    });

    assert.equal(result.contract, "documentation-producer-result");
    assert.equal(result.status, "success");
    assert.equal(result.artifacts.length, 6);
    assert.ok(result.artifacts.some((artifact) => artifact.kind === "sassdoc-extraction"));
    assert.ok(result.artifacts.some((artifact) => artifact.kind === "doc-source-map"));

    const hia = JSON.parse(await readFile(path.join(workspaceRoot, "dist", "button.hia.json"), "utf8"));
    assert.ok(hia.symbols.some((symbol) => symbol.id === "component:Button"));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("loadSassDocConfig normalizes versioned JSON config", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-config-"));
  try {
    await writeFile(path.join(workspaceRoot, "button.scss"), source, "utf8");
    await writeFile(path.join(workspaceRoot, "sassdoc.config.json"), `${JSON.stringify({
      $schema: SASSDOC_CONFIG_SCHEMA_ID,
      schemaVersion: SASSDOC_CONFIG_SCHEMA_VERSION,
      workspaceRoot: ".",
      outputDirectory: "dist",
      inputs: [{ kind: "scss", path: "button.scss" }]
    }, null, 2)}\n`, "utf8");

    const request = await loadSassDocConfig("sassdoc.config.json", { cwd: workspaceRoot });
    assert.equal(request.inputs[0].path, "button.scss");
    assert.equal(request.options.sourcesContentPolicy, "none");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("sassdoc producer delegates to the runner", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-producer-"));
  try {
    await writeFile(path.join(workspaceRoot, "button.scss"), source, "utf8");
    const result = await sassdocProducer.produce({
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, "dist"),
      inputs: [{ kind: "scss", path: "button.scss" }]
    });
    assert.equal(sassdocProducer.descriptor.contract, "documentation-producer");
    assert.equal(result.status, "success");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("inferSassDocInputKind recognizes indented Sass", () => {
  assert.equal(inferSassDocInputKind("styles/card.sass"), "sass");
  assert.equal(inferSassDocInputKind("styles/card.scss"), "scss");
});
