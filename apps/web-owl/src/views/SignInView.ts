import { Component, useState, xml } from '@odoo/owl';
import { loginSchema } from '@onsite/validation';
import { Link } from '@/components/Link';
import { navigate } from '@/router/router';
import { ApiError } from '@/services/api';
import { login } from '@/services/session';
import { btn, card, CARD_CONTENT, CARD_DESCRIPTION, CARD_HEADER, CARD_TITLE, input, LABEL } from '@/ui/classes';

interface SignInState {
  email: string;
  password: string;
  fieldErrors: { email?: string; password?: string };
  formError: string | null;
  submitting: boolean;
}

/** First ported screen; proves the session service end to end. Google sign-in lands with the rest of auth. */
export class SignInView extends Component {
  static override template = xml`
    <div t-att-class="cardClass">
      <div class="${CARD_HEADER}">
        <h1 class="${CARD_TITLE}">Sign in</h1>
        <p class="${CARD_DESCRIPTION}">Welcome back.</p>
      </div>
      <div class="${CARD_CONTENT}">
        <form class="flex flex-col gap-4" novalidate="" t-on-submit.prevent="onSubmit">
          <div class="flex flex-col gap-1.5">
            <label for="email" class="${LABEL}">Email</label>
            <input
              id="email" type="email" autocomplete="email" t-model="state.email"
              t-att-class="inputClass(state.fieldErrors.email)"
              t-att-aria-invalid="state.fieldErrors.email ? 'true' : null"
              t-att-aria-describedby="state.fieldErrors.email ? 'email-error' : null"
            />
            <p t-if="state.fieldErrors.email" id="email-error" role="alert" class="text-sm text-dispute" t-out="state.fieldErrors.email"/>
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="password" class="${LABEL}">Password</label>
            <input
              id="password" type="password" autocomplete="current-password" t-model="state.password"
              t-att-class="inputClass(state.fieldErrors.password)"
              t-att-aria-invalid="state.fieldErrors.password ? 'true' : null"
              t-att-aria-describedby="state.fieldErrors.password ? 'password-error' : null"
            />
            <p t-if="state.fieldErrors.password" id="password-error" role="alert" class="text-sm text-dispute" t-out="state.fieldErrors.password"/>
          </div>
          <p t-if="state.formError" role="alert" class="text-sm text-dispute" t-out="state.formError"/>
          <div class="flex justify-end">
            <Link to="'/forgot-password'" class="'text-sm text-brand-600 hover:underline'">Forgot password?</Link>
          </div>
          <button type="submit" t-att-class="submitClass" t-att-disabled="state.submitting" t-att-aria-busy="state.submitting ? 'true' : null">
            <span t-if="state.submitting" class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white" aria-hidden="true"/>
            Sign in
          </button>
        </form>
        <p class="mt-5 text-center text-sm text-ink-500">
          New to OnSite?
          <Link to="'/sign-up'" class="'text-brand-600 hover:underline'">Create an account</Link>
        </p>
      </div>
    </div>`;
  static components = { Link };
  static override props = {};

  state = useState<SignInState>({
    email: '',
    password: '',
    fieldErrors: {},
    formError: null,
    submitting: false,
  });

  cardClass = card('glass');
  submitClass = btn('primary', 'default', 'w-full');

  inputClass(error: string | undefined): string {
    return input(Boolean(error));
  }

  async onSubmit() {
    const { state } = this;
    state.formError = null;
    state.fieldErrors = {};

    const parsed = loginSchema.safeParse({ email: state.email, password: state.password });
    if (!parsed.success) {
      const errors: SignInState['fieldErrors'] = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if ((field === 'email' || field === 'password') && !errors[field]) errors[field] = issue.message;
      }
      state.fieldErrors = errors;
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
