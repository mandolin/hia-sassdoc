# HIA SassDoc

HIA SassDoc is the Sass and SCSS documentation workspace for HIA.

This repository is planned as an umbrella monorepo for Sass documentation specification, extraction, generated CSS documentation bridging, HIA adapter output and documentation source-map linkage.

## Packages

- `@hia-doc/sassdoc-spec`: Sass documentation annotation, tag registry and rule drafts.
- `@hia-doc/sass-doc-extractor`: Sass source to SassDoc extraction artifact.
- `@hia-doc/sass-doc-adapter`: SassDoc extraction artifact to HIA core document.
- `@hia-doc/sass-to-css-doc-source-map`: Sass to CSS documentation source-map linkage.
- `@hia-doc/sass-cssdoc-bridge`: SassDoc and CSSDoc bridge.

## Status

This workspace is currently a bootstrap skeleton. Runtime parser dependencies and public package publishing remain intentionally disabled until the foundation ADRs are accepted.

## Development

```sh
npm run release:gate
```
