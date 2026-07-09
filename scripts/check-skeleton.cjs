const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredPaths = [
  "README.md",
  "CHANGELOG.md",
  "RELEASE_CHECKLIST.md",
  "THIRD_PARTY_NOTICES.md",
  "LICENSE",
  ".mise.toml",
  "package.json",
  "pnpm-workspace.yaml",
  "examples/basic/README.md",
  "fixtures/README.md",
  "fixtures/doc-source-map/sass-css/src/button.scss",
  "test/README.md",
  "packages/sassdoc-spec/package.json",
  "packages/sass-doc-extractor/package.json",
  "packages/sass-doc-adapter/package.json",
  "packages/sass-to-css-doc-source-map/package.json",
  "packages/sass-cssdoc-bridge/package.json",
  "scripts/build-fixtures.cjs",
  "scripts/check-fixtures.cjs"
];

let failed = false;

for (const relativePath of requiredPaths) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`Missing required skeleton path: ${relativePath}`);
    failed = true;
  }
}

const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (rootPackage.private !== true) {
  console.error("Root package must stay private until SassDoc package names are finalized.");
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log("SassDoc skeleton check passed.");
