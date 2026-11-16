import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, utimesSync, existsSync } from "node:fs";
import { join } from "node:path";
import { mod } from "./mod.mjs";
import { tempDir } from "./tmp.mjs";
const { imageExt, imageSides, IMAGES_SH, imagesArgs, parseCopies, pixelSize, svgSize, bytesWords, sideWords, sideLabels, KEEP_IMAGES } = await mod("images.js");

const u32be = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16le = (n) => [n & 255, (n >> 8) & 255], u32le = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

test("which files are images", () => {
  assert.equal(imageExt("a/b.PNG"), "png");
  assert.equal(imageExt("x.svg"), "svg");
  assert.equal(imageExt("x.jpeg"), "jpeg");
  assert.equal(imageExt("x.txt"), null);
  assert.equal(imageExt("png"), null);
});

test("each diff's two sides", () => {
  assert.deepEqual(imageSides({ base: [], path: "i.png" }), { before: { blob: ":i.png" }, after: { file: "i.png" } });
  assert.deepEqual(imageSides({ base: ["--cached"], path: "i.png" }), { before: { blob: "HEAD:i.png" }, after: { blob: ":i.png" } });
  assert.deepEqual(imageSides({ base: ["--cached"], path: "i.png", status: "A" }), { before: null, after: { blob: ":i.png" } });
  assert.deepEqual(imageSides({ base: ["--cached"], path: "i.png", hasHead: false }), { before: null, after: { blob: ":i.png" } });
  assert.deepEqual(imageSides({ base: ["HEAD"], path: "i.png", status: "D" }), { before: { blob: "HEAD:i.png" }, after: null });
  assert.deepEqual(imageSides({ base: ["abc~1"], path: "new.png", from: "old.png", status: "R" }), { before: { blob: "abc~1:old.png" }, after: { file: "new.png" } });
  assert.deepEqual(imageSides({ path: "n.png", fresh: true }), { before: null, after: { file: "n.png" } });
  assert.deepEqual(sideLabels(["--cached"]), { before: "HEAD", after: "index" });
  assert.deepEqual(sideLabels([]), { before: "index", after: "working tree" });
  assert.deepEqual(sideLabels(["1234567890abcdef1234567890abcdef12345678~1"]), { before: "1234567~1", after: "working tree" });
});

test("pixel sizes from the first bytes", () => {
  const png = [0x89, ...ascii("PNG\r\n\x1a\n"), 0, 0, 0, 13, ...ascii("IHDR"), ...u32be(1200), ...u32be(800)];
  assert.deepEqual(pixelSize(png, "png"), { width: 1200, height: 800 });
  assert.deepEqual(pixelSize([...ascii("GIF89a"), ...u16le(32), ...u16le(16)], "gif"), { width: 32, height: 16 });
  const bmp = [...ascii("BM"), ...Array(16).fill(0), ...u32le(640), ...u32le(-480 >>> 0)];
  assert.deepEqual(pixelSize(bmp, "bmp"), { width: 640, height: 480 });
  const riff = (chunk, body) => [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii(chunk), 0, 0, 0, 0, ...body];
  assert.deepEqual(pixelSize(riff("VP8X", [0, 0, 0, 0, ...[299 & 255, 299 >> 8, 0], ...[199 & 255, 199 >> 8, 0]]), "webp"), { width: 300, height: 200 });
  // VP8L: 14 bits of width-1, then 14 of height-1, after a 0x2f signature.
  const w = 99, h = 49, bits = w | (h << 14);
  assert.deepEqual(pixelSize(riff("VP8L", [0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >> 24) & 255, 0, 0, 0, 0, 0]), "webp"), { width: 100, height: 50 });
  assert.deepEqual(pixelSize(riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(320), ...u16le(240)]), "webp"), { width: 320, height: 240 });
  const ico = [0, 0, 1, 0, 2, 0, 16, 16, ...Array(14).fill(0), 0, 0, ...Array(14).fill(0)];
  assert.deepEqual(pixelSize(ico, "ico"), { width: 256, height: 256 }, "0 means 256; the largest entry");
  const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii("JFIF\0"), ...Array(9).fill(0), 0xff, 0xc4, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, ...[3, 0], ...[4, 0], 3, ...Array(9).fill(0)];
  assert.deepEqual(pixelSize(jpeg, "jpg"), { width: 1024, height: 768 }, "past APP0 and a huffman table to the frame");
  assert.equal(pixelSize([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0], "jpg"), null);
  assert.deepEqual(pixelSize(ascii('<?xml version="1.0"?><svg xmlns="x" width="48px" height="24">'), "svg"), { width: 48, height: 24 });
  assert.equal(pixelSize(ascii("not an image at all, really"), "png"), null);
});

test("an SVG's size: width and height, else its viewBox", () => {
  assert.deepEqual(svgSize('<svg width="10" height="20"/>'), { width: 10, height: 20 });
  assert.deepEqual(svgSize('<svg viewBox="0 0 24 12" width="100%">'), { width: 24, height: 12 });
  assert.deepEqual(svgSize("<svg viewBox='-5,-5,30,40'>"), { width: 30, height: 40 });
  assert.equal(svgSize("<svg>"), null);
  assert.equal(svgSize("plain"), null);
});

test("sizes in words", () => {
  assert.equal(bytesWords(980), "980 B");
  assert.equal(bytesWords(12_600), "12 KB");
  assert.equal(bytesWords(2_048), "2.0 KB");
  assert.equal(bytesWords(1_500_000), "1.4 MB");
  assert.equal(sideWords({ bytes: 2048, size: { width: 3, height: 4 } }), "3 × 4 · 2.0 KB");
  assert.equal(sideWords({ bytes: 10, size: null }), "10 B");
});

test("the copies in a real repo: index and working file, named by content, 20 kept", () => {
  const dir = tempDir("git-enhanced-img-"), cache = tempDir("git-enhanced-img-cache-");
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main"); git("config", "user.name", "t"); git("config", "user.email", "t@t");
  const png = (w, h, tail) => Buffer.from([0x89, ...ascii("PNG\r\n\x1a\n"), 0, 0, 0, 13, ...ascii("IHDR"), ...u32be(w), ...u32be(h), ...ascii(tail)]);
  writeFileSync(join(dir, "i.png"), png(4, 3, "first")); git("add", "-A"); git("commit", "-qm", "img");
  writeFileSync(join(dir, "i.png"), png(8, 6, "second, bigger"));
  const oldName = (k) => `${String(k).padStart(2, "0").repeat(20)}.png`;
  for (let k = 0; k < 25; k++) { const f = join(cache, oldName(k)); writeFileSync(f, "x"); utimesSync(f, 1000 + k, 1000 + k); }
  writeFileSync(join(cache, "notes.txt"), "not a copy");
  const run = () => spawnSync("sh", ["-c", IMAGES_SH, "sh", ...imagesArgs(cache, "png", imageSides({ base: [], path: "i.png" }))], { cwd: dir, encoding: "utf8" });
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const [before, after] = parseCopies(r.stdout);
  assert.equal(before.name, `${git("rev-parse", ":i.png").trim()}.png`, "the index blob, by its id");
  assert.equal(after.name, `${git("hash-object", "--no-filters", "--", "i.png").trim()}.png`);
  assert.deepEqual(pixelSize(before.head, "png"), { width: 4, height: 3 });
  assert.deepEqual(pixelSize(after.head, "png"), { width: 8, height: 6 });
  assert.equal(after.bytes, readFileSync(join(dir, "i.png")).length);
  assert.deepEqual(readFileSync(join(cache, after.name)), readFileSync(join(dir, "i.png")));
  const kept = readdirSync(cache).filter((f) => f !== "notes.txt");
  assert.equal(kept.length, KEEP_IMAGES);
  assert.ok(kept.includes(before.name) && kept.includes(after.name));
  assert.ok(!existsSync(join(cache, oldName(0))), "the oldest went");
  assert.ok(existsSync(join(cache, "notes.txt")), "what isn't a copy stays");
  // Only an absolute folder: the pruning never runs anywhere else.
  const bad = spawnSync("sh", ["-c", IMAGES_SH, "sh", ...imagesArgs("", "png", { before: null, after: { file: "i.png" } })], { cwd: dir, encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.ok(existsSync(join(dir, "i.png")));
  // A side that isn't there: "-".
  const gone = spawnSync("sh", ["-c", IMAGES_SH, "sh", ...imagesArgs(cache, "png", { before: { blob: "HEAD:nope.png" }, after: null })], { cwd: dir, encoding: "utf8" });
  assert.deepEqual(parseCopies(gone.stdout), [null, null]);
});
