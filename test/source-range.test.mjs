/**
 * @file
 * @lang zh-CN 验证 Sass 组件源码范围只指向实际规则，并在缺少规则时明确退回注释范围。
 * @lang en Verifies that Sass component source ranges select actual rules and explicitly fall back to annotation ranges.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extractSassDoc } from "../packages/sass-doc-extractor/src/index.mjs";
import { createSassToCssDocumentationSourceMap } from "../packages/sass-to-css-doc-source-map/src/index.mjs";
import { runSassDoc } from "../packages/sassdoc-runner/src/index.mjs";

test("component selector ignores its tag and preceding comment", () => {
  // <lang><zh-CN>标签与注释都包含选择器，真实规则位于第六行。</zh-CN><en>The tag and comment contain the selector; the actual rule is on line six.</en></lang>
  const rule = ".card { /* 🔥 */ color: red; }";
  const source = ["/**", " * @component Card", " * @selector .card", " */", "// .card", rule].join("\r\n");
  const extraction = extractSassDoc(source, { path: "card.scss" });
  const component = extraction.symbols.find((symbol) => symbol.kind === "sass-component-style");
  const map = createSassToCssDocumentationSourceMap({ sassExtraction: extraction });

  assert.ok(component);
  assert.deepEqual(component.source.range, {
    start: { line: 6, column: 1 },
    end: { line: 6, column: rule.length + 1 }
  });
  assert.equal(component.source.rangeSource, "sassdoc-parser");
  assert.deepEqual(map.entries[0].sourceRefs[0].range, component.source.range);
  assert.equal(map.contractVersion, "1.1.0");
  assert.deepEqual(map.entries[0].sourceRefs[0].rangeConvention, {
    endBoundary: "exclusive",
    columnUnit: "utf16-code-unit"
  });
  assert.equal(map.entries[0].sourceRefs[0].rangeSource, "parser");
  assert.equal(map.entries[0].sourceRefs[0].rangeSourceDetail, "sassdoc-parser");
  assert.equal(rule.length - Array.from(rule).length, 1);
});

test("component without a matching rule falls back to its annotation", () => {
  // <lang><zh-CN>前缀相似的选择器不是同一规则；没有真实规则时只能指向注释。</zh-CN><en>A similarly prefixed selector is not the same rule; without a real rule only the annotation can be located.</en></lang>
  const source = ["/**", " * @component Card", " * @selector .card", " */", ".cardish { color: red; }"].join("\n");
  const extraction = extractSassDoc(source, { path: "card.scss" });
  const component = extraction.symbols.find((symbol) => symbol.kind === "sass-component-style");

  assert.ok(component);
  assert.deepEqual(component.source.range, component.annotation.range);
  assert.equal(component.source.rangeSource, "annotation");
  assert.equal(component.source.confidence, "medium");
  const map = createSassToCssDocumentationSourceMap({ sassExtraction: extraction });
  assert.deepEqual(map.entries[0].sourceRefs[0].rangeConvention, {
    endBoundary: "exclusive",
    columnUnit: "utf16-code-unit"
  });
  assert.equal(map.entries[0].sourceRefs[0].rangeSourceDetail, "annotation");
});

test("component selector can start after a same-line annotation", () => {
  // <lang><zh-CN>同一行的规则必须从注释结束之后检索，避免把标签内容当作规则。</zh-CN><en>A same-line rule must be searched after the annotation end to avoid selecting tag text.</en></lang>
  const source = "/** @component Card\n * @selector .card */ .card:hover { color: red; }";
  const extraction = extractSassDoc(source, { path: "card.scss" });
  const component = extraction.symbols.find((symbol) => symbol.kind === "sass-component-style");

  assert.ok(component);
  const ruleLine = source.split("\n")[1];
  assert.deepEqual(component.source.range, {
    start: { line: 2, column: ruleLine.indexOf(".card:hover") + 1 },
    end: { line: 2, column: ruleLine.length + 1 }
  });
  const map = createSassToCssDocumentationSourceMap({ sassExtraction: extraction });
  assert.deepEqual(map.entries[0].sourceRefs[0].rangeConvention, {
    endBoundary: "unknown",
    columnUnit: "unknown"
  });
});

test("complex interpolated token range remains an unknown location hint", () => {
  // <lang><zh-CN>跨行或插值变量可由正则找到数值范围，但不能据此声称 Sass 语义定位精确。</zh-CN><en>A regex may find a numeric range in an interpolated assignment without proving its Sass semantic location.</en></lang>
  const source = "/** @component Card\n * @token color.card */\n$card-color: #{theme(color)};\n.card { color: red; }";
  const extraction = extractSassDoc(source, { path: "card.scss" });
  const map = createSassToCssDocumentationSourceMap({ sassExtraction: extraction });
  const token = map.entries.find((entry) => entry.kind === "design-token-link");
  assert.ok(token);
  assert.deepEqual(token.sourceRefs[0].rangeConvention, {
    endBoundary: "unknown",
    columnUnit: "unknown"
  });
});

test("real Sass runner keeps nested, interpolated, and multiline selectors as unknown range hints", async () => {
  // <lang><zh-CN>三个可编译的输入分别覆盖同名嵌套规则、选择器插值和 CRLF 跨行组合。</zh-CN><en>Three compilable inputs cover a nested same-name rule, selector interpolation, and a CRLF multiline combination.</en></lang>
  const cases = [
    {
      name: "nested-same-name",
      source: [
        "/**", " * @component Item", " * @selector .item", " */",
        ".wrapper {", "  .item { color: red; }", "}", ".item { color: blue; }"
      ].join("\n"),
      start: { line: 6, column: 3 }
    },
    {
      name: "interpolated-selector",
      source: [
        "$state: active;", "/**", " * @component DynamicItem",
        " * @selector .item-#{$state}", " */", ".item-#{$state} { color: red; }"
      ].join("\n"),
      start: { line: 6, column: 1 }
    },
    {
      name: "combined-selector-crlf",
      source: [
        "/**", " * @component Combined", " * @selector .first", " */",
        ".first,", ".second { color: red; }"
      ].join("\r\n"),
      start: { line: 5, column: 1 }
    }
  ];
  // <lang><zh-CN>隔离输出避免污染仓库工件；真实运行器还会经过 Dart Sass 编译。</zh-CN><en>Isolate outputs from repository artifacts; the real runner also compiles each input with Dart Sass.</en></lang>
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sass-range-"));
  try {
    const outputDirectory = path.join(workspaceRoot, "dist");
    for (const item of cases) {
      await writeFile(path.join(workspaceRoot, `${item.name}.scss`), item.source, "utf8");
    }
    const result = await runSassDoc({
      workspaceRoot,
      outputDirectory,
      inputs: cases.map((item) => ({ kind: "scss", path: `${item.name}.scss`, artifactBasePath: item.name })),
      options: { writeResultManifest: false }
    });
    assert.equal(result.status, "success", JSON.stringify(result.diagnostics));
    for (const item of cases) {
      const extraction = JSON.parse(await readFile(path.join(outputDirectory, `${item.name}.sassdoc.json`), "utf8"));
      const map = JSON.parse(await readFile(path.join(outputDirectory, `${item.name}.docmap.json`), "utf8"));
      const css = await readFile(path.join(outputDirectory, `${item.name}.css`), "utf8");
      const ref = map.entries[0].sourceRefs[0];
      assert.ok(css.trim(), `${item.name} CSS output`);
      assert.equal(map.contractVersion, "1.1.0");
      assert.deepEqual(ref.range.start, item.start);
      assert.deepEqual(ref.range, extraction.symbols[0].source.range);
      assert.deepEqual(ref.rangeConvention, { endBoundary: "unknown", columnUnit: "unknown" });
    }
  } finally {
    // <lang><zh-CN>递归清理前核真实绝对路径只能是系统 temp 下本测试创建的单层前缀目录。</zh-CN><en>Before recursive cleanup, verify the real absolute target is a single prefixed test directory directly under system temp.</en></lang>
    const actualTempRoot = await realpath(os.tmpdir());
    const actualWorkspaceRoot = await realpath(workspaceRoot);
    const relativeWorkspaceRoot = path.relative(actualTempRoot, actualWorkspaceRoot);
    if (!path.isAbsolute(actualWorkspaceRoot)
      || path.isAbsolute(relativeWorkspaceRoot)
      || path.dirname(relativeWorkspaceRoot) !== "."
      || !relativeWorkspaceRoot.startsWith("hia-sass-range-")) {
      throw new Error("Refusing recursive cleanup outside the Sass range test directory.");
    }
    await rm(actualWorkspaceRoot, { recursive: true });
  }
});

test("plain selector after a non-BMP annotation uses one-based UTF-16 and an exclusive end", () => {
  // <lang><zh-CN>注释中的非 BMP 字符位于规则同一行，UTF-16 列比 Unicode 码点列多一。</zh-CN><en>A non-BMP character precedes the rule on the same line, making its UTF-16 column one greater than its code-point column.</en></lang>
  const source = "/** @component Plain\n * @selector .card\n * @lang en 😀 */ .card { color: red; }";
  const line = source.split("\n")[2];
  const extraction = extractSassDoc(source, { path: "plain.scss" });
  const map = createSassToCssDocumentationSourceMap({ sassExtraction: extraction });
  const ref = map.entries[0].sourceRefs[0];
  assert.equal(ref.range.start.column, line.lastIndexOf(".card") + 1);
  assert.equal(ref.range.start.column - (Array.from(line.slice(0, line.lastIndexOf(".card"))).length + 1), 1);
  assert.deepEqual(ref.range, {
    start: { line: 3, column: 19 },
    end: { line: 3, column: line.length + 1 }
  });
  assert.deepEqual(ref.rangeConvention, { endBoundary: "exclusive", columnUnit: "utf16-code-unit" });
});
