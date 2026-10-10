import { Component, xml } from '@odoo/owl';
import type { IconNodeChild } from 'lucide';
import { iconShapes } from '@/ui/icons';

export class Icon extends Component {
  static override template = xml`
    <svg
      xmlns="http://www.w3.org/2000/svg"
      t-att-width="size"
      t-att-height="size"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      t-att-class="props.class"
    >
      <t t-foreach="shapes" t-as="shape" t-key="shape_index">
        <path t-if="shape[0] === 'path'" t-att="shape[1]"/>
        <circle t-elif="shape[0] === 'circle'" t-att="shape[1]"/>
        <rect t-elif="shape[0] === 'rect'" t-att="shape[1]"/>
        <line t-elif="shape[0] === 'line'" t-att="shape[1]"/>
        <polyline t-elif="shape[0] === 'polyline'" t-att="shape[1]"/>
        <polygon t-elif="shape[0] === 'polygon'" t-att="shape[1]"/>
        <ellipse t-elif="shape[0] === 'ellipse'" t-att="shape[1]"/>
      </t>
    </svg>`;
  static override props = {
    name: String,
    size: { type: Number, optional: true },
    class: { type: String, optional: true },
  };

  get size(): number {
    return this.props.size ?? 16;
  }

  get shapes(): readonly IconNodeChild[] {
    return iconShapes(this.props.name);
  }
}
