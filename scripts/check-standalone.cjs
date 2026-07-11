const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "examples", "standalone", "dist", "sassdoc");
const manifestPath = path.join(output, "sassdoc.producer-result.json");

if (!fs.existsSync(manifestPath)) {
  console.error("Missing SassDoc standalone result manifest.");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
let failed = false;

if (manifest.contract !== "documentation-producer-result" || manifest.status !== "success") {
  console.error("Invalid SassDoc standalone result contract or status.");
  failed = true;
}
if (manifest.artifacts?.length !== 6) {
  console.error(`Expected 6 SassDoc artifacts, got ${manifest.artifacts?.length ?? 0}.`);
  failed = true;
}

for (const artifact of manifest.artifacts ?? []) {
  const artifactPath = path.join(output, artifact.path);
  if (!fs.existsSync(artifactPath)) {
    console.error(`Missing SassDoc standalone artifact: ${artifact.path}`);
    failed = true;
  }
}

const serialized = listFiles(output)
  .map((filePath) => fs.readFileSync(filePath, "utf8"))
  .join("\n");
for (const marker of ["K:\\Project", "Github_mandolin", "HIA-Documentation-Sys"]) {
  if (serialized.includes(marker)) {
    console.error(`Local path leakage in SassDoc standalone output: ${marker}`);
    failed = true;
  }
}
if (serialized.includes("sourcesContent") && !serialized.includes('"sourcesContent": []')) {
  console.error("SassDoc standalone output embeds non-empty sourcesContent by default.");
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log("SassDoc standalone example check passed: 1 input, 6 artifacts.");

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}
