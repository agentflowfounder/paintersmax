import test from "node:test";
import assert from "node:assert/strict";
import { AGREEMENT_VERSION, requireAgreement } from "../src/agreement.ts";

const req = (body: unknown) => new Request("https://paintersmax.app/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("sign-up without the agreement box ticked is stopped before payment", async () => {
  const env: any = { DB: { prepare: () => { throw new Error("must not save anything"); } } };
  for (const body of [{ email: "a@b.co" }, { email: "a@b.co", agreed: "yes" }, { email: "a@b.co", agreed: false }]) {
    const r = await requireAgreement(req(body), env);
    assert.equal(r?.status, 400);
    assert.match(((await r!.json()) as any).error, /agree/i);
  }
});

test("a ticked box is saved with the email and the version, once", async () => {
  const saved: { sql: string; args: unknown[] }[] = [];
  const env: any = { DB: { prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ run: async () => void saved.push({ sql, args }) }) }) } };
  const r = await requireAgreement(req({ email: " Pat@Example.com ", agreed: true }), env);
  assert.equal(r, null);
  assert.equal(saved.length, 1);
  assert.match(String(saved[0].args[0]), new RegExp(`^agree:[0-9a-f]{40}:${AGREEMENT_VERSION}$`));
  const v = JSON.parse(String(saved[0].args[1]));
  assert.equal(v.email, "pat@example.com");
  assert.equal(v.version, AGREEMENT_VERSION);
  assert.match(saved[0].sql, /DO NOTHING/);
});
