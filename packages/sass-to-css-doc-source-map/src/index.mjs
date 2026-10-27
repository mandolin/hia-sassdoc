/** @file @lang zh-CN Sass/CSS文档映射生成，逐引用声明已证或未知的源码范围约定。 @lang en Sass/CSS documentation-map generation with verified or unknown per-reference source range conventions. */
/**
 * @lang zh-CN 生成Sass/CSS/HIA声明映射；路径保持相对，默认不嵌入源码正文，不读取普通map。外部旧提取结果缺少范围约定时显式标为未知。
 * @lang en Generates Sass/CSS/HIA declaration links with relative paths and no embedded source by default, without reading ordinary maps. Legacy external extractions without range evidence are explicitly unknown.
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
    // <lang><zh-CN>范围与CSS选择器均为可选；逐项归一来源类别，并且仅随范围写入约定。</zh-CN><en>Ranges and CSS selectors are optional; normalize provenance per reference and emit conventions only with ranges.</en></lang>
    const sourceRange = symbol.source?.range;
    const range = sourceRange ?? symbol.annotation?.range;
    const selector = symbol.selector;
    const provenance = sourceRange == null && range != null
      ? { rangeSource: "adapter", rangeSourceDetail: "external-annotation" }
      : normalizeSourceProvenance(symbol.source?.rangeSource);
    entries.push({
      id: `entry:${slug(symbol.id)}`,
      kind: symbol.kind === "sass-design-token" ? "design-token-link" : "symbol",
      symbolKind: symbol.kind === "sass-design-token" ? "design-token" : "css-component-style",
      symbolId: symbol.id,
      sourceRefs: [
        {
          sourceId: "source:sass:primary",
          ...(range != null ? { range } : {}),
          ...(range != null ? { rangeConvention: normalizeRangeConvention(sourceRange == null ? undefined : symbol.source?.rangeConvention, range) } : {}),
          ...provenance,
          confidence: provenance.rangeSource === "unresolved" ? "none" : symbol.source?.confidence ?? "medium"
        }
      ],
      artifactRefs: [
        {
          artifactId: "artifact:css:primary",
          ...(typeof selector === "string" && selector.length > 0 ? { selector } : {}),
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
    contractVersion: "1.1.0",
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

/**
 * @lang zh-CN 将 Sass 提取器的旧来源标签映射为 1.1.0 的通用类别，并保留已知细节。未知外部标签只表示适配器输入。
 * @lang en Maps legacy Sass extractor origin labels to the 1.1.0 generic categories while retaining known detail. Unknown external labels indicate adapter input only.
 * @param {unknown} value 提取结果的来源标签；Extractor origin label.
 * @returns {{rangeSource:string,rangeSourceDetail?:string}} 可写入映射的来源；Map-safe provenance.
 */
function normalizeSourceProvenance(value) {
  // <lang><zh-CN>来源名称不提供范围端点证据；这里只转换类别，范围约定由独立字段处理。</zh-CN><en>An origin label supplies no endpoint evidence; this converts only provenance while a separate field handles range conventions.</en></lang>
  if (value === "sassdoc-parser" || value === "annotation") {
    return { rangeSource: "parser", rangeSourceDetail: value };
  }
  if (["source-map", "parser", "compiler", "adapter", "manual", "heuristic", "unresolved"].includes(value)) {
    return { rangeSource: value };
  }
  return { rangeSource: "adapter", rangeSourceDetail: "external-extraction" };
}

/**
 * @lang zh-CN 复制逐引用证据；旧版或外部提取结果未声明时明确未知，拒绝非法/缺列的精确声明。
 * @lang en Copies per-reference evidence; missing legacy or external declarations become unknown, while invalid or columnless precise claims are rejected.
 * @param {unknown} value 来源引用提供的约定；Convention supplied by the source reference.
 * @param {object} range 带起止位置的范围；Range with start and end positions.
 * @returns {{endBoundary:"inclusive"|"exclusive"|"unknown",columnUnit:"utf16-code-unit"|"unicode-code-point"|"byte"|"unknown"}} 可写入 1.1.0 的约定；Convention valid for 1.1.0.
 * @throws {TypeError} 显式证据不合法或列精度不足；Explicit evidence is invalid or lacks required columns.
 */
function normalizeRangeConvention(value, range) {
  if (value == null) {
    return { endBoundary: "unknown", columnUnit: "unknown" };
  }
  // <lang><zh-CN>只接受两个标准字段，避免外部输入中的扩展被静默丢失或误当作已核证据。</zh-CN><en>Accept exactly the two standard fields so external extensions are neither silently lost nor mistaken for verified evidence.</en></lang>
  if (typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 2
    || !["inclusive", "exclusive", "unknown"].includes(value.endBoundary)
    || !["utf16-code-unit", "unicode-code-point", "byte", "unknown"].includes(value.columnUnit)
    || (value.columnUnit !== "unknown"
      && (!Number.isSafeInteger(range?.start?.column) || !Number.isSafeInteger(range?.end?.column)))) {
    throw new TypeError("Invalid Sass source rangeConvention evidence");
  }
  return { endBoundary: value.endBoundary, columnUnit: value.columnUnit };
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/");
}

function slug(value) {
  return normalizePath(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "entry";
}
