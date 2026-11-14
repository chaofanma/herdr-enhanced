// Herdr's fs/promises has exists(); Node's doesn't.
export * from "node:fs/promises";
// Every file operation counts as work in flight (state.inflight), like a git call, so settle() waits
// for it: on a busy machine a read or write takes longer than settle's quiet ticks, and a test saw
// a page before its image or listing had arrived.
import { state } from "./stubs.mjs";
import * as nodeFs from "node:fs/promises";
const tracked = (f) => (...args) => { state.inflight++; return f(...args).finally(() => { state.inflight--; }); };
export const readFile = tracked(nodeFs.readFile), stat = tracked(nodeFs.stat), lstat = tracked(nodeFs.lstat),
  readdir = tracked(nodeFs.readdir), access = tracked(nodeFs.access), rm = tracked(nodeFs.rm), rename = tracked(nodeFs.rename),
  copyFile = tracked(nodeFs.copyFile), unlink = tracked(nodeFs.unlink), realpath = tracked(nodeFs.realpath), readlink = tracked(nodeFs.readlink);
export const writeFile = tracked(nodeFs.writeFile), mkdir = tracked(nodeFs.mkdir);
export async function exists(p) { try { await access(p); return true; } catch { return false; } }
