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
  const defaultLocale = options.defaultLocale ?? extraction.defaultLocale ?? "en";

  return {
    schemaVersion: "0.2.0",
    id: options.id ?? `sassdoc:${sourcePath}`,
    title: options.title ?? "SassDoc",
    defaultLocale,
    locales: collectDocumentLocales(options.locales, extraction.locales, symbols, defaultLocale),
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
  const mapped = {
    id: symbol.id,
    kind: symbol.kind === "sass-design-token" ? "design-token" : "css-component-style",
    name: symbol.name,
    summary: symbol.i18n?.fields?.description?.defaultText ?? symbol.summary ?? (symbol.kind === "sass-design-token" ? `Sass design token ${symbol.name}.` : `Sass component style ${symbol.name}.`),
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
  if (symbol.i18n) {
    mapped.i18n = symbol.i18n;
  }
  return mapped;
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/");
}

function collectDocumentLocales(optionLocales, artifactLocales, symbols, defaultLocale) {
  const locales = [
    defaultLocale,
    ...(Array.isArray(optionLocales) ? optionLocales : []),
    ...(Array.isArray(artifactLocales) ? artifactLocales : [])
  ];
  for (const symbol of symbols) {
    locales.push(...(Array.isArray(symbol.i18n?.locales) ? symbol.i18n.locales : []));
  }
  return [...new Set(locales.map((locale) => normalizeLocale(locale)).filter(Boolean))];
}

function normalizeLocale(value) {
  const locale = String(value ?? "").trim().replace(/_/g, "-");
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale : "";
}
