# SassDoc Runner

Standalone SassDoc project runner and CLI.

`runSassDoc()` compiles Sass/SCSS with Dart Sass, extracts SassDoc annotations, emits CSSDoc bridge artifacts, writes HIA documents, and produces a `documentation-producer-result` manifest.

When enabled, the documentation source map uses `doc-source-map@1.1.0`; its actual `contractVersion` is copied to the HIA document reference and producer artifact. `emitDocSourceMap: false` omits the map file and both references.

Set `options.emitCoordinateProfile: true` to write an additional `<artifactBasePath>.coordinate-profile.json` sidecar with `ordinary-source-map-coordinate-profile@0.1.0-draft`. This option is off by default and requires both source maps plus `sourcesContentPolicy: "none"`. It records byte digests and the original Sass source slot from the same build, while leaving imported slots without independent documentation source evidence out of the sidecar. The producer result lists it as an `ordinary-source-map-coordinate-profile` artifact. A consumer must still check the actual map and authorized source bytes with a strict reader before claiming an exact source anchor; the sidecar alone is not proof. Review source digests before publishing the sidecar, since hashes of low entropy sources can reveal equality.

A valid source that emits no CSS mapping segment produces `sourceSlots: []`, which cannot certify an exact anchor. Every processed input removes its prior sidecar first, including a rebuild with the option switched off. An opt-in build checks the candidate in private staging and writes the sidecar last. A failed result may leave uncertified intermediate files if operating-system I/O fails during publication; no sidecar is left to certify them. If an input is removed from the request altogether, clear obsolete output files before publishing the directory because that input is no longer processed.
