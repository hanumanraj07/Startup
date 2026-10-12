import { Component, xml } from '@odoo/owl';
import { Link } from '@/components/Link';

export class NotFoundView extends Component {
  static override template = xml`
    <main class="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 class="text-[28px] font-bold tracking-tight text-ink-900">Page not found</h1>
      <p class="mt-2 text-ink-500">That address doesn’t exist.</p>
      <Link to="'/'" class="'mt-6 inline-block font-semibold text-accent-600 hover:underline'">Go home</Link>
    </main>`;
  static components = { Link };
  static override props = {};
}

export class NoAccessView extends Component {
  static override template = xml`
    <div class="mx-auto max-w-xl py-12 text-center">
      <p class="text-ink-500">You don’t have access to the admin console.</p>
    </div>`;
  static override props = {};
}
