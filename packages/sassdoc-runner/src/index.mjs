import { readFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import { createSassCoordinateProfile, decodeCoordinateSource } from "./coordinate-profile.mjs";

export const SASSDOC_RUNNER_VERSION = "0.0.0";
export const SASSDOC_INPUT_KINDS = Object.freeze(["scss", "sass"]);
/** @lang zh-CN 生产结果可声明的产物类别；坐标侧载仅在显式 opt-in 后真正写入。 @lang en Artifact kinds the producer may declare; the coordinate sidecar is emitted only after explicit opt-in. */
export const SASSDOC_OUTPUT_KINDS = Object.freeze([
  "generated-css",
  "ordinary-source-map",
  "ordinary-source-map-coordinate-profile",
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

/**
 * 处理单个 Sass 输入并按需发布已核侧载，其工件身份只来源于本次构建。
 * Processes one Sass input and optionally publishes a verified sidecar using identities from this build only.
 *
 * @param {object} input 已规范化的 Sass 输入 / Normalized Sass input.
 * @param {object} request 已规范化的构建请求 / Normalized build request.
 * @param {number} index 此请求中的零基输入序号 / Zero-based input index within this request.
 * @returns {Promise<{artifacts: object[], diagnostics: object[]}>} 成功输入的产物和诊断 / Artifacts and diagnostics for a successful input.
 * @throws {Error} 严格来源、暂存、发布或实际字节核验失败 / Strict source, staging, publication or actual-byte verification failure.
 * @lang zh-CN 语义失败发生在发布前；跨平台多文件发布不是原子事务，I/O 中途失败可能留下未认证文件，但旧证明已移除且新证明最后写。
 * @lang en Semantic failures precede publication; cross-platform multi-file publication is not atomic, so an I/O failure can leave uncertified files, while old proof is removed and new proof is written last.
 */
async function processInput(input, request, index) {
  const sourceFile = path.resolve(request.workspaceRoot, input.path);
  const basePath = outputBasePath(input, index);
  const cssPath = `${basePath}.css`;
  const cssSourceMapPath = `${cssPath}.map`;
  const sassExtractionPath = `${basePath}.sassdoc.json`;
  const cssExtractionPath = `${basePath}.cssdoc.json`;
  const hiaDocumentPath = `${basePath}.hia.json`;
  const docSourceMapPath = `${basePath}.docmap.json`;
  const coordinateProfilePath = `${basePath}.coordinate-profile.json`;
  const absoluteCoordinateProfilePath = path.join(request.outputDirectory, coordinateProfilePath);
  // <lang><zh-CN>每次处理都撤销同路径旧证明，包括关闭 opt-in 的重建；否则全目录部署仍可能公开过期来源摘要。</zh-CN><en>Revoke same-path proof on every rebuild, including opt-out, or whole-directory publication may leak stale source digests.</en></lang>
  await rm(absoluteCoordinateProfilePath, { force: true });
  if (request.options.emitCoordinateProfile) {
    // <lang><zh-CN>在读取来源前做 realpath 边界检查；检查与打开间仍存在跨平台竞态，消费端须再次核真实字节。</zh-CN><en>Check realpath containment before reading source bytes; a cross-platform check/open race remains, so consumers must recheck actual bytes.</en></lang>
    const workspaceReal = await realpath(request.workspaceRoot);
    const sourceReal = await realpath(sourceFile);
    const relativeSource = path.relative(workspaceReal, sourceReal);
    if (relativeSource === ".." || relativeSource.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSource)) {
      throw new TypeError("Coordinate source escapes the workspace root.");
    }
  }
  // <lang><zh-CN>严格模式在完成边界检查后读取一次原始字节，编译与提取共用严格解码文本；旧构建保持原读取路径。</zh-CN><en>Strict mode reads raw bytes once after containment and shares fatally decoded text across compilation and extraction; legacy builds retain their read path.</en></lang>
  const sourceBytes = request.options.emitCoordinateProfile ? await readFile(sourceFile) : null;
  const source = sourceBytes ? decodeCoordinateSource(sourceBytes) : await readFile(sourceFile, "utf8");
  const compiled = compileSass(sourceFile, request.outputDirectory, request.options, source);

  const sassExtraction = extractSassDoc(source, {
    path: input.path,
    language: input.kind,
    sourcesContentPolicy: request.options.sourcesContentPolicy
  });
  const cssExtraction = sassDocToCssDocExtraction(sassExtraction, {
    generatedCssPath: cssPath,
    sourcesContentPolicy: request.options.sourcesContentPolicy
  });
  // <lang><zh-CN>先得到实际写入的地图身份，再创建文档引用；关闭地图输出时不声明不存在的文件。</zh-CN><en>Create the actual map identity before the document reference; do not advertise a nonexistent file when map output is disabled.</en></lang>
  const docSourceMap = request.options.emitDocSourceMap ? createSassToCssDocumentationSourceMap({
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
  }) : null;
  const document = sassExtractionToHiaDocument(sassExtraction, {
    id: `sassdoc:${input.path}`,
    title: path.posix.basename(input.path),
    ...(docSourceMap ? {
      docSourceMapPath,
      docSourceMapContractVersion: docSourceMap.contractVersion
    } : {})
  });

  // <lang><zh-CN>预检结果仅在 opt-in 时存在，最终路径仍须再次核字节。</zh-CN><en>The preflight result exists only for opt-in and does not replace the final-path byte check.</en></lang>
  let stagedProfile = null;
  if (request.options.emitCoordinateProfile) {
    // <lang><zh-CN>私有 staging 先写双图并从实际暂存字节建证；契约或字节预检失败不得触碰既有 CSS/地图。</zh-CN><en>Write both maps to private staging and build evidence from actual staged bytes first; contract or byte preflight failures leave existing CSS/maps untouched.</en></lang>
    const stagingRoot = await mkdtemp(path.join(tmpdir(), "hia-sass-coordinate-stage-"));
    try {
      const stagedOrdinary = path.join(stagingRoot, "ordinary.map");
      const stagedDocumentation = path.join(stagingRoot, "documentation.map");
      await writeJson(stagedOrdinary, compiled.sourceMap);
      await writeJson(stagedDocumentation, docSourceMap);
      stagedProfile = createSassCoordinateProfile({
        sourceBytes,
        sourceText: source,
        sourceFile,
        rawMapSources: compiled.rawMapSources,
        ordinaryMap: compiled.sourceMap,
        ordinaryMapBytes: await readFile(stagedOrdinary),
        documentationMap: docSourceMap,
        documentationMapBytes: await readFile(stagedDocumentation),
        inputIndex: index
      });
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }

  try {
    // <lang><zh-CN>语义预检完成后才发布常规产物；profile 最后写入，任一发布失败必须撤销最终证明。</zh-CN><en>Publish ordinary artifacts only after semantic preflight; write the profile last and revoke the final proof on any publish failure.</en></lang>
    await mkdir(path.dirname(path.join(request.outputDirectory, cssPath)), { recursive: true });
    await writeFile(path.join(request.outputDirectory, cssPath), compiled.css, "utf8");
    if (request.options.emitCssSourceMap) {
      await writeJson(path.join(request.outputDirectory, cssSourceMapPath), compiled.sourceMap);
    }
    await writeJson(path.join(request.outputDirectory, sassExtractionPath), sassExtraction);
    await writeJson(path.join(request.outputDirectory, cssExtractionPath), cssExtraction);
    await writeJson(path.join(request.outputDirectory, hiaDocumentPath), document);
    if (docSourceMap) {
      await writeJson(path.join(request.outputDirectory, docSourceMapPath), docSourceMap);
    }
    if (stagedProfile) {
      // <lang><zh-CN>最终路径写出后重新核实双图字节，防止暂存与发布不一致；侧载只认证这些最终字节。</zh-CN><en>Recheck both final map byte streams against staging; the sidecar certifies only those final bytes.</en></lang>
      const finalProfile = createSassCoordinateProfile({
        sourceBytes,
        sourceText: source,
        sourceFile,
        rawMapSources: compiled.rawMapSources,
        ordinaryMap: compiled.sourceMap,
        ordinaryMapBytes: await readFile(path.join(request.outputDirectory, cssSourceMapPath)),
        documentationMap: docSourceMap,
        documentationMapBytes: await readFile(path.join(request.outputDirectory, docSourceMapPath)),
        inputIndex: index
      });
      if (JSON.stringify(finalProfile) !== JSON.stringify(stagedProfile)) {
        throw new TypeError("Coordinate staged and final evidence differ.");
      }
      await writeJson(absoluteCoordinateProfilePath, finalProfile);
    }
  } catch (error) {
    if (request.options.emitCoordinateProfile) {
      await rm(absoluteCoordinateProfilePath, { force: true });
    }
    throw error;
  }

  // <lang><zh-CN>生产清单只登记本次成功发布的产物；失败输入由外层捕获且不加入清单。</zh-CN><en>The producer manifest lists only artifacts published by this successful input; the outer runner catches failed inputs without listing them.</en></lang>
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
  if (docSourceMap) {
    artifacts.push({
      ...artifact(`${artifactIdBase}-doc-source-map`, "doc-source-map", docSourceMapPath, "json", "application/json", request.profileIds),
      contract: "doc-source-map",
      contractVersion: docSourceMap.contractVersion
    });
  }
  if (request.options.emitCoordinateProfile) {
    artifacts.push({
      ...artifact(`${artifactIdBase}-coordinate-profile`, "ordinary-source-map-coordinate-profile", coordinateProfilePath, "json", "application/json", request.profileIds),
      contract: "ordinary-source-map-coordinate-profile",
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

/**
 * 为严格侧载复用同一来源文本；未开启时保持 Dart Sass 原文件编译路径。
 * Reuses one source text snapshot for the strict sidecar while preserving Dart Sass file compilation otherwise.
 *
 * @param {string} sourceFile 主来源的本地文件路径 / Local primary source path.
 * @param {string} outputDirectory 普通图相对路径的基准 / Base for ordinary-map relative source paths.
 * @param {object} options Sass 编译与侧载选项 / Sass compilation and sidecar options.
 * @param {string} sourceText 已读取的来源逻辑文本 / Previously read logical source text.
 * @returns {{css: string, sourceMap: object, rawMapSources: string[]}} CSS、规范化普通图和原始槽位顺序 / CSS, normalized ordinary map and original slot order.
 * @throws {Error} Sass 编译或严格扩展名验证失败 / Sass compilation or strict extension check failure.
 */
function compileSass(sourceFile, outputDirectory, options, sourceText) {
  // <lang><zh-CN>严格模式把相同文本直接传入 Dart Sass；file URL 保留相对导入，.sass 必须指定缩进语法。</zh-CN><en>Strict mode passes the same text directly to Dart Sass; a file URL retains relative imports, and .sass requires indented syntax.</en></lang>
  if (options.emitCoordinateProfile && !/\.(?:scss|sass)$/i.test(sourceFile)) {
    throw new TypeError("Coordinate source must have a Sass or SCSS file extension.");
  }
  const compileOptions = {
    style: options.sassStyle,
    sourceMap: options.emitCssSourceMap,
    sourceMapIncludeSources: options.sourcesContentPolicy === "embed"
  };
  const result = options.emitCoordinateProfile
    ? sass.compileString(sourceText, {
      ...compileOptions,
      url: pathToFileURL(sourceFile),
      syntax: inferSassDocInputKind(sourceFile) === "sass" ? "indented" : "scss"
    })
    : sass.compile(sourceFile, compileOptions);
  return {
    css: ensureTrailingNewline(result.css),
    sourceMap: normalizeSassSourceMap(result.sourceMap, outputDirectory),
    rawMapSources: result.sourceMap?.sources ?? []
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
  assertKnownKeys(runnerOptions, ["emitDocSourceMap", "emitCssSourceMap", "emitCoordinateProfile", "sourcesContentPolicy", "writeResultManifest", "sassStyle"], "options");
  if (runnerOptions.emitCoordinateProfile !== undefined && typeof runnerOptions.emitCoordinateProfile !== "boolean") {
    throw new TypeError("emitCoordinateProfile must be a boolean.");
  }
  const sourcesContentPolicy = runnerOptions.sourcesContentPolicy ?? "none";
  if (!["none", "reference", "embed"].includes(sourcesContentPolicy)) {
    throw new TypeError(`Unsupported sourcesContentPolicy: ${sourcesContentPolicy}`);
  }
  const sassStyle = runnerOptions.sassStyle ?? "expanded";
  if (!["expanded", "compressed"].includes(sassStyle)) {
    throw new TypeError(`Unsupported Sass style: ${sassStyle}`);
  }
  if (runnerOptions.emitCoordinateProfile === true
    && (runnerOptions.emitDocSourceMap === false || runnerOptions.emitCssSourceMap === false || sourcesContentPolicy !== "none")) {
    throw new TypeError("emitCoordinateProfile requires both source maps and sourcesContentPolicy none.");
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
      emitCoordinateProfile: runnerOptions.emitCoordinateProfile === true,
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
