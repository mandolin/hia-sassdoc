# Sass To CSS Doc Source Map

Defines source linkage between Sass documentation and generated CSS documentation.

The writer emits `doc-source-map@1.1.0`. Each ranged `sourceRef` carries `rangeConvention`; a missing range omits it. The Sass extractor supplies exclusive UTF-16 evidence for plain selector and variable ranges and comment fallbacks. Complex scanner results and legacy external extraction records without explicit evidence receive `unknown` endpoint and column unit. Legacy origin labels are translated to the current `rangeSource` category with a separate detail.
