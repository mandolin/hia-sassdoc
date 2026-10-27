# HIA SassDoc

HIA SassDoc is the Sass and SCSS documentation workspace for HIA.

This repository is planned as an umbrella monorepo for Sass documentation specification, extraction, generated CSS documentation bridging, HIA adapter output and documentation source-map linkage.

## Packages

- `@hia-doc/sassdoc-spec`: Sass documentation annotation, tag registry and rule drafts.
- `@hia-doc/sass-doc-extractor`: Sass source to SassDoc extraction artifact.
- `@hia-doc/sass-doc-adapter`: SassDoc extraction artifact to HIA core document.
- `@hia-doc/sass-to-css-doc-source-map`: Sass to CSS documentation source-map linkage.
- `@hia-doc/sass-cssdoc-bridge`: SassDoc and CSSDoc bridge.
- `@hia-doc/sassdoc-runner`: Standalone SassDoc API, config loader and CLI.
- `@hia-doc/sassdoc-producer`: Documentation producer adapter for HIA project builds.

## Status

This workspace has a W-P11.3 standalone runner surface for Sass-to-CSS documentation source-map linkage. Public package publishing remains intentionally disabled until package naming and release sequencing are finalized.

## Fixtures

The first fixture lives under `fixtures/doc-source-map/sass-css/` and demonstrates:

- SCSS source with CSSDoc-compatible annotation.
- Dart Sass generated CSS fixture.
- CSSDoc extraction artifact.
- `doc-source-map@1.1.0` manifest with per-source-reference endpoint and column-unit declarations.
- HIA core document fixture.

This fixture is generated with Dart Sass `1.101.0` under the repository-local mise toolchain. It validates the artifact contract, source-map path normalization and path/privacy rules.

Plain Sass selector, variable, and comment branches carry verified exclusive UTF-16 ranges. Complex scanner results and external extraction input without explicit evidence carry `unknown` conventions and cannot support exact position lookup. The HIA document and producer result reference the emitted map's actual version; disabling map output omits both the file and its references.

## Standalone Usage

```sh
sassdoc --config examples/standalone/sassdoc.config.json
```

The runner writes generated CSS, ordinary source map, SassDoc extraction, CSSDoc bridge artifact, HIA document, doc-source-map manifest and `sassdoc.producer-result.json`.

## Development

```sh
mise exec -- npm run test
mise exec -- npm run release:gate
```
