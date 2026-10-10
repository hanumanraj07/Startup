import { Component, onWillUnmount, useState, xml } from '@odoo/owl';
import { resetPasswordSchema } from '@onsite/validation';
import { AuthCard } from '@/components/AuthCard';
import { Link } from '@/components/Link';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/TextField';
import { fieldErrors } from '@/lib/forms';
import { navigate, routerState } from '@/router/router';
import { ApiError, api } from '@/services/api';

export class ResetPasswordView extends Component {
  static override template = xml`
    <AuthCard title="'Set a new password'" description="'Choose something you haven’t used before.'">
      <p t-if="!token" class="text-sm text-dispute">
        This reset link is missing its token.
        <Link to="'/forgot-password'" class="'underline'">Request a new one</Link>.
      </p>
      <p t-elif="state.done" class="text-sm text-verified">Password updated. Redirecting you to sign in…</p>
      <form t-else="" class="flex flex-col gap-4" novalidate="" t-on-submit.prevent="onSubmit">
        <TextField id="'password'" label="'New password'" type="'password'" autocomplete="'new-password'"
          hint="'At least 10 characters.'"
          value="state.password" error="state.passwordError" onInput="setPassword"/>
        <p t-if="state.formError" role="alert" class="text-sm text-dispute" t-out="state.formError"/>
        <SubmitButton label="'Update password'" busy="state.submitting"/>
      </form>
    </AuthCard>`;
  static components = { AuthCard, Link, SubmitButton, TextField };
  static override props = {};

  router = useState(routerState);
  state = useState<{
    password: string;
    passwordError?: string;
    formError: string | null;
    done: boolean;
    submitting: boolean;
  }>({ password: '', passwordError: undefined, formError: null, done: false, submitting: false });

  private redirectTimer: ReturnType<typeof setTimeout> | null = null;

  override setup() {
    onWillUnmount(() => {
      if (this.redirectTimer) clearTimeout(this.redirectTimer);
    });
  }

  get token(): string {
    return this.router.query.token ?? '';
  }

  setPassword = (value: string) => {
    this.state.password = value;
  };

  async onSubmit() {
    const { state } = this;
    state.formError = null;
    state.passwordError = undefined;

    const parsed = resetPasswordSchema.safeParse({ token: this.token, password: state.password });
    if (!parsed.success) {
      state.passwordError = fieldErrors(parsed.error, ['password'] as const).password;
      return;
    }

    state.submitting = true;
    try {
      await api.post('/auth/password/reset', parsed.data);
      state.done = true;
      this.redirectTimer = setTimeout(() => navigate('/sign-in'), 2000);
    } catch (error) {
      state.formError = error instanceof ApiError ? error.message : 'That reset link is invalid or has expired.';
    } finally {
      state.submitting = false;
    }
  }
}
