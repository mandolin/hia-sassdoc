/**
 * @file
 * @lang zh-CN 验证 Sass 组件源码范围只指向实际规则，并在缺少规则时明确退回注释范围。
 * @lang en Verifies that Sass component source ranges select actual rules and explicitly fall back to annotation ranges.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { extractSassDoc } from "../packages/sass-doc-extractor/src/index.mjs";
import { createSassToCssDocumentationSourceMap } from "../packages/sass-to-css-doc-source-map/src/index.mjs";

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
});
