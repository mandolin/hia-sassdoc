# SassDoc Runner

Standalone SassDoc project runner and CLI.

`runSassDoc()` compiles Sass/SCSS with Dart Sass, extracts SassDoc annotations, emits CSSDoc bridge artifacts, writes HIA documents, and produces a `documentation-producer-result` manifest.

When enabled, the documentation source map uses `doc-source-map@1.1.0`; its actual `contractVersion` is copied to the HIA document reference and producer artifact. `emitDocSourceMap: false` omits the map file and both references.
