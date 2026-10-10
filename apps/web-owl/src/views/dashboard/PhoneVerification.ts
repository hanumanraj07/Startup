import { Component, useState, xml } from '@odoo/owl';
import { phoneSchema, verifyOtpSchema } from '@onsite/validation';
import { ApiError, api } from '@/services/api';
import { refetchUser } from '@/services/session';
import { btn, input } from '@/ui/classes';

/** Optional phone verification: send a one-time code, then confirm it. */
export class PhoneVerification extends Component {
  static override template = xml`
    <div class="flex flex-col gap-2 pl-6">
      <div t-if="!state.sent" class="flex gap-2">
        <input
          type="tel"
          placeholder="+91XXXXXXXXXX"
          aria-label="Phone number"
          t-att-class="phoneClass"
          t-model="state.phone"
        />
        <button type="button" t-att-class="secondaryClass" t-att-disabled="state.busy" t-on-click="sendCode">Send code</button>
      </div>
      <div t-else="" class="flex gap-2">
        <input
          inputmode="numeric"
          placeholder="6-digit code"
          aria-label="6-digit code"
          t-att-class="codeClass"
          t-model="state.code"
        />
        <button type="button" t-att-class="primaryClass" t-att-disabled="state.busy" t-on-click="verifyCode">Verify</button>
      </div>
      <p t-if="state.error" role="alert" class="text-sm text-dispute" t-out="state.error"/>
    </div>`;
  static override props = {};

  state = useState<{ phone: string; code: string; sent: boolean; busy: boolean; error: string | null }>({
    phone: '',
    code: '',
    sent: false,
    busy: false,
    error: null,
  });

  phoneClass = input(false, 'max-w-[220px]');
  codeClass = input(false, 'max-w-[140px]');
  secondaryClass = btn('secondary', 'sm');
  primaryClass = btn('primary', 'sm');

  async sendCode() {
    const { state } = this;
    state.error = null;
    const parsed = phoneSchema.safeParse(state.phone);
    if (!parsed.success) {
      state.error = parsed.error.issues[0]?.message ?? 'Enter a valid phone number.';
      return;
    }
    state.busy = true;
    try {
      await api.post('/auth/phone/send-otp', { phone: parsed.data });
      state.sent = true;
    } catch (err) {
      state.error = err instanceof ApiError ? err.message : 'Could not send a code. Try again.';
    } finally {
      state.busy = false;
    }
  }

  async verifyCode() {
    const { state } = this;
    state.error = null;
    const parsed = verifyOtpSchema.safeParse({ phone: state.phone, code: state.code });
    if (!parsed.success) {
      state.error = parsed.error.issues[0]?.message ?? 'Enter the 6-digit code.';
      return;
    }
    state.busy = true;
    try {
      await api.post('/auth/phone/verify-otp', parsed.data);
      await refetchUser();
    } catch (err) {
      state.error = err instanceof ApiError ? err.message : 'That code is incorrect or has expired.';
    } finally {
      state.busy = false;
    }
  }
}
