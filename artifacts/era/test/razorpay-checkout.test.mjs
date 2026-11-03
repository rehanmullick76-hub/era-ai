import assert from "node:assert/strict";
import { test } from "node:test";
import { openCreditCheckout } from "../src/lib/razorpay-checkout.ts";

const order = { orderId: "order_unit", amount: 200000, keyId: "unit-public-key" };
function fakeCheckout() {
  let instance;
  globalThis.window = { Razorpay: class {
    constructor(options) { this.options = options; instance = this; }
    on(event, callback) { this.failed = callback; }
    open() {}
  } };
  return () => instance;
}

test("a failed attempt followed by successful in-checkout retry still verifies", async () => {
  const instance = fakeCheckout();
  const pending = openCreditCheckout(order, "Starter");
  await new Promise(setImmediate);
  instance().failed();
  const payment = { razorpay_order_id: order.orderId, razorpay_payment_id: "pay_unit", razorpay_signature: "unit-signature" };
  instance().options.handler(payment);
  assert.deepEqual(await pending, payment);
});

test("checkout dismissal without payment returns null", async () => {
  const instance = fakeCheckout();
  const pending = openCreditCheckout(order, "Starter");
  await new Promise(setImmediate);
  instance().options.modal.ondismiss();
  assert.equal(await pending, null);
});

test("closing checkout after a failed attempt reports failure", async () => {
  const instance = fakeCheckout();
  const pending = openCreditCheckout(order, "Starter");
  await new Promise(setImmediate);
  instance().failed();
  const rejected = assert.rejects(pending, /Payment failed/);
  instance().options.modal.ondismiss();
  await rejected;
});
