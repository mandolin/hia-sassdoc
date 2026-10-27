# Changelog

## Unreleased

- 修正简单 Sass 规则与后继规则同行时的源码范围：排他终点止于本规则右括号后；仅扫到开头行的多行规则、嵌套、插值或无法核实的语法保留未知精度，不误指后继规则。
- Fix same-line Sass rule provenance: a verified exclusive range stops after its own closing brace; multiline rules seen only on the opening line, nested or interpolated rules, and uncertain syntax retain unknown precision instead of pointing at a later rule.
- 文档源码映射缺少可选范围或CSS选择器时省略字段，保留设计token和其它符号本身，避免null违反中性契约。
- Documentation maps omit absent optional ranges/selectors while preserving design tokens and other symbols, avoiding null values rejected by the neutral contract.
- 契约与包版本保持；本项描述源码变化，不表示已经发布npm。Contract/package versions are unchanged; these source changes are not an npm publication.

- Add `@hia-doc/sassdoc-runner` and `@hia-doc/sassdoc-producer`.
- Add standalone SassDoc config, CLI, producer result, pack gate and runner tests.
- Move the Sass-to-CSS fixture generation onto the shared runner API.

## 0.0.0

- Initialize HIA SassDoc bootstrap workspace.
- Add W-P6.4 no-dependency Sass -> CSS documentation source-map fixture spike.
- Add W-P9.3 Dart Sass fixture compiler dependency review and real source-map hardening path.
