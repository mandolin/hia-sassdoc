# Fixtures

## `doc-source-map/sass-css`

W-P9.3 Dart Sass fixture for Sass -> CSS documentation linkage.

Files:

- `src/button.scss`: source fixture with CSSDoc-compatible annotation.
- `dist/button.css`: Dart Sass generated CSS fixture.
- `dist/button.css.map`: Dart Sass ordinary source map fixture normalized for path privacy.
- `dist/button.cssdoc.json`: CSSDoc extraction artifact fixture.
- `dist/button.docmap.json`: `doc-source-map@1.1.0` manifest fixture with exclusive UTF-16 source ranges.
- `dist/button.hia.json`: HIA core document fixture.

Run:

```sh
npm run test
```

The fixture validates contract shape, safe relative paths, `sourcesContentPolicy: none`, reserved `x_doc_source_map` pointer metadata, real source-map mappings and HIA core document compatibility. Historical `0.1.0-draft` extraction inputs without per-range evidence remain readable but receive `unknown` source range conventions in a newly generated map.
