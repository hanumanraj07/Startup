import { Component, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { TaskCardPreview } from './TaskCardPreview';

/**
 * The hero artwork: a stylised city map with a dashed route from "you" to the
 * task pin, the feed card a nearby worker sees, and two floating status chips.
 * Pure SVG and HTML, no image request. Decorative except the card, which is
 * itself a static mockup (aria-hidden on the art around it).
 */
export class HeroIllustration extends Component {
  static override template = xml`
    <div class="relative mx-auto w-full max-w-[460px]">
      <svg viewBox="0 0 460 420" class="w-full drop-shadow-[0_24px_40px_rgba(20,20,20,0.18)]" aria-hidden="true">
        <rect x="10" y="10" width="440" height="400" rx="36" fill="#fff"/>
        <g stroke="#eef0f2" stroke-width="14" stroke-linecap="round" fill="none">
          <path d="M10 120 H450"/>
          <path d="M10 290 H450"/>
          <path d="M140 10 V410"/>
          <path d="M330 10 V410"/>
          <path d="M40 410 L250 10"/>
        </g>
        <path d="M360 330 q50 -20 90 10 v50 q0 20 -20 20 h-80 z" fill="#e5f5e8"/>
        <circle cx="395" cy="370" r="10" fill="#bfe5c7"/>
        <circle cx="420" cy="352" r="7" fill="#bfe5c7"/>
        <path d="M10 200 q80 -30 150 10 t140 0 t150 -10" stroke="#dbeafe" stroke-width="18" fill="none"/>
        <g fill="#f5f6f8">
          <rect x="40" y="30" width="78" height="70" rx="12"/>
          <rect x="160" y="140" width="150" height="40" rx="10"/>
          <rect x="350" y="30" width="80" height="70" rx="12"/>
          <rect x="160" y="310" width="150" height="80" rx="12"/>
          <rect x="350" y="140" width="80" height="50" rx="10"/>
        </g>
        <path d="M78 352 C 150 340, 170 250, 240 235 S 340 150, 378 92" stroke="#141414" stroke-width="4"
          stroke-dasharray="2 12" stroke-linecap="round" fill="none"/>
        <circle cx="78" cy="352" r="16" fill="#141414"/>
        <circle cx="78" cy="352" r="6" fill="#ffcb05"/>
        <circle cx="378" cy="92" r="34" fill="#ffcb05" opacity="0.35"/>
        <path d="M378 40c-15 0-27 11.6-27 26 0 19 27 43 27 43s27-24 27-43c0-14.4-12-26-27-26z" fill="#141414"/>
        <circle cx="378" cy="66" r="9" fill="#ffcb05"/>
      </svg>

      <div class="absolute left-[4%] top-[6%] flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold text-ink-900 shadow-float animate-float" aria-hidden="true">
        <span class="flex h-6 w-6 items-center justify-center rounded-full bg-tint-green text-verified"><Icon name="'locate-fixed'" size="14"/></span>
        Arrived · 38 m from pin
      </div>

      <div class="absolute bottom-[30%] right-[-2%] hidden items-center gap-2 rounded-full bg-ink-900 px-3 py-2 text-xs font-semibold text-white shadow-float animate-float [animation-delay:1.2s] sm:flex" aria-hidden="true">
        <Icon name="'shield-check'" size="14" class="'text-brand-solid'"/>
        ₹425 held safely
      </div>

      <div class="relative -mt-[30%] ml-auto w-[94%] sm:-mt-[34%] sm:mr-[-2%] sm:w-[88%]">
        <TaskCardPreview/>
      </div>
    </div>`;
  static components = { Icon, TaskCardPreview };
  static override props = {};
}
