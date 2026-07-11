import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import * as sass from "sass";

import { sassDocToCssDocExtraction } from "@hia-doc/sass-cssdoc-bridge";
import { sassExtractionToHiaDocument } from "@hia-doc/sass-doc-adapter";
import { extractSassDoc } from "@hia-doc/sass-doc-extractor";
import { createSassToCssDocumentationSourceMap } from "@hia-doc/sass-to-css-doc-source-map";
import {
  SASSDOC_EXTRACTION_CONTRACT,
  SASSDOC_EXTRACTION_CONTRACT_VERSION
} from "@hia-doc/sassdoc-spec";

export {
  SASSDOC_CONFIG_JSON_SCHEMA,
  SASSDOC_CONFIG_SCHEMA_ID,
  SASSDOC_CONFIG_SCHEMA_VERSION
} from "./schema.mjs";
import { SASSDOC_CONFIG_SCHEMA_ID, SASSDOC_CONFIG_SCHEMA_VERSION } from "./schema.mjs";

export const SASSDOC_RUNNER_VERSION = "0.0.0";
export const SASSDOC_INPUT_KINDS = Object.freeze(["scss", "sass"]);
export const SASSDOC_OUTPUT_KINDS = Object.freeze([
  "generated-css",
  "ordinary-source-map",
  "sassdoc-extraction",
  "cssdoc-extraction",
  "hia-document",
  "doc-source-map"
]);

const RESULT_CONTRACT = "documentation-producer-result";
const RESULT_CONTRACT_VERSION = "0.1.0-draft";
const PRODUCER_ID = "sassdoc";
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * 执行一次 SassDoc 项目构建，并返回标准 documentation producer result。
 * Runs a single SassDoc project build and returns the standard documentation producer result.
 *
 * @param {object} request SassDoc runner request with absolute workspace/output directories.
 * @param {{ signal?: AbortSignal, reportProgress?: Function }} [context] Optional producer runtime context.
 * @returns {Promise<object>} Documentation producer result.
 */
export async function runSassDoc(request, context = {}) {
  const normalized = normalizeRequest(request);
  await mkdir(normalized.outputDirectory, { recursive: true });

  const artifacts = [];
  const diagnostics = [];
  let completed = 0;

  for (const [index, input] of normalized.inputs.entries()) {
    if (context.signal?.aborted) {
      diagnostics.push(createDiagnostic(
        "SASSDOC_RUNNER_ABORTED",
        "SassDoc runner was aborted before all inputs completed.",
        "error"
      ));
      break;
    }

    context.reportProgress?.({
      phase: "extract",
      current: index,
      total: normalized.inputs.length,
      message: input.path
    });

    try {
      const generated = await processInput(input, normalized, index);
      artifacts.push(...generated.artifacts);
      diagnostics.push(...generated.diagnostics);
      completed += 1;
    } catch (error) {
      diagnostics.push(createDiagnostic(
        "SASSDOC_RUNNER_INPUT_FAILED",
        `Unable to process SassDoc input ${input.path} (${errorCode(error)}).`,
        "error",
        input.path
      ));
    }
  }

  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const result = {
    contract: RESULT_CONTRACT,
    contractVersion: RESULT_CONTRACT_VERSION,
    producer: {
      id: PRODUCER_ID,
      version: SASSDOC_RUNNER_VERSION
    },
    status: hasErrors ? (artifacts.length > 0 ? "partial" : "failed") : "success",
    artifacts,
    diagnostics
  };

  if (normalized.options.writeResultManifest) {
    await writeJson(path.join(normalized.outputDirectory, "sassdoc.producer-result.json"), result);
  }

  context.reportProgress?.({
    phase: "complete",
    current: completed,
    total: normalized.inputs.length
  });

  return result;
}

/**
 * 读取 versioned SassDoc JSON config 并转成 runner request。
 * Loads a versioned SassDoc JSON config and converts it into a runner request.
 *
 * @param {string} configPath Config path relative to cwd or absolute.
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<object>} Normalized runner request.
 */
export async function loadSassDocConfig(configPath, options = {}) {
  const absoluteConfigPath = path.resolve(options.cwd ?? process.cwd(), configPath);
  const config = JSON.parse(await readFile(absoluteConfigPath, "utf8"));
  assertRecord(config, "SassDoc config must be a JSON object.");
  assertKnownKeys(config, ["$schema", "schemaVersion", "workspaceRoot", "outputDirectory", "inputs", "options", "profileIds"], "config");
  if (config.schemaVersion !== SASSDOC_CONFIG_SCHEMA_VERSION) {
    throw new TypeError(`schemaVersion must be ${SASSDOC_CONFIG_SCHEMA_VERSION}.`);
  }
  if (config.$schema !== undefined && config.$schema !== SASSDOC_CONFIG_SCHEMA_ID) {
    throw new TypeError(`$schema must be ${SASSDOC_CONFIG_SCHEMA_ID}.`);
  }

  const configDirectory = path.dirname(absoluteConfigPath);
  const workspaceDirectory = normalizeConfigDirectory(config.workspaceRoot ?? ".", "workspaceRoot");
  const outputDirectory = normalizeConfigDirectory(config.outputDirectory ?? "dist/sassdoc", "outputDirectory");
  const workspaceRoot = path.resolve(configDirectory, workspaceDirectory);

  return normalizeRequest({
    workspaceRoot,
    outputDirectory: path.resolve(workspaceRoot, outputDirectory),
    inputs: config.inputs,
    options: config.options,
    profileIds: config.profileIds
  });
}

export function inferSassDocInputKind(inputPath) {
  return String(inputPath).replaceAll("\\", "/").toLowerCase().endsWith(".sass") ? "sass" : "scss";
}

async function processInput(input, request, index) {
  const sourceFile = path.resolve(request.workspaceRoot, input.path);
  const source = await readFile(sourceFile, "utf8");
  const basePath = outputBasePath(input, index);
  const cssPath = `${basePath}.css`;
  const cssSourceMapPath = `${cssPath}.map`;
  const sassExtractionPath = `${basePath}.sassdoc.json`;
  const cssExtractionPath = `${basePath}.cssdoc.json`;
  const hiaDocumentPath = `${basePath}.hia.json`;
  const docSourceMapPath = `${basePath}.docmap.json`;
  const compiled = compileSass(sourceFile, request.outputDirectory, request.options);

  await mkdir(path.dirname(path.join(request.outputDirectory, cssPath)), { recursive: true });
  await writeFile(path.join(request.outputDirectory, cssPath), compiled.css, "utf8");
  if (request.options.emitCssSourceMap) {
    await writeJson(path.join(request.outputDirectory, cssSourceMapPath), compiled.sourceMap);
  }

  const sassExtraction = extractSassDoc(source, {
    path: input.path,
    language: input.kind,
    sourcesContentPolicy: request.options.sourcesContentPolicy
  });
  const cssExtraction = sassDocToCssDocExtraction(sassExtraction, {
    generatedCssPath: cssPath,
    sourcesContentPolicy: request.options.sourcesContentPolicy
  });
  const document = sassExtractionToHiaDocument(sassExtraction, {
    id: `sassdoc:${input.path}`,
    title: path.posix.basename(input.path),
    docSourceMapPath
  });
  const docSourceMap = createSassToCssDocumentationSourceMap({
    sassExtraction,
    cssDocExtraction: cssExtraction,
    sourcePath: input.path,
    language: input.kind,
    cssPath,
    cssSourceMapPath,
    cssDocPath: cssExtractionPath,
    hiaDocumentPath,
    sourcesContentPolicy: request.options.sourcesContentPolicy,
    producerVersion: SASSDOC_RUNNER_VERSION
  });

  await writeJson(path.join(request.outputDirectory, sassExtractionPath), sassExtraction);
  await writeJson(path.join(request.outputDirectory, cssExtractionPath), cssExtraction);
  await writeJson(path.join(request.outputDirectory, hiaDocumentPath), document);
  if (request.options.emitDocSourceMap) {
    await writeJson(path.join(request.outputDirectory, docSourceMapPath), docSourceMap);
  }

  const artifactIdBase = `input-${index + 1}`;
  const artifacts = [
    artifact(`${artifactIdBase}-css`, "generated-css", cssPath, "css", "text/css", request.profileIds),
    {
      ...artifact(`${artifactIdBase}-sassdoc`, "sassdoc-extraction", sassExtractionPath, "json", "application/json", request.profileIds),
      contract: SASSDOC_EXTRACTION_CONTRACT,
      contractVersion: SASSDOC_EXTRACTION_CONTRACT_VERSION
    },
    {
      ...artifact(`${artifactIdBase}-cssdoc`, "cssdoc-extraction", cssExtractionPath, "json", "application/json", request.profileIds),
      contract: "cssdoc-extraction",
      contractVersion: "0.1.0-draft"
    },
    artifact(`${artifactIdBase}-hia-document`, "hia-document", hiaDocumentPath, "json", "application/json", request.profileIds)
  ];

  if (request.options.emitCssSourceMap) {
    artifacts.push({
      ...artifact(`${artifactIdBase}-ordinary-source-map`, "ordinary-source-map", cssSourceMapPath, "json", "application/json", request.profileIds),
      contract: "source-map-v3",
      contractVersion: "3"
    });
  }
  if (request.options.emitDocSourceMap) {
    artifacts.push({
      ...artifact(`${artifactIdBase}-doc-source-map`, "doc-source-map", docSourceMapPath, "json", "application/json", request.profileIds),
      contract: "doc-source-map",
      contractVersion: "0.1.0-draft"
    });
  }

  return {
    artifacts,
    diagnostics: [
      ...normalizeDiagnostics(sassExtraction.diagnostics, input.path),
      ...normalizeDiagnostics(cssExtraction.diagnostics, input.path)
    ]
  };
}

function compileSass(sourceFile, outputDirectory, options) {
  const result = sass.compile(sourceFile, {
    style: options.sassStyle,
    sourceMap: options.emitCssSourceMap,
    sourceMapIncludeSources: options.sourcesContentPolicy === "embed"
  });
  return {
    css: ensureTrailingNewline(result.css),
    sourceMap: normalizeSassSourceMap(result.sourceMap, outputDirectory)
  };
}

function normalizeSassSourceMap(sourceMap, outputDirectory) {
  if (!sourceMap) {
    return {
      version: 3,
      sources: [],
      sourcesContent: [],
      names: [],
      mappings: ""
    };
  }
  const normalized = {
    version: 3,
    sources: (sourceMap.sources ?? []).map((source) => normalizeSourceMapSource(source, outputDirectory)),
    sourcesContent: Array.isArray(sourceMap.sourcesContent) ? sourceMap.sourcesContent : [],
    names: Array.isArray(sourceMap.names) ? sourceMap.names : [],
    mappings: sourceMap.mappings ?? ""
  };
  return normalized;
}

function normalizeSourceMapSource(source, outputDirectory) {
  let value = String(source);
  if (value.startsWith("file:")) {
    value = fileURLToPath(value);
  }
  if (path.isAbsolute(value)) {
    return toPosix(path.relative(outputDirectory, value));
  }
  return toPosix(value);
}

function normalizeRequest(value) {
  assertRecord(value, "SassDoc runner request must be an object.");
  assertAbsoluteDirectory(value.workspaceRoot, "workspaceRoot");
  assertAbsoluteDirectory(value.outputDirectory, "outputDirectory");
  if (!Array.isArray(value.inputs) || value.inputs.length === 0) {
    throw new TypeError("inputs must be a non-empty array.");
  }

  const inputs = value.inputs.map((input, index) => {
    assertRecord(input, `inputs[${index}] must be an object.`);
    assertKnownKeys(input, ["kind", "path", "language", "artifactBasePath"], `inputs[${index}]`);
    const inputPath = normalizeSafeRelativePath(input.path, `inputs[${index}].path`);
    const kind = input.kind ?? inferSassDocInputKind(inputPath);
    if (!SASSDOC_INPUT_KINDS.includes(kind)) {
      throw new TypeError(`Unsupported SassDoc input kind: ${kind}`);
    }
    return {
      kind,
      path: inputPath,
      ...(typeof input.language === "string" ? { language: input.language } : {}),
      ...(typeof input.artifactBasePath === "string" ? {
        artifactBasePath: normalizeSafeRelativePath(input.artifactBasePath, `inputs[${index}].artifactBasePath`)
      } : {})
    };
  });

  const runnerOptions = value.options ?? {};
  assertRecord(runnerOptions, "options must be an object.");
  assertKnownKeys(runnerOptions, ["emitDocSourceMap", "emitCssSourceMap", "sourcesContentPolicy", "writeResultManifest", "sassStyle"], "options");
  const sourcesContentPolicy = runnerOptions.sourcesContentPolicy ?? "none";
  if (!["none", "reference", "embed"].includes(sourcesContentPolicy)) {
    throw new TypeError(`Unsupported sourcesContentPolicy: ${sourcesContentPolicy}`);
  }
  const sassStyle = runnerOptions.sassStyle ?? "expanded";
  if (!["expanded", "compressed"].includes(sassStyle)) {
    throw new TypeError(`Unsupported Sass style: ${sassStyle}`);
  }
  const profileIds = value.profileIds ?? ["sassdoc", "cssdoc", "doc-source-map"];
  if (!Array.isArray(profileIds) || profileIds.length === 0 || profileIds.some((id) => typeof id !== "string" || !SAFE_ID_PATTERN.test(id))) {
    throw new TypeError("profileIds must be a non-empty array of lower-case identifiers.");
  }

  return {
    workspaceRoot: path.resolve(value.workspaceRoot),
    outputDirectory: path.resolve(value.outputDirectory),
    inputs,
    profileIds: [...profileIds],
    options: {
      emitDocSourceMap: runnerOptions.emitDocSourceMap !== false,
      emitCssSourceMap: runnerOptions.emitCssSourceMap !== false,
      sourcesContentPolicy,
      writeResultManifest: runnerOptions.writeResultManifest !== false,
      sassStyle
    }
  };
}

function outputBasePath(input, index) {
  if (input.artifactBasePath) {
    return input.artifactBasePath;
  }
  const parsed = path.posix.parse(input.path);
  const directory = parsed.dir ? `${parsed.dir}/` : "";
  return normalizeSafeRelativePath(
    `artifacts/${directory}${parsed.name}.${slug(input.kind)}-${index + 1}`,
    "artifact base path"
  );
}

function artifact(id, kind, artifactPath, language, mediaType, profileIds) {
  return {
    id,
    kind,
    path: artifactPath,
    language,
    mediaType,
    profileIds
  };
}

function normalizeDiagnostics(diagnostics, fallbackPath) {
  return (diagnostics ?? []).map((diagnostic) => ({
    code: typeof diagnostic?.code === "string" ? diagnostic.code : "SASSDOC_RUNNER_DIAGNOSTIC",
    message: typeof diagnostic?.message === "string" ? diagnostic.message : "SassDoc runner diagnostic.",
    severity: ["error", "warning", "info"].includes(diagnostic?.severity) ? diagnostic.severity : "info",
    path: typeof diagnostic?.path === "string" && isSafeRelativePath(diagnostic.path)
      ? diagnostic.path.replaceAll("\\", "/")
      : fallbackPath,
    ...(isJsonObject(diagnostic?.data) ? { data: diagnostic.data } : {})
  }));
}

function createDiagnostic(code, message, severity, diagnosticPath) {
  return {
    code,
    message,
    severity,
    ...(diagnosticPath ? { path: diagnosticPath } : {})
  };
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeSafeRelativePath(value, label) {
  if (typeof value !== "string" || !isSafeRelativePath(value)) {
    throw new TypeError(`${label} must be a safe relative path.`);
  }
  return value.replaceAll("\\", "/");
}

function isSafeRelativePath(value) {
  const normalized = String(value).replaceAll("\\", "/");
  return Boolean(normalized)
    && !path.posix.isAbsolute(normalized)
    && !path.win32.isAbsolute(value)
    && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)
    && !normalized.split("/").includes("..");
}

function normalizeConfigDirectory(value, label) {
  if (typeof value !== "string" || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    throw new TypeError(`${label} must be relative to the config/project directory.`);
  }
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.split("/").includes("..")) {
    throw new TypeError(`${label} must not escape its base directory.`);
  }
  return normalized;
}

function assertAbsoluteDirectory(value, label) {
  if (typeof value !== "string" || (!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value))) {
    throw new TypeError(`${label} must be an absolute runtime path.`);
  }
}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${label}.${key} is not supported.`);
    }
  }
}

function assertRecord(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(message);
  }
}

function isJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function toPosix(value) {
  return value.replace(/\\/g, "/");
}

function errorCode(error) {
  return typeof error?.code === "string" ? error.code : error?.name ?? "Error";
}

function slug(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "input";
}
