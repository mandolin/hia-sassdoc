const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const sass = require("sass");

const root = path.resolve(__dirname, "..");
const fixtureRoot = path.join(root, "fixtures", "doc-source-map", "sass-css");
const sourcePath = path.join(fixtureRoot, "src", "button.scss");
const distDir = path.join(fixtureRoot, "dist");

function readSource() {
  return fs.readFileSync(sourcePath, "utf8");
}

function ensureDist() {
  fs.mkdirSync(distDir, { recursive: true });
}

function writeJson(relativePath, value) {
  fs.writeFileSync(path.join(fixtureRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function getLineRange(source, marker) {
  const lines = source.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => line.includes(marker));
  if (lineIndex === -1) {
    throw new Error(`Fixture marker not found: ${marker}`);
  }
  return {
    start: { line: lineIndex + 1, column: 1 },
    end: { line: lineIndex + 1, column: lines[lineIndex].length + 1 }
  };
}

function extractFixtureModel(source) {
  const variableMatch = source.match(/\$button-color:\s*(#[0-9a-fA-F]{6});/);
  if (!variableMatch) {
    throw new Error("Expected $button-color declaration.");
  }

  return {
    color: variableMatch[1],
    annotationRange: {
      start: { line: 1, column: 1 },
      end: { line: 6, column: 4 }
    },
    variableRange: getLineRange(source, "$button-color:"),
    selectorRange: getLineRange(source, ".button")
  };
}

function compileSassFixture() {
  const result = sass.compile(sourcePath, {
    style: "expanded",
    sourceMap: true,
    sourceMapIncludeSources: false
  });

  if (!result.sourceMap) {
    throw new Error("Dart Sass did not return a source map.");
  }

  return {
    css: ensureTrailingNewline(result.css),
    sourceMap: normalizeSassSourceMap(result.sourceMap)
  };
}

function normalizeSassSourceMap(sourceMap) {
  return {
    version: 3,
    file: "button.css",
    sources: normalizeSourceMapSources(sourceMap.sources ?? []),
    sourcesContent: [],
    names: Array.isArray(sourceMap.names) ? sourceMap.names : [],
    mappings: sourceMap.mappings ?? "",
    x_fixture_note: "Dart Sass 1.101.0 generated source map normalized for fixture path privacy."
  };
}

function normalizeSourceMapSources(sources) {
  const normalized = sources.map((source) => {
    const normalizedSource = normalizeSourceMapSource(source);
    if (normalizedSource === "../src/button.scss") {
      return normalizedSource;
    }
    throw new Error(`Unexpected Dart Sass source map source: ${source}`);
  });
  return normalized.length > 0 ? normalized : ["../src/button.scss"];
}

function normalizeSourceMapSource(source) {
  let value = String(source);
  if (value.startsWith("file:")) {
    value = fileURLToPath(value);
  }
  if (path.isAbsolute(value)) {
    return toPosix(path.relative(distDir, value));
  }
  return toPosix(value);
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function toPosix(value) {
  return value.replace(/\\/g, "/");
}

function buildCssDocArtifact(model) {
  return {
    contract: "cssdoc-extraction",
    contractVersion: "0.1.0-draft",
    id: "cssdoc:fixture:button",
    sourcesContentPolicy: "none",
    source: {
      path: "fixtures/doc-source-map/sass-css/src/button.scss",
      language: "scss"
    },
    artifacts: [
      {
        id: "artifact:css:button",
        kind: "generated-css",
        path: "fixtures/doc-source-map/sass-css/dist/button.css",
        language: "css"
      }
    ],
    symbols: [
      {
        id: "component:Button",
        kind: "css-component-style",
        name: "Button",
        selector: ".button",
        summary: "Button component style generated from a Sass source fixture.",
        annotation: {
          tag: "component",
          name: "Button",
          range: model.annotationRange
        },
        source: {
          path: "fixtures/doc-source-map/sass-css/src/button.scss",
          range: model.selectorRange,
          rangeSource: "fixture-parser",
          confidence: "high"
        }
      },
      {
        id: "token:color.button.foreground",
        kind: "design-token",
        name: "color.button.foreground",
        value: model.color,
        source: {
          path: "fixtures/doc-source-map/sass-css/src/button.scss",
          range: model.variableRange,
          rangeSource: "fixture-parser",
          confidence: "high"
        }
      }
    ],
    diagnostics: []
  };
}

function buildDocSourceMap(model) {
  return {
    contract: "doc-source-map",
    contractVersion: "0.1.0-draft",
    id: "docmap:sass-css:button",
    producer: {
      name: "@hia-doc/hia-sassdoc-workspace",
      version: "0.0.0",
      profile: "sass-css-dart-sass-fixture"
    },
    artifacts: [
      {
        id: "artifact:css:button",
        kind: "generated-css",
        path: "fixtures/doc-source-map/sass-css/dist/button.css",
        language: "css",
        role: "generated",
        contractRefs: [
          {
            contract: "cssdoc-extraction",
            path: "fixtures/doc-source-map/sass-css/dist/button.cssdoc.json"
          }
        ]
      },
      {
        id: "artifact:hia:button",
        kind: "extraction-artifact",
        path: "fixtures/doc-source-map/sass-css/dist/button.hia.json",
        language: "json",
        role: "generated"
      }
    ],
    sources: [
      {
        id: "source:scss:button",
        kind: "stylesheet-source",
        path: "fixtures/doc-source-map/sass-css/src/button.scss",
        language: "scss",
        role: "original",
        sourcesContentPolicy: "none"
      }
    ],
    sourceMaps: [
      {
        id: "sourcemap:sass-css:button",
        kind: "ordinary-source-map",
        format: "source-map-v3",
        path: "fixtures/doc-source-map/sass-css/dist/button.css.map",
        mapsFrom: "artifact:css:button",
        mapsTo: ["source:scss:button"],
        sourcesContentPolicy: "none",
        pointer: {
          status: "not-written",
          reservedExtensionField: "x_doc_source_map"
        }
      }
    ],
    chains: [
      {
        id: "chain:sass-css:button",
        stages: [
          {
            from: "source:scss:button",
            to: "artifact:css:button",
            transform: "dart-sass",
            sourceMap: "sourcemap:sass-css:button",
            linkage: ["entry:component:button", "entry:token:button-color"]
          },
          {
            from: "artifact:css:button",
            to: "artifact:hia:button",
            transform: "cssdoc-to-hia-core",
            sourceMap: null,
            linkage: ["entry:component:button"]
          }
        ]
      }
    ],
    entries: [
      {
        id: "entry:component:button",
        kind: "symbol",
        symbolKind: "css-component-style",
        symbolId: "component:Button",
        annotation: {
          tag: "component",
          name: "Button"
        },
        sourceRefs: [
          {
            sourceId: "source:scss:button",
            range: model.annotationRange,
            rangeSource: "fixture-parser",
            confidence: "high"
          }
        ],
        artifactRefs: [
          {
            artifactId: "artifact:css:button",
            selector: ".button",
            rangeSource: "adapter",
            confidence: "medium"
          }
        ],
        diagnostics: []
      },
      {
        id: "entry:token:button-color",
        kind: "design-token-link",
        symbolKind: "design-token",
        symbolId: "token:color.button.foreground",
        sourceRefs: [
          {
            sourceId: "source:scss:button",
            range: model.variableRange,
            rangeSource: "fixture-parser",
            confidence: "high"
          }
        ],
        artifactRefs: [
          {
            artifactId: "artifact:css:button",
            selector: ".button",
            property: "--button-color",
            rangeSource: "adapter",
            confidence: "medium"
          }
        ],
        diagnostics: []
      }
    ],
    privacy: {
      sourcesContentPolicy: "none",
      allowAbsolutePaths: false,
      allowUncPaths: false,
      allowPathTraversal: false,
      releaseGate: {
        requireExplicitEmbedOptIn: true,
        failOnUnsafePath: true,
        failOnUnexpectedSourcesContent: true
      }
    },
    diagnostics: []
  };
}

function buildHiaDocument(model) {
  return {
    schemaVersion: "0.2.0",
    id: "fixture.sass.button",
    title: "Sass Button Fixture",
    defaultLocale: "en",
    locales: ["en"],
    nodes: [
      {
        id: "node.css.button",
        kind: "module",
        title: "Button styles",
        symbolIds: ["component:Button", "token:color.button.foreground"],
        children: []
      }
    ],
    symbols: [
      {
        id: "component:Button",
        kind: "css-component-style",
        name: "Button",
        summary: "Button component style generated from Sass.",
        source: {
          model: "hia-source",
          modelVersion: "0.2.0",
          mode: "link",
          definedIn: {
            kind: "defined-in",
            relativePath: "fixtures/doc-source-map/sass-css/src/button.scss",
            language: "scss",
            position: model.selectorRange.start,
            range: model.selectorRange,
            link: {
              enabled: false,
              openMode: "same-tab"
            }
          },
          primaryBlock: null,
          references: [],
          fragments: [],
          diagnostics: []
        }
      },
      {
        id: "token:color.button.foreground",
        kind: "design-token",
        name: "color.button.foreground",
        summary: "Foreground color token for the Button component.",
        metadata: {
          cssCustomProperty: "--button-color",
          value: model.color
        },
        source: {
          model: "hia-source",
          modelVersion: "0.2.0",
          mode: "link",
          definedIn: {
            kind: "defined-in",
            relativePath: "fixtures/doc-source-map/sass-css/src/button.scss",
            language: "scss",
            position: model.variableRange.start,
            range: model.variableRange,
            link: {
              enabled: false,
              openMode: "same-tab"
            }
          },
          primaryBlock: null,
          references: [],
          fragments: [],
          diagnostics: []
        }
      }
    ],
    diagnostics: [],
    metadata: {
      fixture: "sass-css-doc-source-map",
      docSourceMaps: [
        {
          contract: "doc-source-map",
          contractVersion: "0.1.0-draft",
          path: "fixtures/doc-source-map/sass-css/dist/button.docmap.json",
          entryArtifact: "fixtures/doc-source-map/sass-css/dist/button.css"
        }
      ]
    }
  };
}

function main() {
  ensureDist();
  const source = readSource();
  const model = extractFixtureModel(source);
  const compiled = compileSassFixture();
  fs.writeFileSync(path.join(distDir, "button.css"), compiled.css);
  writeJson("dist/button.css.map", compiled.sourceMap);
  writeJson("dist/button.cssdoc.json", buildCssDocArtifact(model));
  writeJson("dist/button.docmap.json", buildDocSourceMap(model));
  writeJson("dist/button.hia.json", buildHiaDocument(model));
  console.log("SassDoc Dart Sass fixture artifacts generated.");
}

main();
