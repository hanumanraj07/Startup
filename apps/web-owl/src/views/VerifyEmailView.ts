import { Component, onMounted, useState, xml } from '@odoo/owl';
import { AuthCard } from '@/components/AuthCard';
import { Link } from '@/components/Link';
import { Spinner } from '@/components/Spinner';
import { routerState } from '@/router/router';
import { ApiError, api } from '@/services/api';

type VerifyStatus = 'pending' | 'success' | 'error';

export class VerifyEmailView extends Component {
  static override template = xml`
    <AuthCard title="'Verify your email'">
      <div t-if="state.status === 'pending'" class="flex items-center gap-2 text-sm text-ink-500">
        <Spinner/>
        Verifying your email…
      </div>
      <p t-elif="state.status === 'success'" class="text-sm text-verified">
        Email verified.
        <Link to="'/dashboard'" class="'underline'">Continue to your dashboard</Link>.
      </p>
      <p t-else="" role="alert" class="text-sm text-dispute" t-out="state.message"/>
    </AuthCard>`;
  static components = { AuthCard, Link, Spinner };
  static override props = {};

  state = useState<{ status: VerifyStatus; message: string }>({ status: 'pending', message: '' });

  override setup() {
    onMounted(() => {
      void this.verify();
    });
  }

  private async verify() {
    const token = routerState.query.token;
    if (!token) {
      this.state.status = 'error';
      this.state.message = 'This verification link is missing its token.';
      return;
    }
    try {
      await api.post('/auth/verify-email', { token });
      this.state.status = 'success';
    } catch (error) {
      this.state.status = 'error';
      this.state.message = error instanceof ApiError ? error.message : 'This link is invalid or has expired.';
    }
  }
}
