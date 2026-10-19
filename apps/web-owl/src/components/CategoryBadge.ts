import { Component, xml } from '@odoo/owl';
import { Icon } from './Icon';

interface CategoryMeta {
  icon: string;
  tint: string;
  glyph: string;
}

/** One tint per launch category, each with a dark glyph colour that reads on it; unknown (future) categories get a neutral default. */
const CATEGORY_META: Record<string, CategoryMeta> = {
  'product-inspection': { icon: 'package-search', tint: 'var(--tint-orange)', glyph: '#a64b00' },
  'shop-verification': { icon: 'store', tint: 'var(--tint-blue)', glyph: '#1d4ed8' },
  'property-inspection': { icon: 'home', tint: 'var(--tint-green)', glyph: 'var(--accent-700)' },
  'document-collection': { icon: 'file-text', tint: 'var(--tint-yellow)', glyph: 'var(--brand-700)' },
  'local-photography': { icon: 'camera', tint: 'var(--tint-pink)', glyph: '#b4235f' },
  'local-research': { icon: 'search', tint: 'var(--tint-purple)', glyph: '#6230c9' },
  // The one category that moves something: the brand yellow, with the dark ink glyph.
  'pickup-delivery': { icon: 'package-check', tint: 'var(--brand-100)', glyph: 'var(--ink-900)' },
};

const FALLBACK: CategoryMeta = { icon: 'package', tint: 'var(--paper-100)', glyph: 'var(--ink-700)' };

/** A soft-tinted rounded tile with the category's glyph — the category's visual identity across the app. */
export class CategoryBadge extends Component {
  static override template = xml`
    <span class="inline-flex shrink-0 items-center justify-center rounded-[30%]" t-att-style="style" aria-hidden="true">
      <Icon name="meta.icon" size="glyphSize"/>
    </span>`;
  static components = { Icon };
  static override props = {
    slug: String,
    size: { type: Number, optional: true },
  };

  get meta(): CategoryMeta {
    return CATEGORY_META[this.props.slug] ?? FALLBACK;
  }

  get diameter(): number {
    return this.props.size ?? 56;
  }

  get glyphSize(): number {
    return Math.round(this.diameter * 0.5);
  }

  get style(): string {
    const d = this.diameter;
    return `width:${d}px;height:${d}px;background:${this.meta.tint};color:${this.meta.glyph}`;
  }
}
