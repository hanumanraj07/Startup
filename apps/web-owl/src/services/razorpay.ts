/**
 * Loads Razorpay's Checkout script on demand, never bundled: most sessions
 * (any mock-provider deployment) never touch it.
 */

interface RazorpayInstance {
  open: () => void;
}

interface RazorpayConstructor {
  new (options: Record<string, unknown>): RazorpayInstance;
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('Could not load the payment window. Check your connection.'));
      };
      document.body.appendChild(script);
    });
  }
  return scriptPromise;
}

export interface CheckoutOptions {
  keyId: string;
  orderId: string;
  amountPaise: number;
  description: string;
  prefillEmail?: string;
  prefillContact?: string;
}

/**
 * Opens Razorpay's Checkout modal. Resolving 'success' means the customer
 * completed the card/UPI flow in the modal. It is NOT proof the payment
 * captured: per docs/16-security-requirements.md only the signed webhook may
 * move payment state forward, so the caller must poll the server for the real
 * status rather than treat this as capture.
 */
export async function openRazorpayCheckout(options: CheckoutOptions): Promise<'success' | 'dismissed'> {
  await loadScript();
  return new Promise((resolve) => {
    if (!window.Razorpay) {
      resolve('dismissed');
      return;
    }
    const instance = new window.Razorpay({
      key: options.keyId,
      order_id: options.orderId,
      amount: options.amountPaise,
      currency: 'INR',
      name: 'OnSite',
      description: options.description,
      prefill: { email: options.prefillEmail, contact: options.prefillContact },
      theme: { color: '#714B67' },
      handler: () => resolve('success'),
      modal: { ondismiss: () => resolve('dismissed') },
    });
    instance.open();
  });
}
