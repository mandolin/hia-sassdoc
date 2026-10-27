const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const fixtureRoot = path.join(root, "fixtures", "doc-source-map", "sass-css");
const distDir = path.join(fixtureRoot, "dist");

const jsonFiles = [
  "button.css.map",
  "button.cssdoc.json",
  "button.docmap.json",
  "button.hia.json"
];

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(distDir, name), "utf8"));
}

function assertSafeRelativePath(value) {
  assert.equal(typeof value, "string", `Expected path string, got ${typeof value}`);
  assert.equal(path.isAbsolute(value), false, `Path must not be absolute: ${value}`);
  assert.equal(value.startsWith("\\\\"), false, `Path must not be UNC: ${value}`);
  assert.equal(value.split(/[\\/]/).includes(".."), false, `Path must not escape workspace: ${value}`);
}

function assertNoSourcesContent(map) {
  assert.ok(Array.isArray(map.sourcesContent), "Source map fixture must declare sourcesContent array.");
  assert.equal(map.sourcesContent.length, 0, "Source map fixture must not embed source content.");
}

function main() {
  const css = fs.readFileSync(path.join(distDir, "button.css"), "utf8");
  assert.match(css, /\.button \{/);
  assert.match(css, /--button-color: #0f766e;/);

  for (const file of jsonFiles) {
    assert.ok(fs.existsSync(path.join(distDir, file)), `Missing fixture artifact: ${file}`);
  }

  const ordinaryMap = readJson("button.css.map");
  assert.equal(ordinaryMap.version, 3);
  assert.deepEqual(ordinaryMap.sources, ["../src/button.scss"]);
  assert.notEqual(ordinaryMap.mappings, "", "Dart Sass source map mappings must not be empty.");
  assert.equal(Object.hasOwn(ordinaryMap, "x_doc_source_map"), false);
  assertNoSourcesContent(ordinaryMap);

  const cssdoc = readJson("button.cssdoc.json");
  assert.equal(cssdoc.contract, "cssdoc-extraction");
  assert.equal(cssdoc.contractVersion, "0.1.0-draft");
  assert.equal(cssdoc.sourcesContentPolicy, "none");
  assertSafeRelativePath(cssdoc.source.path);
  assert.ok(cssdoc.symbols.some((symbol) => symbol.id === "component:Button"));

  const docmap = readJson("button.docmap.json");
  assert.equal(docmap.contract, "doc-source-map");
  assert.equal(docmap.contractVersion, "1.1.0");
  assert.equal(docmap.producer.profile, "sass-css-dart-sass");
  assert.equal(docmap.privacy.sourcesContentPolicy, "none");
  assert.equal(docmap.sourceMaps[0].pointer.status, "not-written");
  assert.equal(docmap.sourceMaps[0].pointer.reservedExtensionField, "x_doc_source_map");
  assert.equal(docmap.chains[0].stages[0].transform, "dart-sass");
  for (const source of docmap.sources) {
    assertSafeRelativePath(source.path);
    assert.equal(source.sourcesContentPolicy, "none");
  }
  for (const artifact of docmap.artifacts) {
    assertSafeRelativePath(artifact.path);
  }
  assert.ok(docmap.entries.some((entry) => entry.kind === "design-token-link"));
  for (const entry of docmap.entries) {
    for (const ref of entry.sourceRefs) {
      // <lang><zh-CN>组件规则跨行，行扫描只给首行线索；独立单行变量仍可证明半开 UTF-16 范围。</zh-CN><en>The component rule spans lines, so its scanned first line is only a hint; the standalone one-line variable remains verified as half-open UTF-16.</en></lang>
      assert.deepEqual(ref.rangeConvention, entry.symbolId === "component:Button"
        ? { endBoundary: "unknown", columnUnit: "unknown" }
        : { endBoundary: "exclusive", columnUnit: "utf16-code-unit" });
      assert.equal(ref.rangeSource, "parser");
      assert.equal(ref.rangeSourceDetail, "sassdoc-parser");
    }
  }

  const hia = readJson("button.hia.json");
  assert.equal(hia.schemaVersion, "0.2.0");
  assert.ok(hia.symbols.some((symbol) => symbol.id === "component:Button"));
  assert.ok(hia.metadata.docSourceMaps[0].path.endsWith("button.docmap.json"));
  assert.equal(hia.metadata.docSourceMaps[0].contractVersion, "1.1.0");

  console.log("SassDoc fixture check passed.");
}

main();
