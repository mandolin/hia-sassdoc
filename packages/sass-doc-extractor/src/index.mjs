import {
  SASSDOC_EXTRACTION_CONTRACT,
  SASSDOC_EXTRACTION_CONTRACT_VERSION
} from "@hia-doc/sassdoc-spec";

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

    symbols.push({
      id: `component:${componentName}`,
      kind: "sass-component-style",
      name: componentName,
      selector,
      summary: firstSummary(block.description, `Sass component style for ${componentName}.`),
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

function inferSassLanguage(filePath) {
  return filePath.toLowerCase().endsWith(".sass") ? "sass" : "scss";
}
