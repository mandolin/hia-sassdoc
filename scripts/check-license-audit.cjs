const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const allowedRootDevDependencies = new Map([
  ["sass", "1.101.0"]
]);

const allowedLockPackages = new Map([
  ["@parcel/watcher", "2.5.6"],
  ["@parcel/watcher-android-arm64", "2.5.6"],
  ["@parcel/watcher-darwin-arm64", "2.5.6"],
  ["@parcel/watcher-darwin-x64", "2.5.6"],
  ["@parcel/watcher-freebsd-x64", "2.5.6"],
  ["@parcel/watcher-linux-arm-glibc", "2.5.6"],
  ["@parcel/watcher-linux-arm-musl", "2.5.6"],
  ["@parcel/watcher-linux-arm64-glibc", "2.5.6"],
  ["@parcel/watcher-linux-arm64-musl", "2.5.6"],
  ["@parcel/watcher-linux-x64-glibc", "2.5.6"],
  ["@parcel/watcher-linux-x64-musl", "2.5.6"],
  ["@parcel/watcher-win32-arm64", "2.5.6"],
  ["@parcel/watcher-win32-ia32", "2.5.6"],
  ["@parcel/watcher-win32-x64", "2.5.6"],
  ["chokidar", "5.0.0"],
  ["detect-libc", "2.1.2"],
  ["immutable", "5.1.9"],
  ["is-extglob", "2.1.1"],
  ["is-glob", "4.0.3"],
  ["node-addon-api", "7.1.1"],
  ["picomatch", "4.0.5"],
  ["readdirp", "5.0.0"],
  ["sass", "1.101.0"],
  ["source-map-js", "1.2.1"]
]);

const dependencyFields = ["dependencies", "peerDependencies", "optionalDependencies"];
let failed = false;

for (const field of dependencyFields) {
  const declared = Object.keys(rootPackage[field] || {});
  if (declared.length > 0) {
    console.error(`SassDoc workspace must not declare root ${field} yet:`);
    for (const name of declared) {
      console.error(`- ${name}`);
    }
    failed = true;
  }
}

const rootDevDependencies = rootPackage.devDependencies || {};
for (const [name, version] of Object.entries(rootDevDependencies)) {
  if (allowedRootDevDependencies.get(name) !== version) {
    console.error(`Unexpected root devDependency: ${name}@${version}`);
    failed = true;
  }
}
for (const [name] of allowedRootDevDependencies) {
  if (!Object.hasOwn(rootDevDependencies, name)) {
    console.error(`Missing reviewed root devDependency: ${name}`);
    failed = true;
  }
}

const lockPath = path.join(root, "package-lock.json");
if (!fs.existsSync(lockPath)) {
  console.error("Missing package-lock.json for reviewed Dart Sass dependency.");
  process.exit(1);
}

const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
for (const [packagePath, entry] of Object.entries(lock.packages || {})) {
  if (!packagePath.startsWith("node_modules/") || entry.link) {
    continue;
  }
  const packageName = packageNameFromLockPath(packagePath);
  const expectedVersion = allowedLockPackages.get(packageName);
  if (!expectedVersion || entry.version !== expectedVersion) {
    console.error(`Unexpected lock package: ${packageName}@${entry.version ?? "unknown"}`);
    failed = true;
  }
  if (typeof entry.resolved === "string" && !entry.resolved.startsWith("https://registry.npmjs.org/")) {
    console.error(`Unexpected registry for ${packageName}: ${entry.resolved}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("SassDoc license audit passed: Dart Sass fixture dependency allowlist accepted.");

function packageNameFromLockPath(packagePath) {
  const segments = packagePath.split("/");
  if (segments[1]?.startsWith("@")) {
    return `${segments[1]}/${segments[2]}`;
  }
  return segments[1];
}
