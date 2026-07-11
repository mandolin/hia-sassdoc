/**
 * 将 SassDoc extraction 映射成 CSSDoc-compatible artifact。
 * Maps SassDoc extraction data into a CSSDoc-compatible artifact.
 *
 * @param {object} extraction SassDoc extraction artifact.
 * @param {{ generatedCssPath?: string, sourcesContentPolicy?: "none" | "reference" | "embed" }} [options]
 * @returns {object} CSSDoc extraction artifact.
 */
export function sassDocToCssDocExtraction(extraction, options = {}) {
  const generatedCssPath = normalizePath(options.generatedCssPath ?? "dist/style.css");
  const sourcePath = normalizePath(extraction.source?.path ?? "source.scss");
  const cssSymbols = [];

  for (const symbol of extraction.symbols ?? []) {
    if (symbol.kind === "sass-component-style") {
      cssSymbols.push({
        id: symbol.id,
        kind: "css-component-style",
        name: symbol.name,
        selector: symbol.selector,
        summary: symbol.summary,
        annotation: symbol.annotation,
        source: symbol.source
      });
    }
    if (symbol.kind === "sass-design-token") {
      cssSymbols.push({
        id: symbol.id,
        kind: "design-token",
        name: symbol.name,
        value: symbol.value,
        source: symbol.source,
        metadata: {
          cssCustomProperty: symbol.metadata?.customProperty ?? null,
          sassVariable: symbol.metadata?.variable ?? null
        }
      });
    }
  }

  return {
    contract: "cssdoc-extraction",
    contractVersion: "0.1.0-draft",
    id: `cssdoc:${sourcePath}`,
    sourcesContentPolicy: options.sourcesContentPolicy ?? extraction.sourcesContentPolicy ?? "none",
    source: {
      path: sourcePath,
      language: extraction.source?.language ?? "scss"
    },
    artifacts: [
      {
        id: `artifact:css:${slug(generatedCssPath)}`,
        kind: "generated-css",
        path: generatedCssPath,
        language: "css"
      }
    ],
    symbols: cssSymbols,
    diagnostics: [...(extraction.diagnostics ?? [])]
  };
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/");
}

function slug(value) {
  return normalizePath(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "style";
}
