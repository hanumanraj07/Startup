import { Component, xml } from '@odoo/owl';
import { Link } from './Link';
import { Logo } from './Logo';

/**
 * The auth screens' frame: a yellow band carrying the logo and a one-line
 * promise, with the form card lifting out of it onto the gray page.
 */
export class AuthLayout extends Component {
  static override template = xml`
    <div class="relative min-h-screen bg-paper-50">
      <div class="absolute inset-x-0 top-0 h-[300px] bg-brand-solid sm:h-[340px]" aria-hidden="true">
        <div class="absolute inset-0 opacity-[0.12] [background-image:radial-gradient(#141414_1px,transparent_1px)] [background-size:22px_22px]"/>
      </div>
      <div class="relative flex flex-col items-center px-4 pb-12 pt-10 sm:pt-14">
        <Link to="'/'" class="'rounded-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900'" ariaLabel="'OnSite home'">
          <Logo inverse="true" size="40" textClass="'text-[26px] font-extrabold tracking-tight text-ink-900'"/>
        </Link>
        <p class="mt-3 text-center text-sm font-medium text-black/75">Someone on the ground, wherever you need them.</p>
        <main class="page-enter mt-8 w-full max-w-[400px]"><t t-slot="default"/></main>
      </div>
    </div>`;
  static components = { Link, Logo };
  static override props = { slots: { type: Object, optional: true } };
}
