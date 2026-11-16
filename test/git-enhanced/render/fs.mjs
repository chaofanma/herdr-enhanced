// Herdr's fs/promises has exists(); Node's doesn't. Writes are recorded, and allowed only under the
// system's temp folder, where the test's app folder is (Herdr's fs writes under ~/.config/herdr-app only).
export * from "node:fs/promises";
import { writeFile as write, mkdir as makeDir } from "node:fs/promises";
import { TEMP_ROOTS } from "../tmp.mjs";
// Every file operation counts as work in flight (state.inflight), like a git call, so settle() waits
// for it: on a busy machine a read or write takes longer than settle's quiet ticks, and a test saw
// a page before its image or listing had arrived.
import { state } from "./stubs.mjs";
import * as nodeFs from "node:fs/promises";
const tracked = (f) => (...args) => { state.inflight++; return f(...args).finally(() => { state.inflight--; }); };
export const readFile = tracked(nodeFs.readFile), stat = tracked(nodeFs.stat), lstat = tracked(nodeFs.lstat),
  readdir = tracked(nodeFs.readdir), access = tracked(nodeFs.access), rm = tracked(nodeFs.rm), rename = tracked(nodeFs.rename),
  copyFile = tracked(nodeFs.copyFile), unlink = tracked(nodeFs.unlink), realpath = tracked(nodeFs.realpath), readlink = tracked(nodeFs.readlink);
export async function exists(p) { try { await access(p); return true; } catch { return false; } }
export const written = [];
const inTemp = (p) => TEMP_ROOTS.some((root) => String(p).startsWith(`${root}/`));
export async function writeFile(p, data) {
  if (!inTemp(p)) throw new Error(`a test wrote outside the temp folder: ${p}`);
  written.push(String(p));
  return tracked(write)(p, data);
}
export async function mkdir(p, o) {
  if (!inTemp(p)) throw new Error(`a test made a folder outside the temp folder: ${p}`);
  return tracked(makeDir)(p, o);
}
