/**
 * Illustrated category icons: a pastel-tint circle with a small flat glyph
 * drawn from primitive SVG shapes on top — no icon-pack imports, no emoji,
 * no raster assets, so it renders identically everywhere and stays crisp at
 * any size. One tint per category, cycling through the four pastel tints in
 * the design system rather than needing a fifth — real category sets always
 * outgrow a fixed tint count, and reusing tints across categories is normal.
 *
 * Add a new category here by adding one glyph function and one line in
 * CATEGORY_META — nothing else in the app needs to change to pick it up,
 * since every call site passes the category's own slug.
 */
'use client';

import { motion } from 'framer-motion';

export type CategorySlug =
  | 'product-inspection'
  | 'shop-verification'
  | 'property-inspection'
  | 'document-collection'
  | 'local-photography'
  | 'local-research';

const CATEGORY_META: Record<CategorySlug, { tint: string; glyphColor: string }> = {
  'product-inspection': { tint: 'var(--tint-orange)', glyphColor: 'var(--accent-700)' },
  'shop-verification': { tint: 'var(--tint-blue)', glyphColor: 'var(--brand-600)' },
  'property-inspection': { tint: 'var(--tint-green)', glyphColor: 'var(--brand-600)' },
  'document-collection': { tint: 'var(--tint-yellow)', glyphColor: 'var(--brand-700)' },
  'local-photography': { tint: 'var(--tint-blue)', glyphColor: 'var(--brand-600)' },
  'local-research': { tint: 'var(--tint-orange)', glyphColor: 'var(--accent-700)' },
};

function Glyph({ slug, color }: { slug: CategorySlug; color: string }) {
  // Every glyph is drawn on a 24x24 grid, 2-4 shapes, stroke-only or a mix
  // of stroke and fill — kept restrained so it reads clearly at 24-28px.
  switch (slug) {
    case 'product-inspection':
      return (
        <g fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5Z" />
          <path d="M4 8.5V16l8 4.5V13" />
          <path d="M20 8.5V16l-8 4.5" />
        </g>
      );
    case 'shop-verification':
      return (
        <g fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 10 5.5 5h13L20 10" />
          <path d="M4 10a2.2 2.2 0 0 0 4.4 0 2.2 2.2 0 0 0 4.4 0 2.2 2.2 0 0 0 4.4 0 2.2 2.2 0 0 0 4.4 0" />
          <path d="M5.5 10.5V19h13v-8.5" />
          <path d="M10 19v-5h4v5" />
        </g>
      );
    case 'property-inspection':
      return (
        <g fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 11.5 12 5l8 6.5" />
          <path d="M6 10v9h12v-9" />
          <path d="M10 19v-5h4v5" />
        </g>
      );
    case 'document-collection':
      return (
        <g fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 3.5h7l3 3v14H7z" />
          <path d="M14 3.5v3h3" />
          <path d="M9.5 12.5h5M9.5 15.5h5M9.5 9.5h2" />
        </g>
      );
    case 'local-photography':
      return (
        <g fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5h4L9 6h6l1.5 2.5h4v10h-17Z" />
          <circle cx="12" cy="13.5" r="3" />
        </g>
      );
    case 'local-research':
      return (
        <g fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="m19.5 19.5-4.6-4.6" />
        </g>
      );
    default:
      return null;
  }
}

export function CategoryBadge({
  slug,
  size = 56,
  className,
}: {
  slug: CategorySlug;
  size?: number;
  className?: string;
}) {
  const meta = CATEGORY_META[slug];
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      className={className}
      aria-hidden
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 16 }}
    >
      <circle cx="28" cy="28" r="28" fill={meta.tint} />
      <g transform="translate(16, 16) scale(1)">
        <Glyph slug={slug} color={meta.glyphColor} />
      </g>
    </motion.svg>
  );
}
