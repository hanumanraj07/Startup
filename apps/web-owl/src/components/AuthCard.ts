import { Component, xml } from '@odoo/owl';
import { card } from '@/ui/classes';

/** The white card used by every auth screen, lifted off the yellow band. */
export class AuthCard extends Component {
  static override template = xml`
    <div t-att-class="cardClass">
      <h1 class="text-2xl font-bold tracking-tight text-ink-900" t-out="props.title"/>
      <p t-if="props.description" class="mt-1 text-sm text-ink-500" t-out="props.description"/>
      <div class="mt-6"><t t-slot="default"/></div>
    </div>`;
  static override props = {
    title: String,
    description: { type: String, optional: true },
    slots: { type: Object, optional: true },
  };

  cardClass = card('rounded-sheet p-6 shadow-float sm:p-8');
}
