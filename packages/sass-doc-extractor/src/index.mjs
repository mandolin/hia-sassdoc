import {
  SASSDOC_EXTRACTION_CONTRACT,
  SASSDOC_EXTRACTION_CONTRACT_VERSION
} from "@hia-doc/sassdoc-spec";

const DEFAULT_LOCALE = "en";
const HIA_TEXT_I18N_MODEL = "hia-text-i18n";
const HIA_TEXT_I18N_MODEL_VERSION = "0.2.0";

/**
 * 从 Sass/SCSS 源码中提取第一轮 SassDoc artifact。
 * Extracts the first SassDoc artifact shape from Sass/SCSS source text.
 *
 * @param {string} source Sass or SCSS source text.
 * @param {{ path?: string, language?: string, sourcesContentPolicy?: "none" | "reference" | "embed" }} [options]
 * @returns {object} SassDoc extraction artifact.
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
        range: findLineRange(source, selector) ?? block.range,
        rangeSource: "sassdoc-parser",
        confidence: "high"
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
    variables.push({
      name: `$${match[1]}`,
      value: match[2].trim(),
      range: offsetRange(source, match.index, match.index + match[0].length)
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

function findLineRange(source, marker) {
  const lines = source.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => line.includes(marker));
  if (lineIndex === -1) {
    return null;
  }
  return {
    start: { line: lineIndex + 1, column: 1 },
    end: { line: lineIndex + 1, column: lines[lineIndex].length + 1 }
  };
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
