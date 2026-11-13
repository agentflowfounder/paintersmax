import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, safeZipName, uniqueName, zipStream } from "../src/zip.ts";

test("crc32 matches the known check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const a = new TextEncoder().encode("1234");
  const b = new TextEncoder().encode("56789");
  assert.equal(crc32(b, crc32(a)), 0xcbf43926);
});
test("names are cleaned and made unique", () => {
  assert.equal(safeZipName("../a:b/c?.txt"), "_/a_b/c_.txt");
  const used = new Set<string>();
  assert.equal(uniqueName("a/x.jpg", used), "a/x.jpg");
  assert.equal(uniqueName("a/X.jpg", used), "a/X (2).jpg");
  assert.equal(uniqueName("a/x.jpg", used), "a/x (3).jpg");
});
test("the zip it writes is valid and holds the right bytes (checked with python's zipfile)", async () => {
  const big = new Uint8Array(200000).map((_, i) => (i * 7) % 251);
  const s = zipStream([
    { name: "hello.txt", read: async () => new TextEncoder().encode("héllo\n") },
    { name: "skipped.txt", read: async () => null },
    { name: "photos/big.bin", read: async () => (async function* () { yield big.subarray(0, 70000); yield big.subarray(70000); })() },
  ]);
  const buf = new Uint8Array(await new Response(s).arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  const path = join(dir, "t.zip");
  writeFileSync(path, buf);
  const py = spawnSync("python3", ["-I", "-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(','.join(z.namelist()));print(z.read('hello.txt').decode());print(len(z.read('photos/big.bin')))", path], { encoding: "utf8" });
  assert.equal(py.status, 0, py.stderr);
  const [bad, names, hello, , len] = py.stdout.split("\n");
  assert.equal(bad, "None");
  assert.equal(names, "hello.txt,photos/big.bin");
  assert.equal(hello, "héllo");
  assert.equal(len, "200000");
  assert.ok(readFileSync(path).length > 200000);
});
