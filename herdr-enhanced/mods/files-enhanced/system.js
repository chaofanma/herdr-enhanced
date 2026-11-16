// The system's own ways to open things, on this computer only: a file in its default program, a file
// or folder in the file manager, and Windows' Open with chooser. Each resolves once the program took
// it, or rejects with what it said.
import { exec } from "herdr";
import { platform } from "./machine.js";

const backslashes = p => p.split("/").join("\\");

async function said(r, what) {
  if (r.code !== 0) throw new Error(String(r.stderr ?? "").trim().split("\n")[0] || `${what} exited with ${r.code}`);
}

// What the file manager is called here, for the menus.
export const fileManager = () => ({ macos: "Finder", windows: "Explorer" })[platform()] ?? "file manager";

export async function openSystem(full) {
  const os = platform();
  // explorer.exe says 1 even when it opened the file.
  if (os === "windows") { await exec("explorer", [backslashes(full)]); return; }
  const program = os === "macos" ? "open" : "xdg-open";
  await said(await exec(program, [full]), program);
}

// A file selected in its folder, or a folder opened.
export async function revealSystem(full, dir) {
  const os = platform();
  if (os === "windows") { await exec("explorer", [dir ? backslashes(full) : `/select,${backslashes(full)}`]); return; }
  if (os === "macos") { await said(await exec("open", dir ? [full] : ["-R", full]), "open"); return; }
  const folder = dir ? full : full.slice(0, full.lastIndexOf("/")) || "/";
  await said(await exec("xdg-open", [folder]), "xdg-open");
}

export async function chooser(full) {
  await exec("rundll32", ["shell32.dll,OpenAs_RunDLL", backslashes(full)]);
}
