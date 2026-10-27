import {
  SASSDOC_EXTRACTION_CONTRACT,
  SASSDOC_EXTRACTION_CONTRACT_VERSION
} from "@hia-doc/sassdoc-spec";

const DEFAULT_LOCALE = "en";
const HIA_TEXT_I18N_MODEL = "hia-text-i18n";
const HIA_TEXT_I18N_MODEL_VERSION = "0.2.0";
const OFFSET_RANGE_CONVENTION = Object.freeze({ endBoundary: "exclusive", columnUnit: "utf16-code-unit" });
const UNCERTAIN_RANGE_CONVENTION = Object.freeze({ endBoundary: "unknown", columnUnit: "unknown" });

/**
 * @lang zh-CN 从 Sass/SCSS 源码提取 SassDoc 工件；简单规则的精确范围止于自身右括号，无法核实的语法保留未知坐标约定。
 * @lang en Extracts a SassDoc artifact from Sass/SCSS; a verified plain rule ends at its own closing brace, while uncertain syntax keeps unknown coordinate semantics.
 * @param {string} source Sass/SCSS 源码文本；Sass/SCSS source text.
 * @param {{ path?: string, language?: string, sourcesContentPolicy?: "none" | "reference" | "embed" }} [options] 来源路径、语言及内容策略；Source path, language, and content policy.
 * @returns {object} SassDoc 提取工件；SassDoc extraction artifact.
 */
export function extractSassDoc(source, options = {}) {
  const path = normalizePath(options.path ?? "source.scss");
  const language = options.language ?? inferSassLanguage(path);
  const defaultLocale = normalizeLocale(options.defaultLocale) || DEFAULT_LOCALE;
  const parsedBlocks = parseDocumentationBlocks(source);
  const variables = parseVariables(source);
  const symbols = [];
  const diagnostics = [];

  for (const block of parsedBlocks) {
    const componentName = firstTagValue(block.tags, "component");
    if (!componentName) {
      continue;
    }

    const selector = firstTagValue(block.tags, "selector") ?? `.${componentName}`;
    const tokenName = firstTagValue(block.tags, "token");
    const customProperty = firstTagValue(block.tags, "custom-property");
    const summary = firstSummary(block.description, `Sass component style for ${componentName}.`);
    const i18n = createDescriptionI18n(summary, block.tags, defaultLocale, "sassdoc.comment");
    // <lang><zh-CN>只在注释结束后查找选择器规则；缺失时保留注释位置及其较低置信度。</zh-CN><en>Search for a selector rule only after the annotation; preserve the annotation location and lower confidence when no rule is found.</en></lang>
    const selectorRange = findLineRange(source, selector, block.range.end);
    // <lang><zh-CN>行扫描只定位候选；简单规则须另核其闭括号，不能把同行后继规则纳入已证范围。</zh-CN><en>The line scan only finds a candidate; a plain rule needs its own closing brace before its range can be verified.</en></lang>
    const verifiedSelectorRange = selectorRange ? findPlainSelectorRuleRange(source, selector, selectorRange) : null;

    symbols.push({
      id: `component:${componentName}`,
      kind: "sass-component-style",
      name: componentName,
      selector,
      summary: i18n?.fields.description?.defaultText ?? summary,
      ...(i18n ? { i18n } : {}),
      annotation: {
        tag: "component",
        name: componentName,
        range: block.range
      },
      source: {
        path,
        range: verifiedSelectorRange ?? selectorRange ?? block.range,
        // <lang><zh-CN>简单规则和注释范围有已核实的坐标约定；复杂选择器仍只作为待核线索。</zh-CN><en>Plain rules and comment ranges have verified coordinates; complex selectors remain unverified hints.</en></lang>
        rangeConvention: selectorRange && !verifiedSelectorRange
          ? { ...UNCERTAIN_RANGE_CONVENTION }
          : { ...OFFSET_RANGE_CONVENTION },
        rangeSource: selectorRange ? "sassdoc-parser" : "annotation",
        confidence: selectorRange ? "high" : "medium"
      },
      metadata: {
        customProperty: customProperty ?? null
      }
    });

    if (tokenName) {
      const tokenVariable = matchTokenVariable(tokenName, variables) ?? variables[0];
      symbols.push({
        id: `token:${tokenName}`,
        kind: "sass-design-token",
        name: tokenName,
        value: tokenVariable?.value ?? null,
        source: {
          path,
          range: tokenVariable?.range ?? block.range,
          // <lang><zh-CN>单行顶层变量使用源码偏移；复杂或未核变量保留未知约定，注释回退仍是已知半开范围。</zh-CN><en>A simple top-level variable uses source offsets; complex or unverified variables remain unknown, while comment fallback is a known half-open range.</en></lang>
          rangeConvention: tokenVariable?.rangeConvention ?? { ...OFFSET_RANGE_CONVENTION },
          rangeSource: tokenVariable ? "sassdoc-parser" : "annotation",
          confidence: tokenVariable ? "high" : "medium"
        },
        metadata: {
          customProperty: customProperty ?? null,
          variable: tokenVariable?.name ?? null
        }
      });
    }
  }

  if (symbols.length === 0) {
    diagnostics.push({
      code: "SASSDOC_COMPONENT_NOT_FOUND",
      message: "No @component SassDoc annotation was found.",
      severity: "warning",
      path
    });
  }

  return {
    contract: SASSDOC_EXTRACTION_CONTRACT,
    contractVersion: SASSDOC_EXTRACTION_CONTRACT_VERSION,
    id: `sassdoc:${path}`,
    defaultLocale,
    locales: collectLocales([defaultLocale, ...symbols.flatMap((symbol) => symbol.i18n?.locales ?? [])]),
    sourcesContentPolicy: options.sourcesContentPolicy ?? "none",
    source: {
      path,
      language
    },
    symbols,
    diagnostics
  };
}

function parseDocumentationBlocks(source) {
  const blocks = [];
  const pattern = /\/\*\*([\s\S]*?)\*\//g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const raw = match[1];
    blocks.push({
      description: parseDescription(raw),
      tags: parseTags(raw),
      range: offsetRange(source, match.index, match.index + match[0].length)
    });
  }
  return blocks;
}

function parseTags(rawBlock) {
  const tags = [];
  for (const line of rawBlock.split(/\r?\n/)) {
    const cleaned = line.replace(/^\s*\*\s?/, "").trim();
    const tag = cleaned.match(/^@([a-zA-Z][\w-]*)\s*(.*)$/);
    if (tag) {
      tags.push({ tag: tag[1], value: tag[2].trim() });
    }
  }
  return tags;
}

function parseDescription(rawBlock) {
  return rawBlock
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line && !line.startsWith("@"))
    .join("\n");
}

function parseVariables(source) {
  const variables = [];
  const pattern = /\$([\w-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    // <lang><zh-CN>只给独立单行且无插值的变量声明精确约定；其他正则命中仍可能处于复杂 Sass 结构。</zh-CN><en>Only standalone, single-line, interpolation-free assignments receive a precise convention; other regex hits may lie in complex Sass syntax.</en></lang>
    const lineStart = source.lastIndexOf("\n", match.index - 1) + 1;
    const plainVariable = source.slice(lineStart, match.index).trim() === ""
      && !/[\r\n]/u.test(match[0])
      && !match[0].includes("#{")
      && !/[{}]/u.test(source.slice(0, match.index));
    variables.push({
      name: `$${match[1]}`,
      value: match[2].trim(),
      range: offsetRange(source, match.index, match.index + match[0].length),
      rangeConvention: { ...(plainVariable ? OFFSET_RANGE_CONVENTION : UNCERTAIN_RANGE_CONVENTION) }
    });
  }
  return variables;
}

function matchTokenVariable(tokenName, variables) {
  const tokenTail = tokenName.split(".").at(-1)?.toLowerCase();
  return variables.find((variable) => variable.name.toLowerCase().includes(tokenTail ?? ""));
}

function firstTagValue(tags, tagName) {
  return tags.find((tag) => tag.tag === tagName)?.value || null;
}

function firstSummary(description, fallback) {
  return description.split(/\r?\n/).find(Boolean) ?? fallback;
}

// 中文：把 SassDoc 的 `@lang` 与 inline `<lang>/<l>` 规整成 HIA field-level i18n。
// English: Normalizes SassDoc `@lang` and inline `<lang>/<l>` into HIA field-level i18n.
function createDescriptionI18n(defaultText, tags, defaultLocale, source) {
  const blocks = collectLangBlocks(tags, "description", source);
  const segments = parseInlineSegments(defaultText, "description");
  if (blocks.length === 0 && segments.length === 0) {
    return null;
  }

  const field = createTextField({
    fieldPath: "description",
    kind: "text",
    defaultLocale,
    defaultText,
    blocks,
    segments,
    source
  });

  return {
    enabled: true,
    model: HIA_TEXT_I18N_MODEL,
    modelVersion: HIA_TEXT_I18N_MODEL_VERSION,
    defaultLocale,
    locales: collectLocales([defaultLocale, ...Object.keys(field.localizedText)]),
    fields: {
      description: field
    }
  };
}

function collectLangBlocks(tags, fieldPath, source) {
  return tags
    .filter((tag) => tag.tag === "lang")
    .map((tag) => parseLangBlock(tag.value, fieldPath, source))
    .filter(Boolean);
}

function parseLangBlock(value, fieldPath, source) {
  const match = /^(\S+)(?:\s+([\s\S]+))?$/.exec(String(value ?? "").trim());
  const locale = normalizeLocale(match?.[1]);
  const text = compactWhitespace(match?.[2] ?? "");
  if (!locale || !text) {
    return null;
  }
  return {
    kind: "lang-block",
    locale,
    fieldPath,
    text,
    source,
    rangeInComment: null
  };
}

function createTextField(options) {
  const localizedText = {};
  const locales = collectLocales([
    options.defaultLocale,
    ...options.blocks.map((block) => block.locale),
    ...options.segments.flatMap((segment) => Object.keys(segment.localized))
  ]);

  for (const locale of locales) {
    const block = options.blocks.find((item) => item.locale === locale);
    localizedText[locale] = block?.text ?? renderInlineText(options.defaultText, options.segments, locale, options.defaultLocale);
  }

  const defaultText = localizedText[options.defaultLocale] || firstLocalizedText(localizedText) || compactWhitespace(options.defaultText);

  return {
    fieldPath: options.fieldPath,
    kind: options.kind,
    defaultLocale: options.defaultLocale,
    defaultText,
    source: options.source,
    localizedText,
    ...(options.blocks.length > 0 ? { blocks: options.blocks } : {}),
    ...(options.segments.length > 0 ? { segments: options.segments } : {}),
    resolutions: Object.fromEntries(Object.keys(localizedText).map((locale) => [
      locale,
      {
        requestedLocale: locale,
        resolvedLocale: locale,
        fallbackChain: fallbackChain(locale, options.defaultLocale),
        usedFallback: false,
        missing: false,
        sourceKind: options.blocks.some((block) => block.locale === locale) ? "lang-block" : "default-text",
        sourceLocale: locale,
        source: options.source
      }
    ])),
    missingLocales: []
  };
}

function parseInlineSegments(text, fieldPath) {
  const sourceText = String(text ?? "");
  const segments = [];
  const pattern = /<(lang|l)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = pattern.exec(sourceText))) {
    const localized = parseInlineLocalizedValues(match[3]);
    if (Object.keys(localized).length === 0) {
      continue;
    }
    const attributes = parseAttributes(match[2]);
    segments.push({
      kind: "lang-inline",
      id: `${fieldPath}.${segments.length}`,
      key: attributes.key ?? "",
      path: attributes.path ?? "",
      fieldPath,
      raw: match[0],
      localized,
      rangeInField: {
        start: match.index,
        end: match.index + match[0].length
      }
    });
  }
  return segments;
}

function parseInlineLocalizedValues(innerText) {
  const localized = {};
  const pattern = /<([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = pattern.exec(innerText || ""))) {
    const locale = normalizeLocale(match[1]);
    const text = compactWhitespace(match[2]);
    if (locale && text) {
      localized[locale] = text;
    }
  }
  return localized;
}

function renderInlineText(text, segments, locale, defaultLocale) {
  let rendered = compactWhitespace(text);
  for (const segment of segments) {
    rendered = rendered.replace(segment.raw, resolveInlineLocalizedText(segment.localized, locale, defaultLocale));
  }
  return rendered;
}

function resolveInlineLocalizedText(localized, locale, defaultLocale) {
  return localized[locale]
    ?? localized[getParentLocale(locale)]
    ?? localized[defaultLocale]
    ?? firstLocalizedText(localized)
    ?? "";
}

function parseAttributes(rawAttributes) {
  const attributes = {};
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(rawAttributes || ""))) {
    attributes[match[1]] = match[2] || match[3] || "";
  }
  return attributes;
}

/**
 * @lang zh-CN 在 SassDoc 注释结束之后，按完整选择器前缀寻找可能的规则行；不把标签、注释或相似名称误认成源码规则。复杂 Sass 语法仍须由解析器另行核实。
 * @lang en Finds a likely rule line by complete selector prefix after the SassDoc annotation; excludes tags, comments, and similarly named selectors. Complex Sass syntax still needs parser verification.
 * @param {string} source Sass/SCSS 源码；Sass/SCSS source text.
 * @param {string} marker 标签声明的选择器；Selector declared by the tag.
 * @param {{line:number,column:number}} after 注释末位置（一基 UTF-16 列）；Annotation end position (one-based UTF-16 column).
 * @returns {{start:{line:number,column:number},end:{line:number,column:number}} | null} 候选选择器至行尾的待核范围，未找到时为 null；Tentative selector-to-line-end range, or null if absent.
 */
function findLineRange(source, marker, after) {
  // <lang><zh-CN>CRLF 与 LF 都按同一行模型扫描；起始行只检查注释终点之后。</zh-CN><en>Scan CRLF and LF with the same line model; inspect only text after the annotation end on its final line.</en></lang>
  const lines = source.split(/\r?\n/);
  for (let lineIndex = after.line - 1; lineIndex < lines.length; lineIndex += 1) {
    // <lang><zh-CN>首行可能在注释结束后接规则；后续行从列零开始。</zh-CN><en>The first line may continue with a rule after the annotation; later lines start at column zero.</en></lang>
    const line = lines[lineIndex];
    const segmentStart = lineIndex === after.line - 1 ? after.column - 1 : 0;
    const segment = line.slice(segmentStart);
    const leadingWhitespace = segment.match(/^\s*/u)?.[0].length ?? 0;
    const candidate = segment.slice(leadingWhitespace);
    if (!candidate.startsWith(marker)) {
      continue;
    }
    // <lang><zh-CN>选择器后必须是规则分隔符或结束；字母、数字、下划线和连字符说明只是相似名称。</zh-CN><en>The selector must end or continue with a rule delimiter; letters, digits, underscores, and hyphens indicate only a similar name.</en></lang>
    const next = candidate[marker.length] ?? "";
    if (next !== "" && !/[\s:{,[>+~.#]/u.test(next)) {
      continue;
    }
    return {
      start: { line: lineIndex + 1, column: segmentStart + leadingWhitespace + 1 },
      end: { line: lineIndex + 1, column: line.length + 1 }
    };
  }
  return null;
}

/**
 * @lang zh-CN 仅核简单顶层单行规则的匹配右括号，并把排他终点止于该括号后；多行、伪类、组合、插值、嵌套和无法词法确认的输入保留未知。
 * @lang en Verifies a plain top-level one-line rule through its matching closing brace and sets the exclusive end after it; multiline, pseudo, combined, interpolated, nested, and lexically uncertain input remains unknown.
 * @param {string} source 原始 Sass 文本；Original Sass text.
 * @param {string} selector 注释声明的选择器；Selector declared by the annotation.
 * @param {{start:{line:number,column:number},end:{line:number,column:number}}} range 行扫描得到的候选范围；Candidate range found by the line scan.
 * @returns {{start:{line:number,column:number},end:{line:number,column:number}} | null} 已证规则范围或 null；Verified rule range or null.
 */
function findPlainSelectorRuleRange(source, selector, range) {
  // <lang><zh-CN>只接受普通类或 ID 选择器及紧接的大括号；源文本的列为 UTF-16 代码单元。</zh-CN><en>Accept only a plain class or ID selector followed by an opening brace; source columns count UTF-16 code units.</en></lang>
  if (!/^[.#][A-Za-z_][\w-]*$/u.test(selector)) {
    return null;
  }
  // <lang><zh-CN>先前存在大括号时不能靠行扫描证明当前规则的嵌套层次，保守降为未知。</zh-CN><en>Earlier braces make rule nesting unprovable by a line scan, so leave the convention unknown.</en></lang>
  // <lang><zh-CN>行数组保留 UTF-16 字符串索引语义，供一基列计算使用。</zh-CN><en>The line array retains UTF-16 string indexes for one-based columns.</en></lang>
  const lines = source.split(/\r?\n/u);
  // <lang><zh-CN>候选规则的原始行用于定位括号和行内后继规则。</zh-CN><en>The candidate's source line locates braces and later same-line rules.</en></lang>
  const line = lines[range.start.line - 1] ?? "";
  // <lang><zh-CN>候选前缀用于保守排除无法由行扫描区分的已打开规则。</zh-CN><en>The prefix conservatively excludes already-open rules that the line scan cannot classify.</en></lang>
  const precedingText = lines.slice(0, range.start.line - 1).join("\n") + line.slice(0, range.start.column - 1);
  if (/[{}]/u.test(precedingText)) {
    return null;
  }
  // <lang><zh-CN>确认选择器之后只有水平空格和左括号；后续扫描以该括号为规则起点。</zh-CN><en>Require only horizontal whitespace and an opening brace after the selector; scan from that brace.</en></lang>
  // <lang><zh-CN>候选切片以规则首列为零索引，后续终点需换算回一基列。</zh-CN><en>The candidate slice starts at the rule's zero-based index; convert its end back to a one-based column.</en></lang>
  const candidate = line.slice(range.start.column - 1);
  // <lang><zh-CN>开头匹配只接受简单选择器后紧跟水平空格与左括号。</zh-CN><en>The opening match accepts only a plain selector followed by horizontal whitespace and an opening brace.</en></lang>
  const opener = candidate.startsWith(selector) ? candidate.slice(selector.length).match(/^[ \t]*\{/u) : null;
  if (!opener) {
    return null;
  }
  // <lang><zh-CN>左括号索引是扫描的基点，不把后继规则的括号计入本规则。</zh-CN><en>The opening-brace index anchors the scan without including a later rule's braces.</en></lang>
  const openingIndex = selector.length + opener[0].length - 1;
  // <lang><zh-CN>引号状态使字符串内的右括号不会提前结束规则。</zh-CN><en>The quote state prevents a closing brace inside a string from ending the rule early.</en></lang>
  let quote = null;
  // <lang><zh-CN>块注释状态忽略注释中的括号。</zh-CN><en>The block-comment state ignores braces inside comments.</en></lang>
  let inBlockComment = false;
  // <lang><zh-CN>转义状态使被转义的引号不误关字符串。</zh-CN><en>The escape state keeps an escaped quote from closing its string.</en></lang>
  let escaped = false;

  // <lang><zh-CN>跳过字面字符串及块注释中的括号；嵌套、插值和行注释使扫描器不能证明单规则终点。</zh-CN><en>Ignore braces inside strings and block comments; nesting, interpolation, and line comments prevent proving a single-rule end.</en></lang>
  for (let index = openingIndex + 1; index < candidate.length; index += 1) {
    // <lang><zh-CN>当前与前瞻字符只属于本轮词法判断，不改变源码偏移。</zh-CN><en>Current and lookahead characters are local to this lexical step and do not change source offsets.</en></lang>
    const current = candidate[index];
    const next = candidate[index + 1] ?? "";
    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (current === "#" && next === "{") {
        return null;
      }
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        quote = null;
      }
      continue;
    }
    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "/") {
      return null;
    }
    if (current === "'" || current === '"') {
      quote = current;
      continue;
    }
    if (current === "\\") {
      return null;
    }
    if ((current === "#" && next === "{") || current === "{") {
      return null;
    }
    if (current === "}") {
      return {
        start: range.start,
        end: { line: range.start.line, column: range.start.column + index + 1 }
      };
    }
  }
  return null;
}

function offsetRange(source, startOffset, endOffset) {
  return {
    start: offsetPosition(source, startOffset),
    end: offsetPosition(source, endOffset)
  };
}

function offsetPosition(source, offset) {
  const before = source.slice(0, offset).split(/\r?\n/);
  return {
    line: before.length,
    column: before.at(-1).length + 1
  };
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/");
}

function collectLocales(values) {
  return [...new Set(values.map((value) => normalizeLocale(value)).filter(Boolean))];
}

function normalizeLocale(value) {
  const locale = String(value ?? "").trim().replace(/_/g, "-");
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale : "";
}

function getParentLocale(locale) {
  return String(locale).split("-")[0] || locale;
}

function fallbackChain(locale, defaultLocale) {
  const chain = collectLocales([locale, getParentLocale(locale), defaultLocale]);
  return chain.length > 0 ? chain : [DEFAULT_LOCALE];
}

function firstLocalizedText(localizedText) {
  return Object.values(localizedText).find((text) => typeof text === "string" && text.length > 0) ?? "";
}

function compactWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function inferSassLanguage(filePath) {
  return filePath.toLowerCase().endsWith(".sass") ? "sass" : "scss";
}
