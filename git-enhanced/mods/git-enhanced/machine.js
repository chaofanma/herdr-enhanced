// The machine layer: every git call and script this mod runs, on this computer or on the space's
// machine (`on`: a name from `hc machine ls`, null for this computer). Herdr's exec and readTextFile
// reach another machine; writeTextFile, watchFolder and image() don't. So everything runs through
// exec as git or as a POSIX sh script (scripts.js), which works on both ends: bytes for the far side
// (a hunk's patch, a rebase's list, commit messages) travel as base64 arguments decoded there, a
// repository there is polled instead of watched, and an image there comes back as base64 into the
// app's cache (images.js). The same code runs here, so both ends are the same tested path.
import { exec, window, appHome, hc } from "herdr";
import * as fs from "fs/promises";
import { Buffer } from "buffer";
import { PROBE, parseFacts, putCap, why, fileOf } from "./scripts.js";
import { runnerOf } from "./gitops.js";
import { FETCH_IMAGES_SH, parseFetched, PRUNE_IMAGES_SH, REMOTE_IMAGE, imagesArgs, pixelSize } from "./images.js";
import { CACHE } from "./id.js";
import { hostIn } from "./openwith.js";
import { SAFE_ARGS, SAFE_GIT_SH } from "./gittrust.js";
import { parseVersion } from "./gitplan.js";

export { why, fileOf };
/** The platform Herdr runs on ("macos", "linux", "windows"); "linux" when it doesn't say. */
export function platform() { return window()?.platform ?? "linux"; }

/** `sh -c script sh args…` on `on` (here when null), in `cwd`; exec's { code, stdout, stderr }. */
export function sh(on, script, args = [], { cwd, timeout } = {}) {
  return exec("sh", ["-c", script, "sh", ...args.map(String)], { on: on ?? null, cwd, timeout });
}

// ---- What a machine has

/** The programs some features need: git everywhere; base64 or openssl to send bytes there; the
 *  agents the pen can write with (looked for here only: they run on this computer). */
export const TOOLS = ["git", "base64", "openssl", "pi", "claude", "codex", "opencode"];
const FACTS = new Map(); // on ("" here) -> { at, value, promise }
const TTL = 10 * 60 * 1000;

/** What `on` has: { os, argMax, tools: Set, sh }. One sh per machine, again after ten minutes; a
 *  machine that can't be reached isn't remembered. `extra`: more programs to look for. */
export function facts(on, extra = []) {
  const k = `${on ?? ""}|${extra.join(" ")}`, was = FACTS.get(k);
  if (was && (!was.value || Date.now() - was.at < TTL)) return was.promise;
  const entry = { at: Date.now(), value: was?.value ?? null };
  entry.promise = (async () => {
    try {
      const r = await sh(on, PROBE, [...TOOLS, ...extra], { timeout: 15000 });
      entry.value = { ...parseFacts(r.stdout), sh: true };
    } catch (e) {
      if (!/cannot start sh|program not found|No such file/i.test(String(e?.message ?? e))) { if (FACTS.get(k) === entry) FACTS.delete(k); throw e; }
      entry.value = { os: "unknown", argMax: 0, tools: new Set(), sh: false };
    }
    entry.at = Date.now();
    return entry.value;
  })();
  FACTS.set(k, entry);
  return entry.promise;
}
/** The facts already found for `on`, or null. */
export const known = (on) => FACTS.get(`${on ?? ""}|`)?.value ?? null;
/** For tests: forget them. */
export const forget = () => { FACTS.clear(); VERSIONS.clear(); };

/** What this mod can do on `on` from its facts (null while they're being found: assume it can). */
export function capsOf(on, f = known(on)) {
  const has = (c) => !f || f.tools.has(c);
  return { git: has("git"), put: !f || f.tools.has("base64") || f.tools.has("openssl"), putMax: putCap(f?.argMax ?? 0) };
}

// ---- Bytes for a script

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

/** A runner for the repository at `root` on `on` (gitops.js runnerOf with Herdr's exec), whose
 *  `files()` first checks that the bytes fit what exec takes there. */
/** A runner for what the panel reads on its own (a page's facts, files and diffs, a poll, a fetch it
 *  starts by itself): git gets SAFE_ARGS (no fsmonitor, no hooks), a script SAFE_GIT_SH first. What
 *  the person asks for (Commit, Stage, Push…) runs with repo(), the repository's hooks and all. */
export function reader(root, on = null) {
  const h = repo(root, on);
  return {
    ...h,
    git: (args, opts) => h.git([...SAFE_ARGS, ...args], opts),
    sh: (script, args, opts) => h.sh(SAFE_GIT_SH + script, args, opts),
    files: (list, body, args, opts) => h.files(list, SAFE_GIT_SH + body, args, opts),
  };
}

export function repo(root, on = null) {
  const h = runnerOf(exec, root, on ?? null), files = h.files;
  return {
    ...h,
    files: async (list, body, args = [], opts = {}) => {
      const size = list.reduce((n, f) => n + f.size, 0), f = await facts(on ?? null).catch(() => null), caps = capsOf(on, f);
      if (!caps.put) throw new Error(`Sending changes to ${on} needs base64 or openssl there`);
      if (size > caps.putMax) throw new Error(`Too big to send${on ? ` to ${on}` : ""} (${kb(size)}): Herdr's exec takes up to ${kb(caps.putMax)}`);
      return files(list, body, args, opts);
    },
  };
}

// ---- git's version (gitplan.js parseVersion), once per machine

const VERSIONS = new Map(); // on ?? "" -> { value, promise }
/** The version of git on `on`, or null while unknown (a feature that needs a version hides until
 *  it is known). Asked once; a machine that couldn't be asked is asked again next time. */
export function gitVersion(on = null) {
  const k = on ?? "", was = VERSIONS.get(k);
  if (was) return was.promise;
  const entry = { value: null };
  entry.promise = exec("git", ["version"], { on: on ?? null, timeout: 15000 })
    .then((r) => (entry.value = parseVersion(r.stdout)), () => { VERSIONS.delete(k); return null; });
  VERSIONS.set(k, entry);
  return entry.promise;
}
/** The version already known for `on`, or null. */
export const knownVersion = (on = null) => VERSIONS.get(on ?? "")?.value ?? null;

/** Whether `program` is found on `on` (looked for once in a while, with the other tools). */
export async function has(on, program) {
  const f = await facts(on, TOOLS.includes(program) ? [] : [program]).catch(() => null);
  return Boolean(f?.tools.has(program));
}

// ---- Images from another machine

/** An image diff's two sides from the repository at `root` on `on` (images.js imageSides), fetched as
 *  base64 and written into the app's cache folder here, where image() can show them; the newest 20
 *  copies stay. `{ before, after }`, each `{ name, bytes, size }`, null (no such side) or
 *  `{ big: bytes }` (too large to fetch). */
export async function fetchImages(root, on, ext, sides) {
  const r = await sh(on, SAFE_GIT_SH + FETCH_IMAGES_SH, [String(REMOTE_IMAGE), ...imagesArgs("-", ext, sides).slice(1)], { cwd: root, timeout: 60000 });
  if (r.code !== 0) throw new Error(why(r.stderr, "Couldn't read the image there"));
  const dir = `${appHome()}/${CACHE}`;
  await fs.mkdir(dir, { recursive: true });
  const out = [];
  for (const side of parseFetched(r.stdout)) {
    if (!side || side.big) { out.push(side); continue; }
    if (!/^[0-9a-f]{40,64}\.[a-z]+$/.test(side.name)) { out.push(null); continue; }
    const bytes = Buffer.from(side.base64, "base64"), path = `${dir}/${side.name}`;
    if (!(await fs.exists(path).catch(() => false))) await fs.writeFile(path, bytes);
    out.push({ name: side.name, bytes: bytes.length, size: pixelSize([...bytes.subarray(0, ext === "jpg" || ext === "jpeg" ? 262144 : 4096)], ext) });
  }
  await sh(null, PRUNE_IMAGES_SH, [dir]).catch(() => null);
  return { before: out[0], after: out[1] };
}

// ---- The ssh target of a machine (Open with over ssh)

let HOSTS = null; // { at, promise }
/** How Herdr reaches machine `on` by ssh (`hc machine ls`'s target), or null (this computer, a
 *  machine reached another way, or one not known). Asked again after a minute. */
export function hostOf(on) {
  if (!on) return Promise.resolve(null);
  if (!HOSTS || Date.now() - HOSTS.at > 60000) {
    HOSTS = { at: Date.now(), promise: hc(["machine", "ls", "--json"]).then((r) => JSON.parse(r.stdout || "{}").machines ?? [], () => []) };
  }
  return HOSTS.promise.then((list) => hostIn(list, on));
}
