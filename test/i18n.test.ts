import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

/** Loads the browser file in a tiny fake page so we can test the translator without a browser. */
function load(lang: "en" | "es") {
  const docEl: any = { nodeType: 1, nodeName: "HTML", firstChild: null, hasAttribute: () => false, getAttribute: () => null, lang: "en" };
  const ctx: any = {
    confirm: () => true,
    alert: () => {},
    document: { currentScript: { hasAttribute: () => false }, documentElement: docEl, addEventListener() {}, getElementById: () => null },
    localStorage: { getItem: () => lang, setItem() {} },
    MutationObserver: class { observe() {} },
    fetch: () => Promise.resolve({}),
    location: { reload() {} },
  };
  ctx.window = ctx; // in a browser, window is the global object
  vm.runInNewContext(readFileSync(new URL("../public/i18n.js", import.meta.url), "utf8"), ctx);
  return { T: ctx.pmT as (s: string) => string, doc: docEl };
}

test("English mode leaves text alone", () => {
  const { T } = load("en");
  assert.equal(T("Save settings"), "Save settings");
});

test("Spanish mode translates exact strings and keeps surrounding spaces", () => {
  const { T, doc } = load("es");
  assert.equal(T("Save settings"), "Guardar ajustes");
  assert.equal(T("  Needs your attention \n"), "  Requiere su atención \n");
  assert.equal(doc.lang, "es");
});

test("Spanish mode translates messages with numbers and names", () => {
  const { T } = load("es");
  assert.equal(T("Estimate sent 5 days ago, no answer yet: Ana Perez, Fence"), "Presupuesto enviado hace 5 días, sin respuesta todavía: Ana Perez, Fence");
  assert.equal(T("New lead waiting 1 day: Ana, Fence"), "Cliente potencial esperando 1 día: Ana, Fence");
  assert.equal(T("Your insurance policy expires in 12 days."), "Su póliza de seguro vence en 12 días.");
  assert.equal(T("· Estimate saved: $500.00."), "· Presupuesto guardado: $500.00.");
  assert.equal(T("3. Contract"), "3. Contrato");
  assert.equal(T("Email this estimate to ana@x.com?"), "Enviar este presupuesto por correo a ana@x.com?");
});

test("Spanish mode translates the known sentences in a longer paragraph and leaves the rest", () => {
  const { T } = load("es");
  const out = T("Each question uses one of your monthly assistant questions. A custom unknown sentence.");
  assert.equal(out, "Cada pregunta usa una de sus preguntas mensuales del asistente. A custom unknown sentence.");
});

test("Unknown text, such as customer names and AI answers, is not changed", () => {
  const { T } = load("es");
  assert.equal(T("Maria Lopez"), "Maria Lopez");
  assert.equal(T("Use two coats of stain-blocking primer."), "Use two coats of stain-blocking primer.");
});

test("Spanish mode translates the time sheet reminders and labels", () => {
  const { T } = load("es");
  assert.equal(T("Approve this week"), "Aprobar esta semana");
  assert.equal(T("Callback or rework"), "Regreso o retrabajo");
  assert.equal(
    T("Luis has 45 hours this week. Employees over 40 hours in a week may be owed overtime, so tell your accountant."),
    "Luis tiene 45 horas esta semana. Los empleados con más de 40 horas en una semana pueden tener derecho a horas extra, avise a su contador.",
  );
  assert.equal(
    T("Ana had 41.5 hours last week. Employees over 40 hours in a week may be owed overtime, so tell your accountant."),
    "Ana tuvo 41.5 horas la semana pasada. Los empleados con más de 40 horas en una semana pueden tener derecho a horas extra, avise a su contador.",
  );
  assert.equal(T("Nothing is on the time sheet for last week yet. Add the hours so crew pay and job costs stay right."), "Todavía no hay nada en la hoja de horas de la semana pasada. Agregue las horas para que el pago de la cuadrilla y los costos del trabajo salgan bien.");
  assert.equal(T("Time sheets waiting for your approval: A, B, C and 2 more."), "Hojas de horas esperando su aprobación: A, B, C y 2 más.");
  assert.equal(T("That week is approved. Unapprove it to change the hours."), "Esa semana está aprobada. Quite la aprobación para cambiar las horas.");
});
