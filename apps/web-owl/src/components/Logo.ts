import { Component, xml } from '@odoo/owl';

/**
 * The OnSite mark (a black map pin with a check, on a yellow tile) and the
 * wordmark. Drawn inline so it costs no request and stays crisp at any size.
 */
export class Logo extends Component {
  static override template = xml`
    <span class="inline-flex items-center gap-2">
      <svg t-att-width="size" t-att-height="size" viewBox="0 0 32 32" aria-hidden="true" class="shrink-0">
        <rect width="32" height="32" rx="9" t-att-fill="props.inverse ? '#141414' : 'var(--brand-solid)'"/>
        <path d="M16 6.5c-4.1 0-7.4 3.2-7.4 7.2 0 5.2 7.4 11.8 7.4 11.8s7.4-6.6 7.4-11.8c0-4-3.3-7.2-7.4-7.2z"
          t-att-fill="props.inverse ? 'var(--brand-solid)' : '#141414'"/>
        <path d="M12.9 13.6l2.2 2.2 4-4.1" fill="none" t-att-stroke="props.inverse ? '#141414' : 'var(--brand-solid)'"
          stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span t-if="!props.markOnly" t-att-class="wordClass">OnSite</span>
    </span>`;
  static override props = {
    size: { type: Number, optional: true },
    /** Black tile with a yellow pin, for use on yellow backgrounds. */
    inverse: { type: Boolean, optional: true },
    markOnly: { type: Boolean, optional: true },
    textClass: { type: String, optional: true },
  };

  get size(): number {
    return this.props.size ?? 30;
  }

  get wordClass(): string {
    return this.props.textClass ?? 'text-[19px] font-extrabold tracking-tight text-ink-900';
  }
}
