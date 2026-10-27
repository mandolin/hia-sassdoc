import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SASSDOC_CONFIG_SCHEMA_ID,
  SASSDOC_CONFIG_SCHEMA_VERSION,
  inferSassDocInputKind,
  loadSassDocConfig,
  runSassDoc
} from "../packages/sassdoc-runner/src/index.mjs";
import { extractSassDoc } from "../packages/sass-doc-extractor/src/index.mjs";
import { sassExtractionToHiaDocument } from "../packages/sass-doc-adapter/src/index.mjs";
import { sassdocProducer } from "../packages/sassdoc-producer/src/index.mjs";

const source = `/**
 * @component Button
 * @selector .button
 * @token color.button.foreground
 * @custom-property --button-color
 */
$button-color: #0f766e;

.button {
  --button-color: #{$button-color};
}
`;

test("SassDoc maps @lang and inline <lang> into HIA i18n fields", () => {
  const extraction = extractSassDoc(`/**
 * Button style for <lang><zh-CN>主要动作</zh-CN><en>primary actions</en></lang>.
 * @component Button
 * @selector .button
 * @lang zh-CN 按钮样式。
 */
.button { color: #0f766e; }
`, { path: "button.scss" });
  const document = sassExtractionToHiaDocument(extraction, { title: "Sass Locale" });
  const component = document.symbols.find((symbol) => symbol.id === "component:Button");

  assert.ok(document.locales.includes("zh-CN"));
  assert.equal(component.i18n.fields.description.localizedText["zh-CN"], "按钮样式。");
  assert.equal(component.i18n.fields.description.localizedText.en, "Button style for primary actions.");
});

test("runSassDoc emits producer result artifacts", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-"));
  try {
    await writeFile(path.join(workspaceRoot, "button.scss"), source, "utf8");
    const result = await runSassDoc({
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, "dist"),
      inputs: [{ kind: "scss", path: "button.scss", artifactBasePath: "button" }],
      options: { writeResultManifest: true }
    });

    assert.equal(result.contract, "documentation-producer-result");
    assert.equal(result.status, "success");
    assert.equal(result.artifacts.length, 6);
    assert.equal(result.artifacts.some((artifact) => artifact.kind === "ordinary-source-map-coordinate-profile"), false);
    assert.ok(result.artifacts.some((artifact) => artifact.kind === "sassdoc-extraction"));
    assert.ok(result.artifacts.some((artifact) => artifact.kind === "doc-source-map"));
    assert.equal(result.artifacts.find((artifact) => artifact.kind === "doc-source-map").contractVersion, "1.1.0");

    const hia = JSON.parse(await readFile(path.join(workspaceRoot, "dist", "button.hia.json"), "utf8"));
    assert.ok(hia.symbols.some((symbol) => symbol.id === "component:Button"));
    assert.equal(hia.metadata.docSourceMaps[0].contractVersion, "1.1.0");
    const docmap = JSON.parse(await readFile(path.join(workspaceRoot, "dist", "button.docmap.json"), "utf8"));
    assert.equal(docmap.contractVersion, "1.1.0");
    assert.deepEqual(docmap.entries[0].sourceRefs[0].rangeConvention, {
      endBoundary: "exclusive",
      columnUnit: "utf16-code-unit"
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("opt-in coordinate profile binds actual map and source bytes to the primary Sass slot", async () => {
  // <lang><zh-CN>合成输入同时含 BOM、CRLF 和非 BMP 字符，断言侧载两类摘要与真实文件字节一致。</zh-CN><en>Use a synthetic BOM, CRLF, and non-BMP input to bind both digest types to actual file bytes.</en></lang>
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-coordinate-"));
  const sample = "\uFEFF/** @component Card\r\n * @selector .card\r\n * @lang en 😀 */ .card { color: red; }\r\n";
  try {
    await writeFile(path.join(workspaceRoot, "card.scss"), sample, "utf8");
    const result = await runSassDoc({
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, "dist"),
      inputs: [{ kind: "scss", path: "card.scss", artifactBasePath: "card" }],
      options: { emitCoordinateProfile: true, sassStyle: "compressed" }
    });
    assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
    const artifact = result.artifacts.find((item) => item.kind === "ordinary-source-map-coordinate-profile");
    assert.equal(artifact?.path, "card.coordinate-profile.json");
    assert.equal(artifact?.contract, "ordinary-source-map-coordinate-profile");
    assert.equal(artifact?.contractVersion, "0.1.0-draft");
    const profile = JSON.parse(await readFile(path.join(workspaceRoot, "dist", artifact.path), "utf8"));
    const sourceBytes = await readFile(path.join(workspaceRoot, "card.scss"));
    const ordinaryBytes = await readFile(path.join(workspaceRoot, "dist", "card.css.map"));
    const documentationBytes = await readFile(path.join(workspaceRoot, "dist", "card.docmap.json"));
    const documentation = JSON.parse(documentationBytes.toString("utf8"));
    const ordinary = JSON.parse(ordinaryBytes.toString("utf8"));
    const digest = (bytes) => createHash("sha256").update(bytes).digest("base64");

    assert.equal(profile.contract, "ordinary-source-map-coordinate-profile");
    assert.equal(profile.contractVersion, "0.1.0-draft");
    assert.equal(profile.ordinaryMap.sourceMapId, documentation.sourceMaps[0].id);
    assert.equal(profile.ordinaryMap.artifactId, documentation.sourceMaps[0].mapsFrom);
    assert.equal(profile.ordinaryMap.digest.value, digest(ordinaryBytes));
    assert.equal(profile.documentationMap.id, documentation.id);
    assert.equal(profile.documentationMap.contractVersion, "1.1.0");
    assert.equal(profile.documentationMap.digest.value, digest(documentationBytes));
    assert.deepEqual(profile.privacy, { sourcesContentPolicy: "none" });
    assert.deepEqual(ordinary.sourcesContent, []);
    assert.equal(profile.sourceSlots.length, 1);
    assert.equal(profile.sourceSlots[0].sectionIndex, null);
    assert.equal(profile.sourceSlots[0].sourceIndex, 0);
    assert.equal(profile.sourceSlots[0].sourceId, documentation.sources[0].id);
    assert.equal(profile.sourceSlots[0].columnUnit, "utf16-code-unit");
    assert.equal(profile.sourceSlots[0].sourceByteDigest.value, digest(sourceBytes));
    assert.equal(profile.sourceSlots[0].sourceTextDigest.value, digest(Buffer.from(sample, "utf16le")));
    assert.equal(profile.sourceSlots[0].sourceTextEncoding, "utf-8");
    assert.equal(profile.sourceSlots[0].sourceTextTransform, "none");

    // <lang><zh-CN>启用侧载只增证据文件，不改同输入的既有 CSS、普通图或文档图字节。</zh-CN><en>Sidecar opt-in adds evidence without changing existing CSS, ordinary-map or documentation-map bytes for the same input.</en></lang>
    const legacy = await runSassDoc({
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, "legacy"),
      inputs: [{ kind: "scss", path: "card.scss", artifactBasePath: "card" }],
      options: { sassStyle: "compressed" }
    });
    assert.equal(legacy.status, "success", JSON.stringify(legacy.diagnostics));
    for (const file of ["card.css", "card.css.map", "card.docmap.json"]) {
      assert.deepEqual(await readFile(path.join(workspaceRoot, "dist", file)), await readFile(path.join(workspaceRoot, "legacy", file)));
    }
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("coordinate profile requires both maps and a no-content privacy policy", async () => {
  // <lang><zh-CN>无完整双图或允许嵌入源码时，在构建前拒绝侧载选项。</zh-CN><en>Reject the sidecar option before building when either map is absent or source embedding is enabled.</en></lang>
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-coordinate-options-"));
  try {
    for (const options of [
      { emitCoordinateProfile: true, emitCssSourceMap: false },
      { emitCoordinateProfile: true, emitDocSourceMap: false },
      { emitCoordinateProfile: true, sourcesContentPolicy: "reference" },
      { emitCoordinateProfile: true, sourcesContentPolicy: "embed" }
    ]) {
      await assert.rejects(runSassDoc({
        workspaceRoot,
        outputDirectory: path.join(workspaceRoot, "dist"),
        inputs: [{ kind: "scss", path: "card.scss" }],
        options
      }), { name: "TypeError", message: /emitCoordinateProfile requires both source maps and sourcesContentPolicy none/ });
    }
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("opt-in coordinate profile rejects malformed UTF-8 without publishing evidence", async () => {
  // <lang><zh-CN>不把非法字节替换成 U+FFFD 后继续声称与编译器的原始来源版本一致。</zh-CN><en>Never replace malformed bytes with U+FFFD and claim they match the compiler's original source version.</en></lang>
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-coordinate-invalid-"));
  try {
    await writeFile(path.join(workspaceRoot, "card.scss"), Buffer.from([0x2e, 0x61, 0x20, 0x7b, 0xff, 0x7d]));
    const result = await runSassDoc({
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, "dist"),
      inputs: [{ kind: "scss", path: "card.scss", artifactBasePath: "card" }],
      options: { emitCoordinateProfile: true }
    });
    assert.equal(result.status, "failed");
    assert.equal(result.artifacts.length, 0);
    await assert.rejects(readFile(path.join(workspaceRoot, "dist", "card.coordinate-profile.json")), { code: "ENOENT" });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("coordinate profile rejects a source symlink outside the workspace before compilation", async (context) => {
  // <lang><zh-CN>工作区内的路径若解析到外部，即使目标有可读 Sass 内容也不能发出侧载；Windows 用 junction 模拟目录链接。</zh-CN><en>A workspace-relative path resolving outside must produce no sidecar even when the target contains readable Sass; use a junction for Windows directory links.</en></lang>
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-coordinate-link-workspace-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-coordinate-link-outside-"));
  const linkPath = path.join(workspaceRoot, "outside");
  try {
    await writeFile(path.join(outsideRoot, "card.scss"), ".card { color: red; }\n", "utf8");
    try {
      await symlink(outsideRoot, linkPath, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
        context.skip(`Directory links unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const result = await runSassDoc({
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, "dist"),
      inputs: [{ kind: "scss", path: "outside/card.scss", artifactBasePath: "card" }],
      options: { emitCoordinateProfile: true }
    });
    assert.equal(result.status, "failed");
    assert.equal(result.artifacts.length, 0);
    await assert.rejects(readFile(path.join(workspaceRoot, "dist", "card.coordinate-profile.json")), { code: "ENOENT" });
  } finally {
    // <lang><zh-CN>先拆链接再清理测试根，避免递归清理跨过工作区边界。</zh-CN><en>Remove the link before the workspace root so cleanup cannot cross the workspace boundary.</en></lang>
    await unlink(linkPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("coordinate profile omits imported slots without a documentation source identity", async () => {
  // <lang><zh-CN>普通图可以记录导入文件，但单文件文档图只授权主输入的来源槽位。</zh-CN><en>The ordinary map may include imports, while the single-input documentation map licenses only the primary slot.</en></lang>
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-coordinate-import-"));
  try {
    await writeFile(path.join(workspaceRoot, "_tokens.scss"), "$accent: red;\n.tokens { color: $accent; }\n", "utf8");
    await writeFile(path.join(workspaceRoot, "card.scss"), '@use "tokens";\n/** @component Card\n * @selector .card */\n.card { color: tokens.$accent; }\n', "utf8");
    const result = await runSassDoc({
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, "dist"),
      inputs: [{ kind: "scss", path: "card.scss", artifactBasePath: "card" }],
      options: { emitCoordinateProfile: true }
    });
    assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
    const ordinary = JSON.parse(await readFile(path.join(workspaceRoot, "dist", "card.css.map"), "utf8"));
    const profile = JSON.parse(await readFile(path.join(workspaceRoot, "dist", "card.coordinate-profile.json"), "utf8"));
    assert.ok(ordinary.sources.length >= 2);
    assert.equal(profile.sourceSlots.length, 1);
    assert.match(ordinary.sources[profile.sourceSlots[0].sourceIndex], /card\.scss$/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("same-path rebuild replaces a previous proof with empty evidence, then revokes it on failure", async () => {
  // <lang><zh-CN>合法的仅变量输入没有 CSS 映射段，仍应成功并留下空证据；后续失败必须删除该路径旧侧载且不覆盖既有双图。</zh-CN><en>A valid variable-only source has no CSS mapping segment and succeeds with empty evidence; a later failed rebuild must revoke its old sidecar without overwriting existing maps.</en></lang>
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-coordinate-rebuild-"));
  const outputDirectory = path.join(workspaceRoot, "dist");
  const request = {
    workspaceRoot,
    outputDirectory,
    inputs: [{ kind: "scss", path: "card.scss", artifactBasePath: "card" }],
    options: { emitCoordinateProfile: true }
  };
  try {
    await writeFile(path.join(workspaceRoot, "card.scss"), source, "utf8");
    assert.equal((await runSassDoc(request)).status, "success");
    const firstProfileBytes = await readFile(path.join(outputDirectory, "card.coordinate-profile.json"));
    assert.equal(JSON.parse(firstProfileBytes.toString("utf8")).sourceSlots.length, 1);

    await writeFile(path.join(workspaceRoot, "card.scss"), "$accent: red;\n", "utf8");
    assert.equal((await runSassDoc(request)).status, "success");
    const emptyProfileBytes = await readFile(path.join(outputDirectory, "card.coordinate-profile.json"));
    const emptyProfile = JSON.parse(emptyProfileBytes.toString("utf8"));
    assert.notDeepEqual(emptyProfileBytes, firstProfileBytes);
    assert.deepEqual(emptyProfile.sourceSlots, []);
    const mapBeforeFailure = await readFile(path.join(outputDirectory, "card.css.map"));
    const documentationBeforeFailure = await readFile(path.join(outputDirectory, "card.docmap.json"));

    await writeFile(path.join(workspaceRoot, "card.scss"), Buffer.from([0xff, 0x2e, 0x61]));
    const failed = await runSassDoc(request);
    assert.equal(failed.status, "failed");
    assert.equal(failed.artifacts.length, 0);
    await assert.rejects(readFile(path.join(outputDirectory, "card.coordinate-profile.json")), { code: "ENOENT" });
    assert.deepEqual(await readFile(path.join(outputDirectory, "card.css.map")), mapBeforeFailure);
    assert.deepEqual(await readFile(path.join(outputDirectory, "card.docmap.json")), documentationBeforeFailure);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("same-path opt-out rebuild removes the prior coordinate profile", async () => {
  // <lang><zh-CN>关闭选项重建后，目录部署不能捎带上次构建的侧载摘要。</zh-CN><en>After an opt-out rebuild, publishing the directory must not carry a previous build's digest sidecar.</en></lang>
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-coordinate-optout-"));
  const outputDirectory = path.join(workspaceRoot, "dist");
  const baseRequest = {
    workspaceRoot,
    outputDirectory,
    inputs: [{ kind: "scss", path: "card.scss", artifactBasePath: "card" }]
  };
  try {
    await writeFile(path.join(workspaceRoot, "card.scss"), source, "utf8");
    assert.equal((await runSassDoc({ ...baseRequest, options: { emitCoordinateProfile: true } })).status, "success");
    assert.equal(JSON.parse(await readFile(path.join(outputDirectory, "card.coordinate-profile.json"), "utf8")).sourceSlots.length, 1);

    const optedOut = await runSassDoc({ ...baseRequest, options: { emitCoordinateProfile: false } });
    assert.equal(optedOut.status, "success");
    assert.equal(optedOut.artifacts.some((item) => item.kind === "ordinary-source-map-coordinate-profile"), false);
    await assert.rejects(readFile(path.join(outputDirectory, "card.coordinate-profile.json")), { code: "ENOENT" });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("coordinate profile compiles indented Sass from the same decoded source snapshot", async () => {
  // <lang><zh-CN>compileString 默认解析 SCSS；.sass 输入须明确启用缩进语法。</zh-CN><en>compileString defaults to SCSS, so .sass inputs must explicitly use indented syntax.</en></lang>
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-coordinate-indented-"));
  try {
    await writeFile(path.join(workspaceRoot, "card.sass"), ".card\n  color: red\n", "utf8");
    const result = await runSassDoc({
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, "dist"),
      inputs: [{ kind: "sass", path: "card.sass", artifactBasePath: "card" }],
      options: { emitCoordinateProfile: true }
    });
    assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
    assert.match(await readFile(path.join(workspaceRoot, "dist", "card.css"), "utf8"), /color: red/);
    const profile = JSON.parse(await readFile(path.join(workspaceRoot, "dist", "card.coordinate-profile.json"), "utf8"));
    assert.equal(profile.sourceSlots.length, 1);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("disabled documentation map emits no file, artifact or HIA reference", async () => {
  // <lang><zh-CN>关闭地图输出时，文档元数据及生产结果都不能声明不存在的地图。</zh-CN><en>With map output disabled, neither document metadata nor the producer result may advertise a nonexistent map.</en></lang>
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-no-map-"));
  try {
    await writeFile(path.join(workspaceRoot, "button.scss"), source, "utf8");
    const result = await runSassDoc({
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, "dist"),
      inputs: [{ kind: "scss", path: "button.scss", artifactBasePath: "button" }],
      options: { emitDocSourceMap: false }
    });
    const hia = JSON.parse(await readFile(path.join(workspaceRoot, "dist", "button.hia.json"), "utf8"));
    assert.equal(result.status, "success");
    assert.equal(result.artifacts.some((artifact) => artifact.kind === "doc-source-map"), false);
    assert.equal(Object.hasOwn(hia.metadata, "docSourceMaps"), false);
    await assert.rejects(readFile(path.join(workspaceRoot, "dist", "button.docmap.json"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("standalone HIA conversion retains its explicit legacy map identity", () => {
  // <lang><zh-CN>不经运行器的旧调用仍声明旧地图身份，避免把历史文档引用误标为新版。</zh-CN><en>Older calls outside the runner keep their legacy map identity instead of relabeling historical references.</en></lang>
  const hia = sassExtractionToHiaDocument(extractSassDoc(source, { path: "button.scss" }), {
    docSourceMapPath: "button.docmap.json"
  });
  assert.equal(hia.metadata.docSourceMaps[0].contractVersion, "0.1.0-draft");
});

test("loadSassDocConfig normalizes versioned JSON config", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-config-"));
  try {
    await writeFile(path.join(workspaceRoot, "button.scss"), source, "utf8");
    await writeFile(path.join(workspaceRoot, "sassdoc.config.json"), `${JSON.stringify({
      $schema: SASSDOC_CONFIG_SCHEMA_ID,
      schemaVersion: SASSDOC_CONFIG_SCHEMA_VERSION,
      workspaceRoot: ".",
      outputDirectory: "dist",
      inputs: [{ kind: "scss", path: "button.scss" }]
    }, null, 2)}\n`, "utf8");

    const request = await loadSassDocConfig("sassdoc.config.json", { cwd: workspaceRoot });
    assert.equal(request.inputs[0].path, "button.scss");
    assert.equal(request.options.sourcesContentPolicy, "none");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("sassdoc producer delegates to the runner", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sassdoc-producer-"));
  try {
    await writeFile(path.join(workspaceRoot, "button.scss"), source, "utf8");
    const result = await sassdocProducer.produce({
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, "dist"),
      inputs: [{ kind: "scss", path: "button.scss" }]
    });
    assert.equal(sassdocProducer.descriptor.contract, "documentation-producer");
    assert.equal(result.status, "success");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("inferSassDocInputKind recognizes indented Sass", () => {
  assert.equal(inferSassDocInputKind("styles/card.sass"), "sass");
  assert.equal(inferSassDocInputKind("styles/card.scss"), "scss");
});
