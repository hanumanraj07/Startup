import { Component, useState, xml } from '@odoo/owl';
import { Icon } from '@/components/Icon';
import { Page } from '@/components/Page';
import { TextField } from '@/components/TextField';
import { navigate, routerState } from '@/router/router';
import { ApiError, api } from '@/services/api';
import { btn, card, CARD_CONTENT } from '@/ui/classes';

/**
 * Stands in for DigiLocker's consent screen when the API runs the mock
 * verification provider (never in production: the API refuses this route
 * with a real provider). Clearly labelled as a test, so it can never be
 * mistaken for the real thing. The name typed here plays the part of the
 * name on the Aadhaar record.
 */
export class DigilockerTestView extends Component {
  static override template = xml`
    <Page breadcrumbs="[{ label: 'Identity verification', to: '/kyc' }, { label: 'DigiLocker (test)' }]">
      <div class="mx-auto flex max-w-md flex-col gap-4">
        <p class="flex items-center gap-2 rounded-input bg-tint-orange px-3 py-2 text-sm font-medium text-[#7a3d00]">
          <Icon name="'alert-triangle'" size="16"/> Test mode: this is not DigiLocker and no real documents are used.
        </p>
        <section t-att-class="cardClass">
          <div class="${CARD_CONTENT} flex flex-col gap-4">
            <div>
              <h2 class="text-lg font-semibold text-ink-900">Share your Aadhaar with OnSite?</h2>
              <p class="mt-1 text-sm text-ink-500">OnSite is asking for your name and the last 4 digits of your Aadhaar, to verify your identity.</p>
            </div>
            <TextField id="'aadhaar-name'" label="'Name on the Aadhaar record (test)'" value="state.name" onInput="setName"
              hint="'Your bank account will be checked against this name.'"/>
            <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
            <div class="flex flex-wrap gap-2">
              <button type="button" t-att-class="allowClass" t-att-disabled="state.busy or state.name.trim().length &lt; 3" t-on-click="allow">Allow and share</button>
              <button type="button" t-att-class="denyClass" t-att-disabled="state.busy" t-on-click="deny">Deny</button>
            </div>
          </div>
        </section>
      </div>
    </Page>`;
  static components = { Icon, Page, TextField };
  static override props = {};

  state = useState({ name: '', busy: false, error: null as string | null });
  cardClass = card();
  allowClass = btn('primary');
  denyClass = btn('secondary');

  setName = (value: string) => {
    this.state.name = value;
  };

  allow = () => this.decide(true);
  deny = () => this.decide(false);

  private async decide(allow: boolean) {
    const session = routerState.query.session;
    if (!session) {
      this.state.error = 'This link is missing its session. Start again from Identity verification.';
      return;
    }
    this.state.busy = true;
    this.state.error = null;
    try {
      await api.post(`/users/me/verification/identity/${session}/test-consent`, {
        allow,
        name: this.state.name.trim() || 'Not shared',
      });
      // Back to the app, as the real provider redirects to /kyc?session=…
      navigate(`/kyc?session=${encodeURIComponent(session)}`);
    } catch (error) {
      this.state.error = error instanceof ApiError ? error.message : 'Could not complete the test consent.';
    } finally {
      this.state.busy = false;
    }
  }
}
