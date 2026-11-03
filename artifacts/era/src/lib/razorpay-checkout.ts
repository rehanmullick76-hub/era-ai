export interface PaymentResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface CheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  handler: (response: PaymentResponse) => void;
  modal: { ondismiss: () => void };
}
declare global {
  interface Window {
    Razorpay?: new (options: CheckoutOptions) => {
      open: () => void;
      on: (event: string, callback: () => void) => void;
    };
  }
}
let loading: Promise<void> | undefined;
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => {
      if (window.Razorpay) resolve();
      else { loading = undefined; script.remove(); reject(new Error("Checkout did not load. Please retry.")); }
    };
    script.onerror = () => {
      loading = undefined;
      script.remove();
      reject(new Error("Could not load Razorpay Checkout. Check your connection and retry."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export async function openCreditCheckout(order: { keyId: string; amount: number; orderId: string }, label: string) {
  await loadCheckout();
  return new Promise<PaymentResponse | null>((resolve, reject) => {
    let failedAttempt = false;
    const checkout = new window.Razorpay!({
      key: order.keyId, amount: order.amount, order_id: order.orderId, currency: "INR",
      name: "ERA", description: `${label} credit package`,
      handler: resolve, modal: { ondismiss: () => {
        if (failedAttempt) reject(new Error("Payment failed. No credits were added. You can retry Checkout."));
        else resolve(null);
      } },
    });
    // Checkout permits another attempt without closing. Rejecting the promise
    // immediately would lose the success callback from that subsequent attempt.
    checkout.on("payment.failed", () => { failedAttempt = true; });
    checkout.open();
  });
}
