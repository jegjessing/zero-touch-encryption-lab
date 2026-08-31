#!/usr/bin/env node
// Fails if any package imported from source isn't declared in that package's
// package.json (dependencies or devDependencies). Catches the "committed code
// that uses `pg` without adding it as a dependency" mistake.
//
// It is deliberately simple: regex over the source, resolve each specifier to a
// package name, and check it exists. Node builtins and relative imports are
// ignored.
//
// Should not replace a proper linter or dependency checker, but is a quick sanity check for this lab.
import { builtinModules } from "node:module";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const builtins = new Set(builtinModules);

// Directories inside a package to scan for source, plus loose top-level files.
const scanDirs = ["src", "test"];

// Find every package.json in the repo (skipping node_modules).
function findPackages(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findPackages(full));
    } else if (entry.name === "package.json") {
      found.push(dir);
    }
  }
  return found;
}

// Collect .js/.mjs/.cjs files: top-level of the package plus src/ and test/.
function sourceFiles(pkgDir) {
  const files = [];
  const isSource = (name) => /\.(m|c)?js$/.test(name);

  for (const name of readdirSync(pkgDir)) {
    const full = join(pkgDir, name);
    if (statSync(full).isFile() && isSource(name)) files.push(full);
  }
  for (const sub of scanDirs) {
    const subDir = join(pkgDir, sub);
    if (!existsSync(subDir)) continue;
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (isSource(entry.name)) files.push(full);
      }
    };
    walk(subDir);
  }
  return files;
}

// Pull out imported specifiers: import/export ... from '', bare import '',
// dynamic import(''), and require('').
function importsIn(file) {
  const src = readFileSync(file, "utf8");
  const specifiers = new Set();
  const patterns = [
    /(?:import|export)[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) specifiers.add(m[1]);
  }
  return specifiers;
}

// Turn an import specifier into a package name, or null to ignore it.
function packageName(spec) {
  if (spec.startsWith(".") || spec.startsWith("/")) return null; // relative
  if (spec.startsWith("node:")) return null; // builtin
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  if (builtins.has(name)) return null;
  return name;
}

let problems = 0;

for (const pkgDir of findPackages(repoRoot)) {
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);

  const missing = new Map(); // package name -> file it was seen in
  for (const file of sourceFiles(pkgDir)) {
    for (const spec of importsIn(file)) {
      const name = packageName(spec);
      if (name && !declared.has(name) && !missing.has(name)) {
        missing.set(name, file);
      }
    }
  }

  if (missing.size > 0) {
    problems += missing.size;
    const rel = pkgDir === repoRoot ? "." : pkgDir.replace(`${repoRoot}/`, "");
    console.error(`\n${rel}/package.json is missing dependencies:`);
    for (const [name, file] of missing) {
      console.error(`  - ${name}  (used in ${file.replace(`${repoRoot}/`, "")})`);
    }
  }
}

if (problems > 0) {
  console.error(
    `\ncheck-deps: ${problems} undeclared package(s). Add them to the right package.json.`,
  );
  process.exit(1);
}

console.log("check-deps: all imported packages are declared.");
