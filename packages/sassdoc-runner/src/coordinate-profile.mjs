import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

/**
 * 将严格 UTF-8 输入解码为编译器与文档提取器共用的原始逻辑文本。
 * Decodes strict UTF-8 into the unmodified logical text shared by Sass and the documentation extractor.
 *
 * @param {Uint8Array} sourceBytes 已授权的主输入原始字节 / Authorized primary source bytes.
 * @returns {string} 保留已有 BOM 与 CRLF 的逻辑文本 / Logical text preserving an existing BOM and CRLF.
 * @throws {TypeError} 输入过大或 UTF-8 无效 / Oversized input or malformed UTF-8.
 */
export function decodeCoordinateSource(sourceBytes) {
  // <lang><zh-CN>侧载读取器每份来源最多接收 16 MiB；生产器不能生成随后必被拒绝的证据。</zh-CN><en>The strict reader admits at most 16 MiB per source; do not produce evidence it must reject.</en></lang>
  if (!(sourceBytes instanceof Uint8Array) || sourceBytes.byteLength > 16 * 1024 * 1024) {
    throw new TypeError("Coordinate source must be at most 16 MiB of bytes.");
  }
  // <lang><zh-CN>ignoreBOM=true 表示保留已有 U+FEFF；fatal=true 阻止替换字符伪造逻辑版本。</zh-CN><en>ignoreBOM=true preserves an existing U+FEFF; fatal=true prevents replacement characters from inventing a logical version.</en></lang>
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(sourceBytes);
}

/**
 * 从同轮实际写入的双图及主来源快照构造 Sass 的独立逐槽位证据侧载。
 * Constructs Sass's independent per-slot sidecar from both actual written maps and the primary source snapshot.
 *
 * @param {object} input 同轮编译的原始槽位、地图对象与实际字节 / Raw slots, map objects, and actual bytes from one compilation.
 * @returns {object} 不含源码正文或来源路径的草案侧载 / Draft sidecar without source body or source path.
 * @throws {TypeError} 工件过大、字节变化或主槽位重复 / Oversized or changed artifacts, or duplicate primary slots.
 */
export function createSassCoordinateProfile(input) {
  // <lang><zh-CN>这些输入属于同一次主来源编译；实际 map 字节由私有 staging 或最终输出路径读取。</zh-CN><en>These inputs come from one primary-source compilation; actual map bytes are read from private staging or final output paths.</en></lang>
  const {
    sourceBytes,
    sourceText,
    sourceFile,
    rawMapSources,
    ordinaryMap,
    ordinaryMapBytes,
    documentationMap,
    documentationMapBytes,
    inputIndex
  } = input;

  // <lang><zh-CN>只接受本次写入的真实字节快照；内存对象和磁盘工件不一致时不发布任何侧载。</zh-CN><en>Accept only the actual bytes written for this build; mismatched in-memory and disk artifacts cannot produce a sidecar.</en></lang>
  if (!(ordinaryMapBytes instanceof Uint8Array) || !(documentationMapBytes instanceof Uint8Array)
    || ordinaryMapBytes.byteLength > 16 * 1024 * 1024 || documentationMapBytes.byteLength > 16 * 1024 * 1024
    || !Buffer.from(ordinaryMapBytes).equals(serializedJson(ordinaryMap))
    || !Buffer.from(documentationMapBytes).equals(serializedJson(documentationMap))) {
    throw new TypeError("Coordinate map bytes do not match this build.");
  }
  if (!(sourceBytes instanceof Uint8Array) || typeof sourceText !== "string"
    || decodeCoordinateSource(sourceBytes) !== sourceText) {
    throw new TypeError("Coordinate source text does not match its input bytes.");
  }
  if (!Array.isArray(rawMapSources) || !Array.isArray(ordinaryMap.sources)
    || rawMapSources.length !== ordinaryMap.sources.length
    || !Array.isArray(ordinaryMap.sourcesContent) || ordinaryMap.sourcesContent.length !== 0) {
    throw new TypeError("Coordinate source slots or source-content policy are invalid.");
  }

  // <lang><zh-CN>使用 Dart Sass 原始 file URL 的槽位序号，而非归一化的相对路径；无段可保留空证据，重复主槽必须拒绝。</zh-CN><en>Use the original Dart Sass file-URL slot index rather than a normalized relative path; a map without segments can have empty evidence, while duplicate primary slots are rejected.</en></lang>
  const primaryUrl = pathToFileURL(sourceFile).href;
  const primarySlots = rawMapSources.flatMap((value, index) => value === primaryUrl ? [index] : []);
  if (primarySlots.length > 1) {
    throw new TypeError("Coordinate primary source slot is duplicated.");
  }

  // <lang><zh-CN>本版 Sass 文档图仅声明主来源；导入文件可以出现在普通图中，但没有独立文档来源身份时不制造证据。</zh-CN><en>This Sass documentation map declares only the primary source; imports may appear in the ordinary map but receive no invented evidence.</en></lang>
  if (documentationMap.contract !== "doc-source-map" || documentationMap.contractVersion !== "1.1.0"
    || documentationMap.privacy?.sourcesContentPolicy !== "none"
    || documentationMap.sources?.length !== 1 || documentationMap.sourceMaps?.length !== 1) {
    throw new TypeError("Coordinate documentation map does not declare one private primary source.");
  }
  // <lang><zh-CN>只取文档图已经声明的主来源和映射身份，不按归一化路径推断新 ID。</zh-CN><en>Use only primary source and mapping identities already declared by the documentation map; do not infer new IDs from normalized paths.</en></lang>
  const sourceId = documentationMap.sources[0]?.id;
  const sourceMap = documentationMap.sourceMaps[0];
  if (typeof sourceId !== "string" || sourceMap?.mapsTo?.length !== 1 || sourceMap.mapsTo[0] !== sourceId
    || sourceMap.sourcesContentPolicy !== "none"
    || !documentationMap.artifacts?.some((artifact) => artifact.id === sourceMap.mapsFrom)) {
    throw new TypeError("Coordinate documentation identities are not linked.");
  }

  // <lang><zh-CN>revision 是同一原始字节的公开安全内容标签；真正的版本核验仍依赖读取器现场重算两种摘要。</zh-CN><en>The revision is a public-safe content label; the reader must still recompute both digests over authorized bytes.</en></lang>
  const sourceSlots = primarySlots.length === 0 ? [] : [{
    sectionIndex: null,
    sourceIndex: primarySlots[0],
    sourceId,
    columnUnit: "utf16-code-unit",
    sourceRevision: `content-sha256:${createHash("sha256").update(sourceBytes).digest("hex")}`,
    sourceByteDigest: { algorithm: "sha256", value: sha256(sourceBytes) },
    sourceTextEncoding: "utf-8",
    sourceTextTransform: "none",
    sourceTextDigest: {
      representation: "decoded-utf16-code-units",
      algorithm: "sha256",
      value: sha256(Buffer.from(sourceText, "utf16le"))
    }
  }];
  // <lang><zh-CN>零段普通图仍能附上双图身份，但不记录可误当已核的主来源槽位；严格查询只会给未核。</zh-CN><en>A zero-segment ordinary map may still bind the two map identities but carries no purportedly verified source slot; strict queries remain unverified.</en></lang>
  const profile = {
    contract: "ordinary-source-map-coordinate-profile",
    contractVersion: "0.1.0-draft",
    id: `coordinate-profile:sass-css:input-${inputIndex + 1}`,
    ordinaryMap: {
      sourceMapId: sourceMap.id,
      artifactId: sourceMap.mapsFrom,
      digest: { algorithm: "sha256", value: sha256(ordinaryMapBytes) }
    },
    documentationMap: {
      id: documentationMap.id,
      contractVersion: "1.1.0",
      digest: { algorithm: "sha256", value: sha256(documentationMapBytes) }
    },
    sourceSlots,
    privacy: { sourcesContentPolicy: "none" }
  };
  if (serializedJson(profile).byteLength > 2 * 1024 * 1024) {
    throw new TypeError("Coordinate profile exceeds the 2 MiB reader limit.");
  }
  return profile;
}

/**
 * @lang zh-CN 与 runner 的 writeJson 使用相同 UTF-8、缩进和尾换行。
 * @lang en Matches the runner's writeJson UTF-8 indentation and trailing newline.
 * @param {unknown} value 待写入的 JSON 值 / JSON value to write.
 * @returns {Buffer} 精确序列化字节 / Exact serialized bytes.
 */
function serializedJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * @lang zh-CN 返回 SHA-256 摘要本身的规范 Base64，而非原始输入的编码。
 * @lang en Returns canonical Base64 of the SHA-256 digest, never an encoding of input content.
 * @param {Uint8Array} bytes 实际原始字节或明示的逻辑 UTF-16LE 字节 / Actual raw bytes or explicitly derived logical UTF-16LE bytes.
 * @returns {string} 32 字节摘要的规范 Base64 / Canonical Base64 of the 32-byte digest.
 */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64");
}
