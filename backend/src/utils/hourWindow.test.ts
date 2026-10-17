import assert from "node:assert/strict";
import test from "node:test";
import { getRateLimitDelay, getUtcHourWindow } from "./hourWindow.js";

test("UTC hourly rate windows key by hour and expire after the boundary", () => {
  const window = getUtcHourWindow(new Date("2026-10-16T21:58:14.164Z"));
  assert.equal(window.key, "2026101621");
  assert.equal(window.label, "2026-10-16 21:00");
  assert.equal(window.nextHour, Date.parse("2026-10-16T22:00:00.000Z"));
  assert.ok(window.ttl > 60);
});

test("UTC hourly rate windows move forward at midnight and year boundaries", () => {
  const window = getUtcHourWindow(new Date("2026-12-31T23:59:59.900Z"));
  assert.equal(window.key, "2026123123");
  assert.equal(window.nextHour, Date.parse("2027-01-01T00:00:00.000Z"));
});

test("rate-limit deferrals preserve sequence order with bounded 100ms offsets", () => {
  const nextHour = Date.parse("2026-10-16T22:00:00.000Z");
  assert.equal(getRateLimitDelay(nextHour, 0), nextHour);
  assert.equal(getRateLimitDelay(nextHour, 12), nextHour + 1200);
  assert.equal(getRateLimitDelay(nextHour, 5000), nextHour + 100_000);
});
