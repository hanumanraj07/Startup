import { Component, useState, xml } from '@odoo/owl';
import { loginSchema } from '@onsite/validation';
import { AuthCard } from '@/components/AuthCard';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { Link } from '@/components/Link';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/TextField';
import { fieldErrors } from '@/lib/forms';
import { navigate } from '@/router/router';
import { ApiError } from '@/services/api';
import { login, loginWithGoogle } from '@/services/session';
import { LINK } from '@/ui/classes';

interface SignInState {
  email: string;
  password: string;
  fieldErrors: { email?: string; password?: string };
  formError: string | null;
  submitting: boolean;
}

export class SignInView extends Component {
  static override template = xml`
    <AuthCard title="'Sign in'" description="'Welcome back.'">
      <GoogleSignInButton onToken="onGoogleToken" onError="setFormError"/>
      <div class="my-5 flex items-center gap-3 text-xs text-ink-400">
        <div class="h-px flex-1 bg-line"/>
        or continue with email
        <div class="h-px flex-1 bg-line"/>
      </div>
      <form class="flex flex-col gap-4" novalidate="" t-on-submit.prevent="onSubmit">
        <TextField id="'email'" label="'Email'" type="'email'" autocomplete="'email'"
          value="state.email" error="state.fieldErrors.email" onInput="setEmail"/>
        <TextField id="'password'" label="'Password'" type="'password'" autocomplete="'current-password'"
          value="state.password" error="state.fieldErrors.password" onInput="setPassword"/>
        <p t-if="state.formError" role="alert" class="text-sm text-dispute" t-out="state.formError"/>
        <div class="flex justify-end">
          <Link to="'/forgot-password'" class="linkClass">Forgot password?</Link>
        </div>
        <SubmitButton label="'Sign in'" busy="state.submitting"/>
      </form>
      <p class="mt-6 text-center text-sm text-ink-500">
        New to OnSite?
        <Link to="'/sign-up'" class="linkClass">Create an account</Link>
      </p>
    </AuthCard>`;
  static components = { AuthCard, GoogleSignInButton, Link, SubmitButton, TextField };
  static override props = {};

  state = useState<SignInState>({
    email: '',
    password: '',
    fieldErrors: {},
    formError: null,
    submitting: false,
  });

  linkClass = LINK;

  setEmail = (value: string) => {
    this.state.email = value;
  };
  setPassword = (value: string) => {
    this.state.password = value;
  };
  setFormError = (message: string) => {
    this.state.formError = message;
  };

  onGoogleToken = async (idToken: string) => {
    this.state.formError = null;
    try {
      await loginWithGoogle(idToken);
      navigate('/dashboard');
    } catch (error) {
      this.state.formError = error instanceof ApiError ? error.message : 'Google sign-in failed. Try again.';
    }
  };

  async onSubmit() {
    const { state } = this;
    state.formError = null;
    state.fieldErrors = {};

    const parsed = loginSchema.safeParse({ email: state.email, password: state.password });
    if (!parsed.success) {
      state.fieldErrors = fieldErrors(parsed.error, ['email', 'password'] as const);
      return;
    }

    state.submitting = true;
    try {
      await login(parsed.data.email, parsed.data.password);
      navigate('/dashboard');
    } catch (error) {
      state.formError = error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
    } finally {
      state.submitting = false;
    }
  }
}
