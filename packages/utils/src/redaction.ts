/**
 * Server-side redaction of contact details in chat.
 *
 * This is not paternalism. A transaction taken off-platform loses escrow,
 * evidence and dispute recourse, and the person who suffers is almost always
 * the worker. See docs/12-trust-safety.md.
 *
 * Redaction raises friction. It does not make sharing impossible, and the
 * security doc states that as an accepted limitation.
 */

export type RedactionFlag = 'phone' | 'email' | 'upi' | 'url';

export interface RedactionResult {
  redacted: string;
  flags: RedactionFlag[];
}

const REPLACEMENT: Record<RedactionFlag, string> = {
  phone: '[phone number removed]',
  email: '[email removed]',
  upi: '[payment ID removed]',
  url: '[link removed]',
};

/**
 * Indian mobile numbers written the many ways people actually write them:
 * "9876543210", "98765 43210", "+91 98765-43210", "919876543210".
 * Requires at least 10 digits so ordinary numbers such as prices, "₹500" or
 * "model 512", are not caught.
 */
const PHONE_PATTERN = /(?:(?:\+|00)?91[\s.-]?)?[6-9](?:[\s.-]?\d){9}(?!\d)/g;

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/g;

/**
 * UPI virtual payment addresses: "name@okhdfcbank", "9876543210@ybl".
 * Checked before the email pattern would otherwise swallow them, and
 * distinguished by the absence of a dot in the handle.
 */
const UPI_PATTERN = /\b[\w.-]{2,64}@(?!.*\.)[a-zA-Z]{2,64}\b/g;

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s]+/gi;

/**
 * Redacts contact details from a message body.
 *
 * Order matters. URLs are removed first so a query string cannot hide a
 * number, then emails (which contain a dot in the domain), then UPI handles
 * (which do not), then phone numbers.
 */
export function redactContactDetails(body: string): RedactionResult {
  const flags = new Set<RedactionFlag>();
  let out = body;

  out = out.replace(URL_PATTERN, () => {
    flags.add('url');
    return REPLACEMENT.url;
  });

  out = out.replace(EMAIL_PATTERN, () => {
    flags.add('email');
    return REPLACEMENT.email;
  });

  out = out.replace(UPI_PATTERN, () => {
    flags.add('upi');
    return REPLACEMENT.upi;
  });

  out = out.replace(PHONE_PATTERN, (match) => {
    // Guard against catching long non-phone digit runs such as order numbers.
    const digits = match.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 12) return match;
    flags.add('phone');
    return REPLACEMENT.phone;
  });

  return { redacted: out, flags: [...flags] };
}
