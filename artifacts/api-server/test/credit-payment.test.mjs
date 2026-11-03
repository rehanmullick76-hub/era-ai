import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { getCreditPackage } from "../src/lib/credit-packages.ts";
import { verifyPaymentSignature } from "../src/lib/payment-signature.ts";

test("server owns package amounts and rejects prototype/unknown package IDs", () => {
  assert.deepEqual(getCreditPackage("starter"), { credits: 100, amount: 200000 });
  assert.deepEqual(getCreditPackage("pro"), { credits: 500, amount: 500000 });
  assert.deepEqual(getCreditPackage("max"), { credits: 2000, amount: 1000000 });
  for (const value of ["__proto__", "constructor", "other", "", null, 100, { amount: 1 }]) {
    assert.equal(getCreditPackage(value), null);
  }
});

test("Razorpay HMAC requires exact order, payment, signature and secret", () => {
  const secret = "unit-test-only-not-a-real-key";
  const order = "order_example";
  const payment = "pay_example";
  const signature = createHmac("sha256", secret).update(`${order}|${payment}`).digest("hex");
  assert.equal(verifyPaymentSignature(order, payment, signature, secret), true);
  assert.equal(verifyPaymentSignature("order_other", payment, signature, secret), false);
  assert.equal(verifyPaymentSignature(order, "pay_other", signature, secret), false);
  assert.equal(verifyPaymentSignature(order, payment, signature, "wrong-test-secret"), false);
  for (const invalid of ["", "a", "0".repeat(64), "z".repeat(64), signature + "00"]) {
    assert.equal(verifyPaymentSignature(order, payment, invalid, secret), false);
  }
});
