const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageRoots = fs.readdirSync(path.join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(root, "packages", entry.name))
  .filter((directory) => fs.existsSync(path.join(directory, "package.json")));
const npmCli = process.env.npm_execpath;
const npmArgs = ["pack", "--dry-run", "--json"];
const command = npmCli
  ? process.execPath
  : process.platform === "win32"
    ? process.env.ComSpec || "cmd.exe"
    : "npm";
const args = npmCli
  ? [npmCli, ...npmArgs]
  : process.platform === "win32"
    ? ["/d", "/s", "/c", `npm ${npmArgs.join(" ")}`]
    : npmArgs;
let failed = false;

for (const packageRoot of packageRoots) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: "utf8"
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(result.error?.message || result.stderr || result.stdout || "npm pack failed.\n");
    failed = true;
    continue;
  }
  const [pack] = JSON.parse(result.stdout);
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const packedPaths = new Set((pack.files || []).map((file) => file.path.replaceAll("\\", "/")));
  for (const file of pack.files || []) {
    const filePath = file.path.replaceAll("\\", "/");
    if (filePath.includes("/node_modules/") || filePath.startsWith("node_modules/") || filePath.endsWith(".tgz")) {
      console.error(`Unsafe file in SassDoc pack dry-run: ${file.path}`);
      failed = true;
    }
  }
  if (packageJson.name === "@hia-doc/sassdoc-runner" || packageJson.name === "@hia-doc/sassdoc-producer") {
    for (const requiredPath of ["LICENSE", "README.md", "package.json", "src/index.mjs"]) {
      if (!packedPaths.has(requiredPath)) {
        console.error(`Missing ${requiredPath} in ${packageJson.name} pack dry-run.`);
        failed = true;
      }
    }
  }
  if (packageJson.name === "@hia-doc/sassdoc-runner" && !packedPaths.has("src/cli.mjs")) {
    console.error("Missing src/cli.mjs in @hia-doc/sassdoc-runner pack dry-run.");
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(`SassDoc pack check passed: ${packageRoots.length} workspace packages.`);
