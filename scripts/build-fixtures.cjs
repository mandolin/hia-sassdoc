const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const fixtureRoot = path.join(root, "fixtures", "doc-source-map", "sass-css");
const distDir = path.join(fixtureRoot, "dist");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const { runSassDoc } = await import(pathToFileURL(path.join(root, "packages", "sassdoc-runner", "src", "index.mjs")));

  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  const result = await runSassDoc({
    workspaceRoot: root,
    outputDirectory: distDir,
    inputs: [
      {
        kind: "scss",
        path: "fixtures/doc-source-map/sass-css/src/button.scss",
        artifactBasePath: "button"
      }
    ],
    options: {
      emitCssSourceMap: true,
      emitDocSourceMap: true,
      sourcesContentPolicy: "none",
      writeResultManifest: false
    }
  });

  if (result.status !== "success") {
    throw new Error(`SassDoc fixture build failed: ${JSON.stringify(result.diagnostics)}`);
  }

  console.log("SassDoc Dart Sass fixture artifacts generated.");
}
