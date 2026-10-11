import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] || "mac-arm64";
if (!["mac-arm64", "win-x64"].includes(target))
  throw Error("Supported build targets: mac-arm64, win-x64");
const windows = target === "win-x64",
  triple = windows ? "x86_64-pc-windows-msvc" : "aarch64-apple-darwin",
  npmTarget = windows ? "win32-x64" : "darwin-arm64";
const dest = path.join(root, "desktop/resources", target);
const cache = path.join(root, "desktop/.cache");
fs.mkdirSync(dest, { recursive: true });
fs.mkdirSync(cache, { recursive: true });
function run(bin, args) {
  if (process.platform === "win32" && bin === "npm") {
    const npmCli =
      process.env.npm_execpath ||
      path.join(
        path.dirname(process.execPath),
        "node_modules/npm/bin/npm-cli.js",
      );
    return execFileSync(process.execPath, [npmCli, ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return execFileSync(bin, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
async function download(url, to) {
  if (fs.existsSync(to)) return;
  const r = await fetch(url);
  if (!r.ok) throw Error(`Download ${r.status}: ${url}`);
  fs.writeFileSync(to, Buffer.from(await r.arrayBuffer()));
}
let pkg = path.join(root, "node_modules/@openai/codex-" + npmTarget);
if (!fs.existsSync(pkg)) {
  const folder = path.join(cache, "codex-" + npmTarget);
  fs.mkdirSync(folder, { recursive: true });
  if (!fs.existsSync(path.join(folder, "package"))) {
    const data = JSON.parse(
      run("npm", [
        "pack",
        `@openai/codex@0.160.1-${npmTarget}`,
        "--json",
        "--pack-destination",
        folder,
      ]),
    )[0];
    run("tar", ["-xf", path.join(folder, data.filename), "-C", folder]);
  }
  pkg = path.join(folder, "package");
}
fs.cpSync(path.join(pkg, "vendor", triple), path.join(dest, "codex"), {
  recursive: true,
});
const cad = path.join(dest, "cad");
fs.mkdirSync(cad, { recursive: true });
if (!windows) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw Error("Build Mac runtime on Apple Silicon");
  const bin = "/opt/homebrew/bin/dwg2dxf",
    lib = "/opt/homebrew/opt/libredwg/lib/libredwg.0.dylib";
  if (run(bin, ["--version"]).trim().split("\n")[0] !== "dwg2dxf 0.14")
    throw Error(
      "This build requires LibreDWG 0.14 to match the shipped source archive.",
    );
  fs.copyFileSync(bin, path.join(cad, "dwg2dxf"));
  fs.copyFileSync(lib, path.join(cad, "libredwg.0.dylib"));
  const old = run("otool", ["-L", bin])
    .split("\n")
    .find((x) => x.includes("libredwg.0.dylib"))
    .trim()
    .split(" ")[0];
  run("install_name_tool", [
    "-change",
    old,
    "@executable_path/libredwg.0.dylib",
    path.join(cad, "dwg2dxf"),
  ]);
  run("install_name_tool", [
    "-id",
    "@loader_path/libredwg.0.dylib",
    path.join(cad, "libredwg.0.dylib"),
  ]);
  for (const f of ["libredwg.0.dylib", "dwg2dxf"]) {
    fs.chmodSync(path.join(cad, f), 0o755);
    run("codesign", ["--force", "--sign", "-", path.join(cad, f)]);
  }
} else {
  const zip = path.join(cache, "libredwg-0.14-win64.zip");
  await download(
    "https://github.com/LibreDWG/libredwg/releases/download/0.14/libredwg-0.14-win64.zip",
    zip,
  );
  const extracted = path.join(cache, "libredwg-win");
  fs.mkdirSync(extracted, { recursive: true });
  if (process.platform === "win32")
    run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${zip.replaceAll("'", "''")}' -DestinationPath '${extracted.replaceAll("'", "''")}' -Force`,
    ]);
  else run("unzip", ["-qo", zip, "-d", extracted]);
  function copyBinaries(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) copyBinaries(f);
      else if (
        e.name.toLowerCase() === "dwg2dxf.exe" ||
        e.name.toLowerCase() === "libredwg-0.dll"
      )
        fs.copyFileSync(f, path.join(cad, e.name));
    }
  }
  copyBinaries(extracted);
  if (!fs.existsSync(path.join(cad, "dwg2dxf.exe")))
    throw Error("DWG binary missing");
}
const licenses = path.join(dest, "licenses");
fs.mkdirSync(licenses, { recursive: true });
// Ship corresponding upstream source alongside the unmodified 0.14 tool, not just a web link.
await download(
  "https://github.com/LibreDWG/libredwg/releases/download/0.14/libredwg-0.14.tar.xz",
  path.join(licenses, "libredwg-0.14-source.tar.xz"),
);
await download(
  "https://raw.githubusercontent.com/LibreDWG/libredwg/0.14/COPYING",
  path.join(licenses, "LibreDWG-COPYING.txt"),
);
await download(
  "https://raw.githubusercontent.com/openai/codex/rust-v0.160.1/LICENSE",
  path.join(licenses, "Codex-LICENSE.txt"),
);
fs.writeFileSync(
  path.join(licenses, "THIRD-PARTY.txt"),
  "Codex CLI 0.160.1 — OpenAI — Apache-2.0 — https://github.com/openai/codex\nLibreDWG 0.14 — GNU — GPL-3.0-or-later — https://github.com/LibreDWG/libredwg\nLibreDWG is a separate executable invoked through a file conversion interface. Source archive included.\nElectron and JavaScript dependency license files are retained in their packages.\nNo user files, account credentials or reference project are included.\n",
);
const manifest = [];
function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) scan(f);
    else if (e.name !== "manifest.json")
      manifest.push({
        path: path.relative(dest, f),
        bytes: fs.statSync(f).size,
        sha256: createHash("sha256").update(fs.readFileSync(f)).digest("hex"),
      });
  }
}
scan(dest);
fs.writeFileSync(
  path.join(dest, "manifest.json"),
  JSON.stringify(
    { target, createdAt: new Date().toISOString(), files: manifest },
    null,
    2,
  ),
);
console.log(`Prepared ${target}: ${manifest.length} files at ${dest}`);
