/**
 * @file
 * @lang zh-CN Sass映射缺少范围/选择器时省略可选字段，不能输出schema不接受的null。
 * @lang en Sass maps omit optional ranges/selectors when absent rather than emitting schema-invalid nulls.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createSassToCssDocumentationSourceMap } from "../packages/sass-to-css-doc-source-map/src/index.mjs";

test("omits missing optional selector and range without dropping the symbol", () => {
  // <lang><zh-CN>设计token可无CSS选择器或已知精确位置，但文档条目仍须保留。</zh-CN><en>A design token may lack a CSS selector or exact position while its documentation entry must be retained.</en></lang>
  const manifest = createSassToCssDocumentationSourceMap({ sassExtraction: { symbols: [{ id: "token:public", kind: "sass-design-token" }] } });
  assert.equal(manifest.entries.length, 1);
  assert.equal(Object.hasOwn(manifest.entries[0].artifactRefs[0], "selector"), false);
  assert.equal(Object.hasOwn(manifest.entries[0].sourceRefs[0], "range"), false);
  assert.equal(Object.hasOwn(manifest.entries[0].sourceRefs[0], "rangeConvention"), false);
  assert.equal(manifest.contractVersion, "1.1.0");
});

test("legacy external extraction does not inherit an inferred endpoint or unit", () => {
  // <lang><zh-CN>旧标签只证明来源名称，不证明终点或列单位；旧提取输入仍可无损读取。</zh-CN><en>A legacy label proves only its origin name, not endpoint or column units; older extraction input remains readable.</en></lang>
  const range = { start: { line: 2, column: 1 }, end: { line: 2, column: 9 } };
  const manifest = createSassToCssDocumentationSourceMap({
    sassExtraction: { symbols: [{ id: "component:Legacy", kind: "sass-component-style", source: { range, rangeSource: "sassdoc-parser" } }] }
  });
  const ref = manifest.entries[0].sourceRefs[0];
  assert.deepEqual(ref.range, range);
  assert.deepEqual(ref.rangeConvention, { endBoundary: "unknown", columnUnit: "unknown" });
  assert.equal(ref.rangeSource, "parser");
  assert.equal(ref.rangeSourceDetail, "sassdoc-parser");
});

test("explicit columnless and malformed range evidence cannot claim precise lookup", () => {
  // <lang><zh-CN>未知范围允许无列；显式声称 UTF-16 却缺列时拒绝，而不是产出 schema 失配工件。</zh-CN><en>Unknown ranges may omit columns; an explicit UTF-16 claim without columns is rejected instead of producing a schema-invalid artifact.</en></lang>
  const range = { start: { line: 1 }, end: { line: 2 } };
  const symbol = { id: "component:External", kind: "sass-component-style", source: { range, rangeConvention: { endBoundary: "unknown", columnUnit: "unknown" } } };
  const accepted = createSassToCssDocumentationSourceMap({ sassExtraction: { symbols: [symbol] } });
  assert.deepEqual(accepted.entries[0].sourceRefs[0].rangeConvention, { endBoundary: "unknown", columnUnit: "unknown" });
  symbol.source.rangeConvention = { endBoundary: "exclusive", columnUnit: "utf16-code-unit" };
  assert.throws(() => createSassToCssDocumentationSourceMap({ sassExtraction: { symbols: [symbol] } }), /Invalid Sass source rangeConvention evidence/);
  symbol.source.rangeConvention = { endBoundary: "unknown", columnUnit: "unknown", privateHint: "discard me" };
  assert.throws(() => createSassToCssDocumentationSourceMap({ sassExtraction: { symbols: [symbol] } }), /Invalid Sass source rangeConvention evidence/);
});

test("annotation fallback does not borrow unrelated source evidence", () => {
  // <lang><zh-CN>来源本身无范围时，注释回退不能借用它的范围约定或解析器来源标签。</zh-CN><en>When the source has no range, an annotation fallback cannot borrow its convention or parser origin label.</en></lang>
  const range = { start: { line: 3, column: 1 }, end: { line: 3, column: 8 } };
  const manifest = createSassToCssDocumentationSourceMap({
    sassExtraction: { symbols: [{
      id: "component:Fallback",
      kind: "sass-component-style",
      source: { rangeSource: "sassdoc-parser", rangeConvention: { endBoundary: "exclusive", columnUnit: "utf16-code-unit" } },
      annotation: { range }
    }] }
  });
  const ref = manifest.entries[0].sourceRefs[0];
  assert.deepEqual(ref.range, range);
  assert.deepEqual(ref.rangeConvention, { endBoundary: "unknown", columnUnit: "unknown" });
  assert.equal(ref.rangeSource, "adapter");
  assert.equal(ref.rangeSourceDetail, "external-annotation");
});
