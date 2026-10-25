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
});
