const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const requiredFiles = ["README.md", "CHANGELOG.md", "RELEASE_CHECKLIST.md", "THIRD_PARTY_NOTICES.md", "LICENSE"];

for (const file of requiredFiles) {
  const fullPath = path.join(root, file);
  const content = fs.readFileSync(fullPath, "utf8").trim();
  if (!content) {
    console.error(`Release file is empty: ${file}`);
    process.exit(1);
  }
}

const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (rootPackage.private !== true) {
  console.error("SassDoc skeleton release check requires private=true.");
  process.exit(1);
}

const npmIgnore = fs.readFileSync(path.join(root, ".npmignore"), "utf8");
for (const requiredPattern of ["node_modules/", "packages/*/node_modules/", "*.tgz"]) {
  if (!npmIgnore.includes(requiredPattern)) {
    console.error(`Missing .npmignore release safety pattern: ${requiredPattern}`);
    process.exit(1);
  }
}

console.log("SassDoc release check passed.");
