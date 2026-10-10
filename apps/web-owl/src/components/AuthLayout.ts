import { Component, xml } from '@odoo/owl';
import { Link } from './Link';

export class AuthLayout extends Component {
  static override template = xml`
    <div class="mesh-bg flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link to="'/'" class="'mb-8 text-xl font-bold tracking-tight text-ink-900'">OnSite</Link>
      <main class="w-full max-w-[400px]"><t t-slot="default"/></main>
    </div>`;
  static components = { Link };
  static override props = { slots: { type: Object, optional: true } };
}
