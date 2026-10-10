import { Component, onMounted, onWillUnmount, useRef, useState, xml } from '@odoo/owl';
import { config } from '@/lib/config';

interface CredentialResponse {
  credential: string;
}

interface GoogleAccountsId {
  initialize: (config: { client_id: string; callback: (response: CredentialResponse) => void }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('Could not load Google Sign-In.'));
      };
      document.body.appendChild(script);
    });
  }
  return scriptPromise;
}

/**
 * Renders Google's own Sign-In button (not a lookalike — Google's terms
 * require their rendered button). The ID token it produces is verified
 * server-side before anything about the claimed identity is trusted. Renders
 * nothing when no client id is configured or the script cannot load.
 */
export class GoogleSignInButton extends Component {
  static override template = xml`
    <div>
      <div t-if="!state.unavailable" t-ref="container" class="flex justify-center"/>
    </div>`;
  static override props = {
    onToken: Function,
    onError: Function,
  };

  state = useState({ unavailable: !config.googleClientId });
  container = useRef('container');
  private cancelled = false;

  override setup() {
    onMounted(() => {
      if (!config.googleClientId) return;
      loadScript()
        .then(() => {
          const el = this.container.el;
          if (this.cancelled || !el || !window.google) return;
          window.google.accounts.id.initialize({
            client_id: config.googleClientId,
            callback: (response) => {
              if (response.credential) this.props.onToken(response.credential);
              else this.props.onError('Google did not return a credential.');
            },
          });
          window.google.accounts.id.renderButton(el, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            width: 316,
          });
        })
        .catch(() => {
          if (!this.cancelled) this.state.unavailable = true;
        });
    });
    onWillUnmount(() => {
      this.cancelled = true;
    });
  }
}
