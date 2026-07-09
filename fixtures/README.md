# Fixtures

## `doc-source-map/sass-css`

W-P9.3 Dart Sass fixture for Sass -> CSS documentation linkage.

Files:

- `src/button.scss`: source fixture with CSSDoc-compatible annotation.
- `dist/button.css`: Dart Sass generated CSS fixture.
- `dist/button.css.map`: Dart Sass ordinary source map fixture normalized for path privacy.
- `dist/button.cssdoc.json`: CSSDoc extraction artifact fixture.
- `dist/button.docmap.json`: `doc-source-map@0.1.0-draft` manifest fixture.
- `dist/button.hia.json`: HIA core document fixture.

Run:

```sh
npm run test
```

The fixture validates contract shape, safe relative paths, `sourcesContentPolicy: none`, reserved `x_doc_source_map` pointer metadata, real source-map mappings and HIA core document compatibility.
