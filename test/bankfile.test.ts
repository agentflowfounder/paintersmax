import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeOfx, parseOfx, parseStatementLines } from "../src/bankfile.ts";
import { rowsFromTx } from "../src/records.ts";
import { visionAsk } from "../src/vision.ts";

const OFX_V1 = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261103120000[0:GMT]<TRNAMT>-120.50<FITID>1<NAME>SHERWIN WILLIAMS 1234</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261104<TRNAMT>500.00<FITID>2<NAME>DEPOSIT</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105<TRNAMT>-40.00<FITID>3<MEMO>SHELL OIL &amp; GO</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const OFX_XML = `<?xml version="1.0"?><?OFX OFXHEADER="200"?><OFX><STMTTRN><DTPOSTED>20261201</DTPOSTED><TRNAMT>-9.99</TRNAMT><NAME>ZOOM</NAME></STMTTRN></OFX>`;

test("OFX and QFX files are recognized and read, both tag styles", () => {
  assert.equal(looksLikeOfx(OFX_V1), true);
  assert.equal(looksLikeOfx(OFX_XML), true);
  assert.equal(looksLikeOfx("Date,Description,Amount\n1/1/2026,x,-1"), false);
  assert.deepEqual(parseOfx(OFX_V1), [
    { d: "2026-11-03", v: "SHERWIN WILLIAMS 1234", c: -12050 },
    { d: "2026-11-04", v: "DEPOSIT", c: 50000 },
    { d: "2026-11-05", v: "SHELL OIL & GO", c: -4000 },
  ]);
  assert.deepEqual(parseOfx(OFX_XML), [{ d: "2026-12-01", v: "ZOOM", c: -999 }]);
});

test("only money going out becomes an expense; deposits are skipped and counted", () => {
  const r = rowsFromTx(parseOfx(OFX_V1), {});
  assert.equal(r.rows.length, 2);
  assert.equal(r.skipped, 1);
  assert.equal(r.rows[0].amountCents, 12050);
  assert.equal(r.rows[0].category, "Materials");
  assert.equal(r.rows[1].category, "Fuel");
});

test("statement lines from the AI reader are parsed and chatter is ignored", () => {
  const reply = `Here you go:
2026-11-03|-120.50|SHERWIN WILLIAMS 1234
- 2026-11-04|500.00|DEPOSIT
2026-11-05|(40.00)|SHELL | OIL
2026-13-40|-5.00|BAD DATE
2026-11-06|abc|NO AMOUNT
Hope that helps`;
  assert.deepEqual(parseStatementLines(reply), [
    { d: "2026-11-03", v: "SHERWIN WILLIAMS 1234", c: -12050 },
    { d: "2026-11-04", v: "DEPOSIT", c: 50000 },
    { d: "2026-11-05", v: "SHELL | OIL", c: -4000 },
  ]);
  assert.deepEqual(parseStatementLines("NONE"), []);
});

test("a PDF goes to each provider in the form that provider expects", async () => {
  const seen: any[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    seen.push({ u, body: JSON.parse(init.body) });
    if (u.includes("generativelanguage")) return new Response("{}", { status: 500 });
    if (u.includes("openai")) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify({ content: [{ text: "2026-11-03|-1.00|X" }] }), { status: 200 });
  }) as any;
  try {
    const out = await visionAsk({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a" } as any, { system: "s", user: "u", mime: "application/pdf", data: "AAAA" }, { json: false });
    assert.equal(out.ok, true);
  } finally {
    globalThis.fetch = real;
  }
  const g = seen.find((x) => x.u.includes("generativelanguage")).body;
  assert.equal(g.contents[0].parts[0].inline_data.mime_type, "application/pdf");
  const o = seen.find((x) => x.u.includes("openai")).body;
  assert.equal(o.messages[1].content[1].type, "file");
  assert.match(o.messages[1].content[1].file.file_data, /^data:application\/pdf;base64,AAAA$/);
  const a = seen.find((x) => x.u.includes("anthropic")).body;
  assert.equal(a.messages[0].content[0].type, "document");
});
