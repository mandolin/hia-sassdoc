# Fixtures

## `doc-source-map/sass-css`

W-P9.3 Dart Sass fixture for Sass -> CSS documentation linkage.

Files:

- `src/button.scss`: source fixture with CSSDoc-compatible annotation.
- `dist/button.css`: Dart Sass generated CSS fixture.
- `dist/button.css.map`: Dart Sass ordinary source map fixture normalized for path privacy.
- `dist/button.cssdoc.json`: CSSDoc extraction artifact fixture.
- `dist/button.docmap.json`: `doc-source-map@1.1.0` manifest fixture with an unknown multiline component range and an exclusive UTF-16 standalone token range.
- `dist/button.hia.json`: HIA core document fixture.

Run:

```sh
npm run test
```

The fixture validates contract shape, safe relative paths, `sourcesContentPolicy: none`, reserved `x_doc_source_map` pointer metadata, real source-map mappings and HIA core document compatibility. A line-only scan of the multiline `.button` rule cannot prove its closing boundary, so that reference is `unknown`; the standalone `$button-color` token keeps exclusive UTF-16 evidence. Historical `0.1.0-draft` extraction inputs without per-range evidence remain readable but receive `unknown` source range conventions in a newly generated map.
