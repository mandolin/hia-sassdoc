/**
 * 生成 Sass -> CSS -> HIA 的 documentation source map manifest。
 * Creates a documentation source map manifest for Sass -> CSS -> HIA linkage.
 *
 * @param {object} options Source, artifact and extraction references.
 * @returns {object} doc-source-map manifest.
 */
export function createSassToCssDocumentationSourceMap(options = {}) {
  const sourcePath = normalizePath(options.sourcePath ?? options.sassExtraction?.source?.path ?? "source.scss");
  const cssPath = normalizePath(options.cssPath ?? "dist/style.css");
  const cssSourceMapPath = normalizePath(options.cssSourceMapPath ?? `${cssPath}.map`);
  const cssDocPath = normalizePath(options.cssDocPath ?? "dist/style.cssdoc.json");
  const hiaDocumentPath = normalizePath(options.hiaDocumentPath ?? "dist/style.hia.json");
  const sourcesContentPolicy = options.sourcesContentPolicy ?? "none";
  const entries = [];

  for (const symbol of options.sassExtraction?.symbols ?? []) {
    entries.push({
      id: `entry:${slug(symbol.id)}`,
      kind: symbol.kind === "sass-design-token" ? "design-token-link" : "symbol",
      symbolKind: symbol.kind === "sass-design-token" ? "design-token" : "css-component-style",
      symbolId: symbol.id,
      sourceRefs: [
        {
          sourceId: "source:sass:primary",
          range: symbol.source?.range ?? symbol.annotation?.range ?? null,
          rangeSource: symbol.source?.rangeSource ?? "sassdoc-parser",
          confidence: symbol.source?.confidence ?? "medium"
        }
      ],
      artifactRefs: [
        {
          artifactId: "artifact:css:primary",
          selector: symbol.selector ?? null,
          property: symbol.metadata?.customProperty ?? null,
          rangeSource: "adapter",
          confidence: "medium"
        }
      ],
      diagnostics: []
    });
  }

  return {
    contract: "doc-source-map",
    contractVersion: "0.1.0-draft",
    id: `docmap:sass-css:${slug(sourcePath)}`,
    producer: {
      name: "@hia-doc/sassdoc-runner",
      version: options.producerVersion ?? "0.0.0",
      profile: "sass-css-dart-sass"
    },
    artifacts: [
      {
        id: "artifact:css:primary",
        kind: "generated-css",
        path: cssPath,
        language: "css",
        role: "generated",
        contractRefs: [
          {
            contract: "cssdoc-extraction",
            path: cssDocPath
          }
        ]
      },
      {
        id: "artifact:hia:primary",
        kind: "extraction-artifact",
        path: hiaDocumentPath,
        language: "json",
        role: "generated"
      }
    ],
    sources: [
      {
        id: "source:sass:primary",
        kind: "stylesheet-source",
        path: sourcePath,
        language: options.language ?? "scss",
        role: "original",
        sourcesContentPolicy
      }
    ],
    sourceMaps: [
      {
        id: "sourcemap:sass-css:primary",
        kind: "ordinary-source-map",
        format: "source-map-v3",
        path: cssSourceMapPath,
        mapsFrom: "artifact:css:primary",
        mapsTo: ["source:sass:primary"],
        sourcesContentPolicy,
        pointer: {
          status: "not-written",
          reservedExtensionField: "x_doc_source_map"
        }
      }
    ],
    chains: [
      {
        id: "chain:sass-css:primary",
        stages: [
          {
            from: "source:sass:primary",
            to: "artifact:css:primary",
            transform: "dart-sass",
            sourceMap: "sourcemap:sass-css:primary",
            linkage: entries.map((entry) => entry.id)
          },
          {
            from: "artifact:css:primary",
            to: "artifact:hia:primary",
            transform: "sassdoc-to-hia-core",
            sourceMap: null,
            linkage: entries.filter((entry) => entry.kind === "symbol").map((entry) => entry.id)
          }
        ]
      }
    ],
    entries,
    privacy: {
      sourcesContentPolicy,
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

function normalizePath(value) {
  return String(value).replaceAll("\\", "/");
}

function slug(value) {
  return normalizePath(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "entry";
}
