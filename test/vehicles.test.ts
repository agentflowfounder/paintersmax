import test from "node:test";
import assert from "node:assert/strict";
import { addMonthsIso, cleanService, cleanVehicle, defaultServices, estimatedOdometer, readVehicles, serviceStatus, vehicleAlerts, VEHICLE_LIMIT, type Service, type Vehicle } from "../src/vehicles.ts";

const svc = (o: Partial<Service> = {}): Service => ({ id: "svc00001", label: "Oil change", everyMiles: 5000, everyMonths: 6, lastOdo: 40000, lastOn: "2026-08-01", ...o });

test("addMonthsIso keeps the day and clamps to the end of a short month", () => {
  assert.equal(addMonthsIso("2026-08-01", 6), "2027-02-01");
  assert.equal(addMonthsIso("2026-08-31", 6), "2027-02-28");
  assert.equal(addMonthsIso("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsIso("2026-11-15", 12), "2027-11-15");
});

test("estimatedOdometer adds trips logged after the reading, for the main vehicle only", () => {
  const trips = [{ on: "2026-11-01", miles: 30 }, { on: "2026-11-10", miles: 70.4 }, { on: "2026-10-01", miles: 999 }];
  assert.equal(estimatedOdometer({ odometer: 41000, odometerOn: "2026-10-31", main: true }, trips), 41100);
  assert.equal(estimatedOdometer({ odometer: 41000, odometerOn: "2026-11-01", main: true }, trips), 41070); // the trip on the reading day is already in the reading
  assert.equal(estimatedOdometer({ odometer: 41000, odometerOn: "2026-10-31", main: false }, trips), 41000);
  assert.equal(estimatedOdometer({ odometer: null, odometerOn: "", main: true }, trips), null);
});

test("serviceStatus: ok, soon, due by miles, due by date, unset", () => {
  const today = "2026-11-14";
  assert.equal(serviceStatus(svc(), 41000, today).state, "ok"); // 4,000 miles left, due Feb 1
  assert.deepEqual(serviceStatus(svc(), 41000, today), { state: "ok", milesLeft: 4000, dueOn: "2027-02-01" });
  assert.equal(serviceStatus(svc(), 44600, today).state, "soon"); // 400 miles left
  assert.equal(serviceStatus(svc(), 45000, today).state, "due"); // exactly due
  assert.equal(serviceStatus(svc(), 46000, today).state, "due"); // overdue by miles
  assert.equal(serviceStatus(svc({ lastOn: "2026-05-01" }), 41000, today).state, "due"); // six months passed
  assert.equal(serviceStatus(svc({ lastOn: "2026-05-20" }), 41000, today).state, "soon"); // due Nov 20
  assert.equal(serviceStatus(svc({ lastOdo: null, lastOn: "" }), 41000, today).state, "unset");
  assert.equal(serviceStatus(svc({ everyMonths: null, lastOn: "" }), null, today).state, "unset"); // miles needed but no odometer
  assert.equal(serviceStatus(svc({ everyMiles: null }), null, today).state, "ok"); // date only
});

const base = (o: Partial<Vehicle> = {}): Vehicle => ({
  id: "veh00001", nickname: "Work truck", year: "2019", make: "Ford", model: "F-150", main: true, odometer: 41000, odometerOn: "2026-10-31",
  insuranceCompany: "", insurancePolicy: "", insuranceEnds: "", registrationDue: "", inspectionDue: "", loanLender: "", loanMonthlyCents: null, loanBalanceCents: null, loanDueDay: null, notes: "",
  services: [svc()], log: [], ...o,
});

test("vehicleAlerts lists services due, insurance, registration, inspection and the loan, and nothing when all is fine", () => {
  const today = "2026-11-14";
  assert.deepEqual(vehicleAlerts([base()], [], today), []);
  const due = vehicleAlerts([base({ odometer: 46200, odometerOn: "2026-11-01" })], [], today);
  assert.equal(due.length, 1);
  assert.match(due[0].text, /Oil change is due on Work truck\. It is 1,200 miles past\./);
  assert.equal(due[0].urgent, true);
  const soon = vehicleAlerts([base({ odometer: 44700, odometerOn: "2026-11-01" })], [], today);
  assert.match(soon[0].text, /coming up on Work truck, in about 300 miles/);
  assert.equal(soon[0].urgent, false);
  const dates = vehicleAlerts([base({ insuranceEnds: "2026-11-20", registrationDue: "2026-11-10", inspectionDue: "2027-03-01" })], [], today);
  assert.deepEqual(dates.map((a) => a.text), ["Insurance on Work truck ends in 6 days.", "Registration for Work truck was due 4 days ago."]);
  assert.equal(dates[0].urgent, true);
  const loan = vehicleAlerts([base({ loanDueDay: 16, loanMonthlyCents: 55000 })], [], today);
  assert.equal(loan[0].text, "The loan payment for Work truck is due in 2 days.");
  assert.deepEqual(vehicleAlerts([base({ loanDueDay: 25, loanMonthlyCents: 55000 })], [], today), []);
  assert.match(vehicleAlerts([base({ insuranceEnds: "2026-11-14" })], [], today)[0].text, /ends today/);
});

test("trips since the reading move the main vehicle toward a service", () => {
  const trips = [{ on: "2026-11-10", miles: 4300 }];
  assert.equal(vehicleAlerts([base({ odometer: 40800, odometerOn: "2026-11-01" })], trips, "2026-11-14").length, 1); // 45,100 > 45,000
});

test("cleanVehicle needs a name, falls back to make and model, and refuses account numbers", () => {
  assert.match((cleanVehicle({}) as any).error, /Give the vehicle a name/);
  const v = cleanVehicle({ make: "Ford", model: "Transit", year: "2021abc", odometer: "52,310", loanMonthly: "$550.50", loanBalance: "18000", loanDueDay: "15", main: true }) as Vehicle;
  assert.equal(v.nickname, "Ford Transit");
  assert.equal(v.year, "2021");
  assert.equal(v.odometer, 52310);
  assert.equal(v.loanMonthlyCents, 55050);
  assert.equal(v.loanBalanceCents, 1800000);
  assert.equal(v.loanDueDay, 15);
  assert.equal(v.services.length, 3);
  assert.match((cleanVehicle({ nickname: "Truck", loanLender: "Chase acct 123456789012" }) as any).error, /never stores/);
  assert.match((cleanVehicle({ nickname: "Truck", notes: "acct 1234 5678 9012" }) as any).error, /never stores/);
  const keep = cleanVehicle({ nickname: "Truck" }, base({ services: [svc()], log: [{ id: "l1", serviceId: "x", label: "Oil", on: "2026-01-01", odometer: 1, costCents: 1, note: "" }] })) as Vehicle;
  assert.equal(keep.services.length, 1);
  assert.equal(keep.log.length, 1);
});

test("cleanService needs a name and an interval", () => {
  assert.match((cleanService({ label: "", everyMiles: 5000 }) as any).error, /name/);
  assert.match((cleanService({ label: "Wipers" }) as any).error, /how often/);
  const s = cleanService({ label: "Wipers", everyMonths: "12", lastOn: "2026-02-30" }) as Service;
  assert.equal(s.everyMonths, 12);
  assert.equal(s.everyMiles, null);
  assert.equal(s.lastOn, ""); // an impossible date is dropped
});

test("readVehicles survives bad data and round-trips what was saved", () => {
  assert.deepEqual(readVehicles("not json"), []);
  assert.deepEqual(readVehicles("{}"), []);
  assert.deepEqual(readVehicles(null), []);
  const v = base({ loanMonthlyCents: 55000, log: [{ id: "log00001", serviceId: "svc00001", label: "Oil change", on: "2026-08-01", odometer: 40000, costCents: 7500, note: "Synthetic", expenseId: 9 }] });
  const back = readVehicles(JSON.stringify([v, { nickname: "" }]));
  assert.equal(back.length, 1);
  assert.deepEqual(back[0], v);
});

test("plans get a vehicle limit and defaults are sensible", () => {
  assert.equal(VEHICLE_LIMIT.free, 1);
  assert.ok(VEHICLE_LIMIT.pro > VEHICLE_LIMIT.basic && VEHICLE_LIMIT.basic > VEHICLE_LIMIT.starter && VEHICLE_LIMIT.starter > VEHICLE_LIMIT.free);
  assert.deepEqual(defaultServices().map((s) => s.label), ["Oil change", "Tire rotation", "Brake check"]);
});
