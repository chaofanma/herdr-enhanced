// Temp folders for the tests, under the system's temp folder, removed when the test process ends.
import "../shared/no-outer-git.mjs";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const made = [];
process.on("exit", () => { for (const d of made) try { rmSync(d, { recursive: true, force: true }); } catch {} });

// The system's temp folder, as Node gives it and as its real path (macOS's is under a link): what a
// test writes goes under it.
export const TEMP_ROOTS = [...new Set([tmpdir(), realpathSync(tmpdir())])];

// A new empty folder, its real path.
export function tempDir(prefix = "git-enhanced-test-") {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(d);
  return d;
}
