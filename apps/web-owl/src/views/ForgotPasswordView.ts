import { Component, useState, xml } from '@odoo/owl';
import { forgotPasswordSchema } from '@onsite/validation';
import { AuthCard } from '@/components/AuthCard';
import { Link } from '@/components/Link';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/TextField';
import { fieldErrors } from '@/lib/forms';
import { api } from '@/services/api';
import { LINK } from '@/ui/classes';

export class ForgotPasswordView extends Component {
  static override template = xml`
    <AuthCard title="'Reset your password'" description="'We’ll email you a link if an account exists.'">
      <p t-if="state.sent" class="text-sm text-ink-700">
        If an account exists for that email, a reset link is on its way. Check your inbox.
      </p>
      <form t-else="" class="flex flex-col gap-4" novalidate="" t-on-submit.prevent="onSubmit">
        <TextField id="'email'" label="'Email'" type="'email'" autocomplete="'email'"
          value="state.email" error="state.emailError" onInput="setEmail"/>
        <SubmitButton label="'Send reset link'" busy="state.submitting"/>
      </form>
      <p class="mt-6 text-center text-sm text-ink-500">
        <Link to="'/sign-in'" class="linkClass">Back to sign in</Link>
      </p>
    </AuthCard>`;
  static components = { AuthCard, Link, SubmitButton, TextField };
  static override props = {};

  state = useState<{ email: string; emailError?: string; sent: boolean; submitting: boolean }>({
    email: '',
    emailError: undefined,
    sent: false,
    submitting: false,
  });

  linkClass = LINK;

  setEmail = (value: string) => {
    this.state.email = value;
  };

  async onSubmit() {
    const { state } = this;
    state.emailError = undefined;

    const parsed = forgotPasswordSchema.safeParse({ email: state.email });
    if (!parsed.success) {
      state.emailError = fieldErrors(parsed.error, ['email'] as const).email;
      return;
    }

    state.submitting = true;
    // The API answers identically whether or not the address is registered,
    // so there is nothing to branch on here either.
    await api.post('/auth/password/forgot', parsed.data).catch(() => undefined);
    state.submitting = false;
    state.sent = true;
  }
}
