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

test("real Sass runner does not extend a verified rule into its same-line neighbor", async () => {
  // <lang><zh-CN>两个顶层规则都由 Dart Sass 编译；文档地图仅能把首规则的已证范围止于自己的右括号后。</zh-CN><en>Dart Sass compiles both top-level rules; the verified documentation range for the first must stop just after its own closing brace.</en></lang>
  const firstRule = ".a{color:red;}";
  const secondRule = ".b{color:blue;}";
  const cases = [
    { name: "spaced", ruleLine: `${firstRule} ${secondRule}` },
    { name: "adjacent", ruleLine: `${firstRule}${secondRule}` }
  ];
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "hia-sass-dual-rule-"));
  try {
    // <lang><zh-CN>经正式 runner 取实际提取件和 1.1.0 地图，防止只修测试替身。</zh-CN><en>Read the actual extraction and 1.1.0 map through the production runner, avoiding a test-only shortcut.</en></lang>
    const outputDirectory = path.join(workspaceRoot, "dist");
    for (const item of cases) {
      const source = ["/**", " * @component A", " * @selector .a", " */", item.ruleLine].join("\n");
      await writeFile(path.join(workspaceRoot, `${item.name}.scss`), source, "utf8");
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
      const range = {
        start: { line: 5, column: 1 },
        end: { line: 5, column: firstRule.length + 1 }
      };
      assert.match(css, /\.a\s*\{/u);
      assert.match(css, /\.b\s*\{/u);
      assert.deepEqual(extraction.symbols[0].source.range, range);
      assert.deepEqual(map.entries[0].sourceRefs[0].range, range);
      assert.deepEqual(map.entries[0].sourceRefs[0].rangeConvention, {
        endBoundary: "exclusive", columnUnit: "utf16-code-unit"
      });
      assert.ok(firstRule.length + 1 <= item.ruleLine.indexOf(secondRule) + 1);
    }
  } finally {
    // <lang><zh-CN>递归删除前核对目标是系统临时目录直属且带本测试前缀的真实路径。</zh-CN><en>Before recursive removal, verify the real target is a direct child of system temp with this test's prefix.</en></lang>
    const actualTempRoot = await realpath(os.tmpdir());
    const actualWorkspaceRoot = await realpath(workspaceRoot);
    const relativeWorkspaceRoot = path.relative(actualTempRoot, actualWorkspaceRoot);
    if (!path.isAbsolute(actualWorkspaceRoot)
      || path.isAbsolute(relativeWorkspaceRoot)
      || path.dirname(relativeWorkspaceRoot) !== "."
      || !relativeWorkspaceRoot.startsWith("hia-sass-dual-rule-")) {
      throw new Error("Refusing recursive cleanup outside the Sass dual-rule test directory.");
    }
    await rm(actualWorkspaceRoot, { recursive: true });
  }
});

test("plain Sass rule boundary skips quoted and commented braces and rejects uncertain syntax", () => {
  // <lang><zh-CN>词法正控要跳过字面内容中的右括号；后继规则的插值不应降级已完成的首规则。</zh-CN><en>Lexical controls must skip braces in literals; interpolation in a later rule must not downgrade the completed first rule.</en></lang>
  const precise = [
    { line: '.a{content:"}";} .b{color:blue;}', first: '.a{content:"}";}' },
    { line: '.a{/* } */ color:red;} .b{color:blue;}', first: '.a{/* } */ color:red;}' },
    { line: String.raw`.a{content:"\"}";} .b{color:blue;}`, first: String.raw`.a{content:"\"}";}` },
    { line: '.a{color:red;} .b-#{$state}{color:blue;}', first: '.a{color:red;}' }
  ];
  for (const item of precise) {
    const source = ["/**", " * @component A", " * @selector .a", " */", item.line].join("\n");
    const extraction = extractSassDoc(source, { path: "case.scss" });
    const map = createSassToCssDocumentationSourceMap({ sassExtraction: extraction });
    assert.deepEqual(map.entries[0].sourceRefs[0].range, {
      start: { line: 5, column: 1 }, end: { line: 5, column: item.first.length + 1 }
    });
    assert.deepEqual(map.entries[0].sourceRefs[0].rangeConvention, {
      endBoundary: "exclusive", columnUnit: "utf16-code-unit"
    });
  }

  // <lang><zh-CN>嵌套、插值、行注释和未证转义须保留范围线索，但不能标为精确坐标。</zh-CN><en>Nesting, interpolation, line comments, and unverified escapes retain location hints without claiming exact coordinates.</en></lang>
  const uncertain = [
    '.a{.inner{color:red;}}',
    '.a{color:#{red};}',
    '.a{color:red; // }',
    String.raw`.a{content:\};}`
  ];
  for (const line of uncertain) {
    const source = ["/**", " * @component A", " * @selector .a", " */", line].join("\n");
    const extraction = extractSassDoc(source, { path: "case.scss" });
    const map = createSassToCssDocumentationSourceMap({ sassExtraction: extraction });
    assert.deepEqual(map.entries[0].sourceRefs[0].range, extraction.symbols[0].source.range);
    assert.deepEqual(map.entries[0].sourceRefs[0].rangeConvention, {
      endBoundary: "unknown", columnUnit: "unknown"
    });
  }

  // <lang><zh-CN>规则右括号在下一行时，首行范围不是完整规则，必须保留未知。</zh-CN><en>When the closing brace is on a later line, the opening-line range is not the complete rule and must stay unknown.</en></lang>
  const multiline = ["/**", " * @component A", " * @selector .a", " */", ".a {", "  color: red;", "}"].join("\n");
  const extraction = extractSassDoc(multiline, { path: "case.scss" });
  const map = createSassToCssDocumentationSourceMap({ sassExtraction: extraction });
  assert.deepEqual(map.entries[0].sourceRefs[0].rangeConvention, {
    endBoundary: "unknown", columnUnit: "unknown"
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
