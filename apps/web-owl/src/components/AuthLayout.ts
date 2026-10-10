import { Component, xml } from '@odoo/owl';
import { Link } from './Link';

/** Centered login-style layout: brand wordmark above a single card, on the light gray page. */
export class AuthLayout extends Component {
  static override template = xml`
    <div class="flex min-h-screen flex-col items-center justify-center bg-paper-50 px-4 py-12">
      <Link to="'/'" class="'mb-6 text-3xl font-semibold tracking-tight text-brand-solid'">OnSite</Link>
      <main class="w-full max-w-[380px]"><t t-slot="default"/></main>
    </div>`;
  static components = { Link };
  static override props = { slots: { type: Object, optional: true } };
}
