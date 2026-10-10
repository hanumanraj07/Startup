import { Component, xml } from '@odoo/owl';
import { card } from '@/ui/classes';

/** The white login-style card used by every auth screen. */
export class AuthCard extends Component {
  static override template = xml`
    <div t-att-class="cardClass">
      <h1 class="text-xl font-medium text-ink-900" t-out="props.title"/>
      <p t-if="props.description" class="mt-1 text-sm text-ink-500" t-out="props.description"/>
      <div class="mt-6"><t t-slot="default"/></div>
    </div>`;
  static override props = {
    title: String,
    description: { type: String, optional: true },
    slots: { type: Object, optional: true },
  };

  cardClass = card('p-8');
}
