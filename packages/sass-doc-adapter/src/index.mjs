/**
 * 将 SassDoc extraction 转换为 HIA core document。
 * Converts a SassDoc extraction artifact into a HIA core document.
 *
 * @param {object} extraction SassDoc extraction artifact.
 * @param {{ id?: string, title?: string, docSourceMapPath?: string }} [options]
 * @returns {object} HIA core document.
 */
export function sassExtractionToHiaDocument(extraction, options = {}) {
  const sourcePath = normalizePath(extraction.source?.path ?? "source.scss");
  const symbols = (extraction.symbols ?? []).map((symbol) => toHiaSymbol(symbol, sourcePath));

  return {
    schemaVersion: "0.2.0",
    id: options.id ?? `sassdoc:${sourcePath}`,
    title: options.title ?? "SassDoc",
    defaultLocale: "en",
    locales: ["en"],
    nodes: [
      {
        id: "node.sassdoc",
        kind: "module",
        title: "SassDoc",
        symbolIds: symbols.map((symbol) => symbol.id),
        children: []
      }
    ],
    symbols,
    diagnostics: [...(extraction.diagnostics ?? [])],
    metadata: {
      source: "sassdoc",
      ...(options.docSourceMapPath ? {
        docSourceMaps: [
          {
            contract: "doc-source-map",
            contractVersion: "0.1.0-draft",
            path: normalizePath(options.docSourceMapPath),
            entryArtifact: null
          }
        ]
      } : {})
    }
  };
}

function toHiaSymbol(symbol, sourcePath) {
  const range = symbol.source?.range ?? symbol.annotation?.range ?? null;
  return {
    id: symbol.id,
    kind: symbol.kind === "sass-design-token" ? "design-token" : "css-component-style",
    name: symbol.name,
    summary: symbol.summary ?? (symbol.kind === "sass-design-token" ? `Sass design token ${symbol.name}.` : `Sass component style ${symbol.name}.`),
    metadata: {
      sassdoc: {
        kind: symbol.kind,
        selector: symbol.selector ?? null,
        customProperty: symbol.metadata?.customProperty ?? null,
        variable: symbol.metadata?.variable ?? null,
        value: symbol.value ?? null
      }
    },
    source: {
      model: "hia-source",
      modelVersion: "0.2.0",
      mode: "link",
      definedIn: {
        kind: "defined-in",
        relativePath: sourcePath,
        language: "scss",
        position: range?.start ?? { line: 1, column: 1 },
        range,
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
  };
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/");
}
