import fs from "node:fs";
import { execFileSync } from "node:child_process";

const type = process.argv[2];

if (!["patch", "minor", "major"].includes(type)) {
  console.error("Usage: npm run release:{patch|minor|major}");
  process.exit(1);
}

function run(command, args) {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

function getVersion() {
  const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8");

  const match = cargo.match(/^version\s*=\s*"([^"]+)"/m);

  if (!match) {
    throw new Error("Could not find version in src-tauri/Cargo.toml");
  }

  return match[1];
}

function bumpVersion(version, type) {
  const [major, minor, patch] = version.split(".").map(Number);

  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const currentVersion = getVersion();
const newVersion = bumpVersion(currentVersion, type);

console.log(`Bumping ${currentVersion} → ${newVersion}`);

// Update Cargo.toml
const cargoPath = "src-tauri/Cargo.toml";
let cargo = fs.readFileSync(cargoPath, "utf8");

cargo = cargo.replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${newVersion}"`
);

fs.writeFileSync(cargoPath, cargo);

// Update package.json
const packagePath = "package.json";
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

pkg.version = newVersion;

fs.writeFileSync(
  packagePath,
  JSON.stringify(pkg, null, 2) + "\n"
);

// Update package-lock.json if you have one
if (fs.existsSync("package-lock.json")) {
  run("npm", ["install", "--package-lock-only", "--ignore-scripts"]);
}

// Make sure everything is clean before committing
run("git", ["add", "package.json", "src-tauri/Cargo.toml"]);

if (fs.existsSync("package-lock.json")) {
  run("git", ["add", "package-lock.json"]);
}

run("git", ["commit", "-m", `chore: release v${newVersion}`]);

// Create tag
run("git", ["tag", `v${newVersion}`]);

// Push commit and tag
run("git", ["push", "upstream", "HEAD"]);
run("git", ["push", "upstream", `v${newVersion}`]);

console.log(`Released v${newVersion}`);
