# Third Party Notices

This workspace uses the following third-party packages during development and fixture generation.

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| `sass` | `1.101.0` | MIT | Dart Sass JavaScript API for compiling the W-P9.3 SCSS fixture and generating an ordinary source map. |
| `chokidar` | `5.0.0` | MIT | Direct dependency of `sass`. |
| `immutable` | `5.1.9` | MIT | Direct dependency of `sass`. |
| `source-map-js` | `1.2.1` | BSD-3-Clause | Direct dependency of `sass`. |
| `@parcel/watcher` and platform packages | `2.5.6` | MIT | Optional dependency of `sass` for file watching. |
| `detect-libc` | `2.1.2` | Apache-2.0 | Optional dependency through `@parcel/watcher`. |
| `is-extglob` | `2.1.1` | MIT | Optional dependency through `@parcel/watcher`. |
| `is-glob` | `4.0.3` | MIT | Optional dependency through `@parcel/watcher`. |
| `node-addon-api` | `7.1.1` | MIT | Optional dependency through `@parcel/watcher`. |
| `picomatch` | `4.0.5` | MIT | Optional dependency through `@parcel/watcher`. |
| `readdirp` | `5.0.0` | MIT | Dependency of `chokidar`. |

`sass` is currently used as a development fixture compiler. It is not yet a public runtime dependency contract for HIA SassDoc packages.
