#!/usr/bin/env node
// Makes Files Enhanced's icons/ (a subset of Material Icon Theme's SVGs, MIT) and its icons.js
// (iconFor: a file or folder name -> its icon) from a checkout of the theme:
//   node tools/make-icons.mjs <material-icon-theme checkout>
// The checkout's commit goes into icons/LICENSE. Files and folders listed below are the ones copied;
// the theme's name and extension tables (src/core/icons/*.ts) say which names they go with.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const M = process.argv[2];
if (!M || !existsSync(join(M, "src/core/icons"))) {
  console.error("usage: node tools/make-icons.mjs <material-icon-theme checkout>\n" +
    "  a checkout of https://github.com/material-extensions/vscode-material-icon-theme (it reads src/core/icons/ and icons/)");
  process.exit(2);
}
// The mod: the one folder under files-enhanced/mods/ with a main.js.
const MODS = join(dirname(fileURLToPath(import.meta.url)), "../files-enhanced/mods");
const OUT = join(MODS, readdirSync(MODS).find(d => existsSync(join(MODS, d, "main.js"))));
const ICONS = join(OUT, "icons");

// The file icons kept (about 150: common languages, config files and documents).
const FILES = `html markdown mdx css sass less stylus json yaml xml toml javascript typescript typescript-def react react_ts vue svelte astro
  python python-misc go go-mod rust java jar kotlin scala groovy gradle maven c h cpp hpp csharp fsharp swift objective-c objective-cpp
  ruby gemfile php perl lua r julia dart elixir erlang haskell clojure ocaml zig assembly webassembly
  graphql prisma proto database console powershell docker makefile cmake nix terraform just
  image svg video audio pdf word table powerpoint zip font lock key certificate log git diff editorconfig
  eslint prettier babel webpack vite vitest rollup esbuild jest playwright cypress storybook tailwindcss postcss stylelint browserlist
  npm nodejs yarn pnpm bun deno tsconfig jsconfig next nuxt turborepo biome husky commitlint renovate dependabot
  gitlab kubernetes helm vercel netlify firebase sentry
  license readme changelog contributing authors todo tune settings nginx jupyter document tex vim http i18n
  exe dll android visualstudio vscode test-ts test-js test-jsx javascript-map css-map`.split(/\s+/).filter(Boolean);

// The folder icons kept (about 45; each with its open variant).
const FOLDERS = `src dist test docs node git github gh-workflows vscode config scripts images resource lib public components utils api app
  server client tools database migrations log temp target typescript javascript css font i18n views hook plugin packages shared
  examples environment python coverage docker ci secure template mock`.split(/\s+/).filter(Boolean).map(n => `folder-${n}`);

// Extensions VS Code finds a language for and the theme draws by that language (languageIcons.ts),
// where the theme's own extension table doesn't name them.
const LANGUAGE_EXTENSIONS = { pl: "perl", sh: "console", bash: "console", zsh: "console", fish: "console", yml: "yaml", h: "h", txt: "document", ini: "settings", cfg: "settings", conf: "settings", env: "tune", lock: "lock", mk: "makefile" };

// Material's own default icons are made by its build (generateFileIcons, generateFolderIcons) in
// blue-gray 300; these are those paths. Adapted from material-extensions/vscode-material-icon-theme
// src/core/generator/fileGenerator.ts and folderGenerator.ts (MIT).
const GRAY = "#90a4ae";
const FILE_PATH = "m8.668 6h3.6641l-3.6641-3.668v3.668m-4.668-4.668h5.332l4 4v8c0 0.73828-0.59375 1.3359-1.332 1.3359h-8c-0.73828 0-1.332-0.59766-1.332-1.3359v-10.664c0-0.74219 0.59375-1.3359 1.332-1.3359m3.332 1.3359h-3.332v10.664h8v-6h-4.668z";
const FOLDER_PATH = "m6.922 3.768-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232";
const OPEN_FOLDER_PATH = "M14.483 6H4.721a1 1 0 0 0-.949.684L2 12V5h12a1 1 0 0 0-1-1H7.562a1 1 0 0 1-.64-.232l-.644-.536A1 1 0 0 0 5.638 3H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h11l2.403-5.606A1 1 0 0 0 14.483 6";
const plain = d => `<svg viewBox="0 0 16 16" width="16" height="16" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="${GRAY}" /></svg>`;

// The theme's tables are TypeScript object literals: read them by evaluating them with stand-ins for
// their imports.
function table(file, name) {
  let src = readFileSync(join(M, "src/core/icons", file), "utf8");
  src = src.replace(/^import .*?;\s*$/gms, "").replace(new RegExp(`export const ${name}\\s*:[^=]+=`), `const ${name} =`);
  const IconPack = new Proxy({}, { get: (_, k) => String(k) });
  const FileNamePattern = { Ecmascript: "ecmascript", Configuration: "configuration", NodeEcosystem: "nodeEcosystem", Cosmiconfig: "cosmiconfig", Yaml: "yaml", Dotfile: "dotfile" };
  return new Function("IconPack", "FileNamePattern", "parseByPattern", `${src}\nreturn ${name};`)(IconPack, FileNamePattern, x => x);
}

// Adapted from material-extensions/vscode-material-icon-theme src/core/patterns/patterns.ts mapPatterns
// (MIT): the file names a pattern stands for.
const ECMA = ["js", "mjs", "cjs", "ts", "mts", "cts"], CONF = ["json", "jsonc", "json5", "yaml", "yml", "toml"];
function patternNames(patterns) {
  return Object.entries(patterns ?? {}).flatMap(([n, p]) => {
    if (p === "ecmascript") return ECMA.map(e => `${n}.${e}`);
    if (p === "configuration") return CONF.map(e => `${n}.${e}`);
    if (p === "nodeEcosystem") return [...ECMA, ...CONF].map(e => `${n}.${e}`);
    if (p === "cosmiconfig") return [`.${n}rc`, ...[...CONF, ...ECMA].map(e => `.${n}rc.${e}`), ...[...CONF, ...ECMA].map(e => `${n}.config.${e}`)];
    if (p === "yaml") return [`${n}.yaml`, `${n}.yml`];
    if (p === "dotfile") return [`.${n}`, n];
    throw new Error(`pattern ${p}`);
  });
}


// An SVG as an icon: 16 px wide and high (GPUI rasterizes an image at its own size, and some of these
// say 1024), viewBox kept.
const sized = svg => svg.replace(/<svg\b([^>]*)>/, (m, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, "")} width="16" height="16">`);

const fileIcons = table("fileIcons.ts", "fileIcons"), folderIcons = table("folderIcons.ts", "folderIcons");
const commit = execFileSync("git", ["-C", M, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

rmSync(ICONS, { recursive: true, force: true });
mkdirSync(ICONS, { recursive: true });
const light = new Set(), names = {}, exts = {}, folders = {};
const copy = (icon, transform = s => s) => {
  const src = join(M, "icons", `${icon}.svg`);
  if (!existsSync(src)) throw new Error(`no icon ${icon}`);
  writeFileSync(join(ICONS, `${icon}.svg`), sized(transform(readFileSync(src, "utf8"))));
  if (existsSync(join(M, "icons", `${icon}_light.svg`))) { writeFileSync(join(ICONS, `${icon}_light.svg`), sized(transform(readFileSync(join(M, "icons", `${icon}_light.svg`), "utf8")))); light.add(icon); }
};

for (const icon of FILES) {
  const entry = fileIcons.icons.find(i => i.name === icon && !i.enabledFor && !i.clone && !i.disabled);
  if (!entry) throw new Error(`no file icon ${icon}`);
  copy(icon);
  for (const n of [...patternNames(entry.patterns), ...(entry.fileNames ?? [])]) if (!n.includes("/")) names[n.toLowerCase()] ??= icon;
  for (const e of entry.fileExtensions ?? []) exts[e.toLowerCase()] ??= icon;
}
for (const [e, icon] of Object.entries(LANGUAGE_EXTENSIONS)) { if (!FILES.includes(icon)) throw new Error(`language icon ${icon} isn't kept`); exts[e] ??= icon; }

// Adapted from material-extensions/vscode-material-icon-theme src/scripts/svg/generateOpenFolderIcons.ts
// (MIT): an open folder is the closed one with the element id="folder" drawn as the open shape.
const opened = svg => {
  if (!/id="folder"/.test(svg)) throw new Error("no id=folder");
  return svg.replace(/(<[^>]*\bid="folder"[^>]*\bd=")[^"]*(")/, `$1${OPEN_FOLDER_PATH}$2`).replace(/(<[^>]*\bd=")[^"]*("[^>]*\bid="folder")/, `$1${OPEN_FOLDER_PATH}$2`);
};
const specific = folderIcons.find(t => t.name === "specific");
for (const icon of FOLDERS) {
  const entry = specific.icons.find(i => i.name === icon && !i.enabledFor && !i.clone);
  if (!entry) throw new Error(`no folder icon ${icon}`);
  copy(icon);
  const closed = readFileSync(join(M, "icons", `${icon}.svg`), "utf8");
  writeFileSync(join(ICONS, `${icon}-open.svg`), sized(opened(closed)));
  for (const n of entry.folderNames) folders[n.toLowerCase()] ??= icon;
}
writeFileSync(join(ICONS, "file.svg"), plain(FILE_PATH));
writeFileSync(join(ICONS, "folder.svg"), plain(FOLDER_PATH));
writeFileSync(join(ICONS, "folder-open.svg"), plain(OPEN_FOLDER_PATH));

writeFileSync(join(ICONS, "LICENSE"), `These icons are from Material Icon Theme (material-extensions/vscode-material-icon-theme),
https://github.com/material-extensions/vscode-material-icon-theme, commit ${commit}: a subset of its
icons/ (file.svg, folder.svg and folder-open.svg drawn from its generator's paths, the *-open folders
from its open-folder shape), resized to 16 px by tools/make-icons.mjs.

${readFileSync(join(M, "LICENSE"), "utf8")}`);

const sortObj = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(join(OUT, "icons.js"), `// Made by tools/make-icons.mjs from Material Icon Theme (MIT, commit ${commit.slice(0, 9)}; icons/LICENSE): which
// icon a file or folder gets, as VS Code's file icon themes match them. Pure: tested in test/files-enhanced/icons.test.mjs.
import { asset } from "./id.js";

const NAMES = ${JSON.stringify(sortObj(names))};
const EXTENSIONS = ${JSON.stringify(sortObj(exts))};
const FOLDERS = ${JSON.stringify(sortObj(folders))};
const LIGHT = new Set(${JSON.stringify([...light].sort())});

// Adapted from material-extensions/vscode-material-icon-theme src/core/generator/folderGenerator.ts
// extendFolderNames (MIT): a folder name also matches with ".", "_" or "-" before it, or "__" around it.
const folderOf = n => FOLDERS[n] ?? (/^[._-]/.test(n) ? FOLDERS[n.slice(1)] : null) ?? (/^__.+__$/.test(n) ? FOLDERS[n.slice(2, -2)] : null);

// The icon for a name: a file by its whole name, else its longest extension ("a.d.ts": "d.ts", then
// "ts"); a folder by its name (open: its open variant), or by its last two names (".github/workflows",
// from rel, its path). Names compare without case. The theme's default file and folder otherwise.
// Light themes get the light variants where there are some. Resolves a path in the app's folder for
// image().
export function iconFor(name, dir = false, open = false, rel = "", light = false) {
  const lower = String(name ?? "").toLowerCase();
  let icon;
  if (dir) {
    const two = String(rel ?? "").toLowerCase().split("/").slice(-2);
    const known = (two.length === 2 ? FOLDERS[two[0].replace(/^[._-]/, "") + "/" + two[1]] : null) ?? folderOf(lower);
    icon = known ? known + (open ? "-open" : "") : open ? "folder-open" : "folder";
  } else {
    icon = NAMES[lower];
    for (let i = lower.indexOf("."); !icon && i >= 0; i = lower.indexOf(".", i + 1)) icon = EXTENSIONS[lower.slice(i + 1)];
    icon ??= "file";
  }
  return asset(\`icons/\${light && LIGHT.has(icon) ? icon + "_light" : icon}.svg\`);
}
`);
console.log(`${FILES.length} file icons (${Object.keys(names).length} names, ${Object.keys(exts).length} extensions), ${FOLDERS.length} folder icons (${Object.keys(folders).length} names), ${light.size} light variants`);
