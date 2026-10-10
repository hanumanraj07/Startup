import { Component, xml } from '@odoo/owl';

export class Spinner extends Component {
  static override template = xml`
    <span
      role="status"
      aria-label="Loading"
      class="inline-block h-5 w-5 animate-spin rounded-full border-2 border-ink-300 border-t-ink-700"
    />`;
  static override props = {};
}
