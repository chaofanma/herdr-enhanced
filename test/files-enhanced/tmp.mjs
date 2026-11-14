// Temp folders for the tests, under the system's temp folder, removed when the test process ends.
import "../shared/no-outer-git.mjs";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const made = [];
process.on("exit", () => { for (const d of made) try { rmSync(d, { recursive: true, force: true }); } catch {} });

// A new empty folder, its real path (macOS's temp folder is under a link).
export function tempDir(prefix = "files-enhanced-test-") {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(d);
  return d;
}
