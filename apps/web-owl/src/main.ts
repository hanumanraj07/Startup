import { mount } from '@odoo/owl';
import { App } from '@/components/App';
import { initRouter } from '@/router/router';
import { routes } from '@/routes';
import { registerServiceWorker } from '@/services/pwa';
import { bootstrapSession } from '@/services/session';
import '@fontsource-variable/plus-jakarta-sans';
import '@/styles/globals.css';

initRouter(routes);

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app mount point.');

// Mount first so public pages render immediately; the session restores in
// the background and guarded routes show a spinner until it settles.
mount(App, root, { dev: import.meta.env.DEV }).catch((error: unknown) => {
  console.error('OnSite failed to start:', error);
  root.textContent = 'Something went wrong loading OnSite. Please reload.';
});
void bootstrapSession();
registerServiceWorker();
