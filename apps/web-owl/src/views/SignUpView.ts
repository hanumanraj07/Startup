import { Component, useState, xml } from '@odoo/owl';
import { registerSchema } from '@onsite/validation';
import { AuthCard } from '@/components/AuthCard';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { Link } from '@/components/Link';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/TextField';
import { fieldErrors } from '@/lib/forms';
import { navigate } from '@/router/router';
import { ApiError } from '@/services/api';
import { loginWithGoogle, register } from '@/services/session';
import { LINK } from '@/ui/classes';

interface SignUpState {
  displayName: string;
  email: string;
  password: string;
  fieldErrors: { displayName?: string; email?: string; password?: string };
  formError: string | null;
  submitting: boolean;
}

export class SignUpView extends Component {
  static override template = xml`
    <AuthCard title="'Create your account'" description="'Get someone on the ground, wherever you need them.'">
      <GoogleSignInButton onToken="onGoogleToken" onError="setFormError"/>
      <div class="my-5 flex items-center gap-3 text-xs text-ink-400">
        <div class="h-px flex-1 bg-line"/>
        or continue with email
        <div class="h-px flex-1 bg-line"/>
      </div>
      <form class="flex flex-col gap-4" novalidate="" t-on-submit.prevent="onSubmit">
        <TextField id="'displayName'" label="'Full name'" autocomplete="'name'"
          value="state.displayName" error="state.fieldErrors.displayName" onInput="setDisplayName"/>
        <TextField id="'email'" label="'Email'" type="'email'" autocomplete="'email'"
          value="state.email" error="state.fieldErrors.email" onInput="setEmail"/>
        <TextField id="'password'" label="'Password'" type="'password'" autocomplete="'new-password'"
          hint="'At least 10 characters.'"
          value="state.password" error="state.fieldErrors.password" onInput="setPassword"/>
        <p t-if="state.formError" role="alert" class="text-sm text-dispute" t-out="state.formError"/>
        <SubmitButton label="'Create account'" busy="state.submitting"/>
      </form>
      <p class="mt-6 text-center text-sm text-ink-500">
        Already have an account?
        <Link to="'/sign-in'" class="linkClass">Sign in</Link>
      </p>
      <p class="mt-4 text-center text-xs text-ink-400">By continuing you agree to OnSite’s Terms and Privacy Policy.</p>
    </AuthCard>`;
  static components = { AuthCard, GoogleSignInButton, Link, SubmitButton, TextField };
  static override props = {};

  state = useState<SignUpState>({
    displayName: '',
    email: '',
    password: '',
    fieldErrors: {},
    formError: null,
    submitting: false,
  });

  linkClass = LINK;

  setDisplayName = (value: string) => {
    this.state.displayName = value;
  };
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

    const parsed = registerSchema.safeParse({
      displayName: state.displayName,
      email: state.email,
      password: state.password,
    });
    if (!parsed.success) {
      state.fieldErrors = fieldErrors(parsed.error, ['displayName', 'email', 'password'] as const);
      return;
    }

    state.submitting = true;
    try {
      await register(parsed.data.email, parsed.data.password, parsed.data.displayName);
      navigate('/dashboard');
    } catch (error) {
      state.formError = error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
    } finally {
      state.submitting = false;
    }
  }
}
