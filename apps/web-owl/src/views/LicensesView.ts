import { Component, onMounted, onWillUnmount, useState, xml } from '@odoo/owl';
import { Link } from '@/components/Link';
import { card, LINK } from '@/ui/classes';

/** One entry of /licenses.json, written at build time by vite-plugins/licenses.ts. */
interface ThirdPartyLicense {
  name: string;
  version: string;
  license: string;
  repository: string | null;
  file: string | null;
}

const BAR = 'skeleton rounded-md';

/**
 * The third-party software shipped to the browser and its licences. The list
 * is generated from the modules actually in the build, so it matches what a
 * visitor downloads. OWL is LGPL-3.0, which is why it gets its own notice:
 * it is used unmodified and served as a separate file so it can be replaced.
 */
export class LicensesView extends Component {
  static override template = xml`
    <div class="min-h-screen bg-paper-50">
      <header class="mx-auto max-w-3xl px-6 pt-10">
        <Link to="'/'" class="'text-lg font-extrabold tracking-tight text-ink-900'">OnSite</Link>
      </header>
      <main class="mx-auto max-w-3xl px-6 pb-10">
        <h1 class="mt-8 text-2xl font-semibold tracking-tight text-ink-900">Open-source licences</h1>
        <p class="mt-2 text-ink-500">
          OnSite is built with open-source software. These are the third-party packages that are sent to your browser,
          with their licences.
        </p>

        <section t-att-class="noticeClass">
          <h2 class="font-medium text-ink-900">OWL</h2>
          <p class="mt-1 text-sm text-ink-700">
            The interface is built with OWL (<code>@odoo/owl</code>), licensed under the GNU Lesser General Public
            License v3. OnSite uses it unmodified and serves it as its own file, separate from OnSite’s code, so it can be
            replaced with another build of OWL. Its source code is at
            <a href="https://github.com/odoo/owl" t-att-class="linkClass" rel="noreferrer">github.com/odoo/owl</a>,
            and the full licence text is
            <a href="/licenses/odoo__owl.txt" t-att-class="linkClass">here</a>.
            OnSite is not affiliated with or endorsed by Odoo.
          </p>
        </section>

        <p t-if="state.error" class="mt-6 text-sm text-ink-500" t-out="state.error"/>
        <div t-elif="!state.packages" t-att-class="tableClass" aria-hidden="true">
          <div t-foreach="[0, 1, 2, 3]" t-as="i" t-key="i" class="flex justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
            <div class="h-4 w-40 ${BAR}"/><div class="h-4 w-20 ${BAR}"/>
          </div>
        </div>
        <div t-else="" t-att-class="tableClass">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-line bg-paper-100 text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th scope="col" class="px-3 py-2.5 font-medium sm:px-4">Package</th>
                <th scope="col" class="px-3 py-2.5 font-medium sm:px-4">Licence</th>
                <th scope="col" class="px-3 py-2.5 text-right font-medium sm:px-4">Links</th>
              </tr>
            </thead>
            <tbody>
              <tr t-foreach="state.packages" t-as="p" t-key="p.name" class="border-b border-line last:border-b-0">
                <td class="px-3 py-3 sm:px-4">
                  <span class="break-all font-medium text-ink-900" t-out="p.name"/>
                  <span class="tabular ml-1 text-ink-400" t-out="p.version"/>
                </td>
                <td class="px-3 py-3 text-ink-700 sm:px-4" t-out="p.license"/>
                <td class="px-3 py-3 sm:px-4">
                  <div class="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:gap-3">
                    <a t-if="p.file" t-att-href="p.file" t-att-class="linkClass">Licence</a>
                    <a t-if="p.repository" t-att-href="p.repository" t-att-class="linkClass" rel="noreferrer">Source</a>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </main>
    </div>`;
  static components = { Link };
  static override props = {};

  state = useState<{ packages: ThirdPartyLicense[] | null; error: string | null }>({ packages: null, error: null });
  noticeClass = card('mt-6 p-4');
  tableClass = card('mt-6 overflow-x-auto');
  linkClass = LINK;

  private disposed = false;

  override setup() {
    onMounted(() => {
      void this.load();
    });
    onWillUnmount(() => {
      this.disposed = true;
    });
  }

  private async load() {
    try {
      const res = await fetch('/licenses.json');
      // In dev the list does not exist (it is written at build time) and the
      // server answers with the app's HTML instead.
      if (!res.ok || !res.headers.get('content-type')?.includes('json')) {
        throw new Error('not built');
      }
      const packages = (await res.json()) as ThirdPartyLicense[];
      if (!this.disposed) this.state.packages = packages;
    } catch {
      if (!this.disposed) this.state.error = 'The package list is generated when the app is built, so it is only available on the deployed site.';
    }
  }
}
