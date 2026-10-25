# Changelog

## Unreleased

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
