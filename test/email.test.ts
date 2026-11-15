import test from "node:test";
import assert from "node:assert/strict";
import { customerSender, ownerSender, sendCustomerEmail, sendLeadEmail } from "../src/email.ts";

test("each kind of email leaves from its own address", () => {
  assert.equal(ownerSender("Your PaintersMax sign-in link"), "login");
  assert.equal(ownerSender("Today at Tyler Painters: 3 things to look at"), "reminders");
  assert.equal(ownerSender("Hoy en Tyler: 2 cosas por revisar"), "reminders");
  assert.equal(ownerSender("Your insurance policy expires in 14 days (Tyler)"), "reminders");
  assert.equal(ownerSender("New website lead for Tyler: Ana"), "leads");
  assert.equal(customerSender("Your estimate from Tyler Painters"), "jobs");
  assert.equal(customerSender("Please review and sign your contract"), "jobs");
  assert.equal(customerSender("Invoice 1042 from Tyler Painters"), "invoices");
  assert.equal(customerSender("A thank you from Tyler Painters"), "invoices");
});

test("owner emails reply to support@ and customer emails keep the company name", async () => {
  const sent: any[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_u: any, init: any) => { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }) as any;
  try {
    const env = { RESEND_API_KEY: "k" } as any;
    await sendLeadEmail(env, "o@x.com", "Your PaintersMax sign-in link", "hi");
    await sendCustomerEmail(env, "c@x.com", "Tyler Painters", "t@x.com", "Invoice 7", "hi");
  } finally { globalThis.fetch = real; }
  assert.equal(sent[0].from, "PaintersMax <login@mail.paintersmax.app>");
  assert.equal(sent[0].reply_to, "support@paintersmax.app");
  assert.equal(sent[1].from, "Tyler Painters <invoices@mail.paintersmax.app>");
  assert.equal(sent[1].reply_to, "t@x.com");
});
