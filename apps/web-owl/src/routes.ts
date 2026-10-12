import type { Guard, Layout, RouteDef } from '@/router/router';
import { PUBLIC_PAGES, type PublicPageName } from '@/seo/pages';
import { AdminCategoriesView } from '@/views/admin/AdminCategoriesView';
import { AdminDashboardView } from '@/views/admin/AdminDashboardView';
import { AdminDisputeDetailView } from '@/views/admin/AdminDisputeDetailView';
import { AdminDisputesView } from '@/views/admin/AdminDisputesView';
import { AdminKycView } from '@/views/admin/AdminKycView';
import { AdminTaskDetailView } from '@/views/admin/AdminTaskDetailView';
import { AdminTasksView } from '@/views/admin/AdminTasksView';
import { AdminUsersView } from '@/views/admin/AdminUsersView';
import { DashboardView } from '@/views/DashboardView';
import { EarningsView } from '@/views/EarningsView';
import { FeedView } from '@/views/FeedView';
import { ForgotPasswordView } from '@/views/ForgotPasswordView';
import { KycView } from '@/views/KycView';
import { LandingView } from '@/views/LandingView';
import { LicensesView } from '@/views/LicensesView';
import { NewTaskView } from '@/views/NewTaskView';
import { NotificationsView } from '@/views/NotificationsView';
import { OfflineView } from '@/views/OfflineView';
import { PaymentsView } from '@/views/PaymentsView';
import { ProfileView } from '@/views/ProfileView';
import { ResetPasswordView } from '@/views/ResetPasswordView';
import { SettingsView } from '@/views/SettingsView';
import { SignInView } from '@/views/SignInView';
import { SignUpView } from '@/views/SignUpView';
import { TaskDetailView } from '@/views/TaskDetailView';
import { TasksView } from '@/views/TasksView';
import { VerifyEmailView } from '@/views/VerifyEmailView';
import { WorkerOnboardingView } from '@/views/WorkerOnboardingView';

function route(
  name: string,
  path: string,
  title: string,
  layout: Layout,
  guard: Guard,
  component: RouteDef['component'],
): RouteDef {
  return { name, path, title, layout, guard, component };
}

/** A public page: its path and title come from seo/pages.ts, where its search metadata lives. */
function page(name: PublicPageName, layout: Layout, component: RouteDef['component']): RouteDef {
  const meta = PUBLIC_PAGES[name];
  return route(name, meta.path, meta.title, layout, 'public', component);
}

/**
 * Every route in apps/web, one entry each (27), plus /licenses. First match wins, so fixed
 * paths (/tasks/new) are listed before their parameterised siblings
 * (/tasks/:id).
 */
export const routes: RouteDef[] = [
  page('landing', 'marketing', LandingView),
  page('offline', 'marketing', OfflineView),
  page('licenses', 'marketing', LicensesView),

  page('sign-in', 'auth', SignInView),
  page('sign-up', 'auth', SignUpView),
  page('forgot-password', 'auth', ForgotPasswordView),
  page('reset-password', 'auth', ResetPasswordView),
  page('verify-email', 'auth', VerifyEmailView),

  route('dashboard', '/dashboard', 'Dashboard', 'app', 'user', DashboardView),
  route('feed', '/feed', 'Feed', 'app', 'user', FeedView),
  route('tasks', '/tasks', 'My tasks', 'app', 'user', TasksView),
  route('task-new', '/tasks/new', 'Post a task', 'app', 'user', NewTaskView),
  route('task-detail', '/tasks/:id', 'Task', 'app', 'user', TaskDetailView),
  route('payments', '/payments', 'Payments', 'app', 'user', PaymentsView),
  route('notifications', '/notifications', 'Notifications', 'app', 'user', NotificationsView),
  route('settings', '/settings', 'Settings', 'app', 'user', SettingsView),
  route('kyc', '/kyc', 'Identity verification', 'app', 'user', KycView),
  route('profile', '/profile/:id', 'Profile', 'app', 'user', ProfileView),
  route('worker-onboarding', '/worker/onboarding', 'Become a worker', 'app', 'user', WorkerOnboardingView),
  route('worker-earnings', '/worker/earnings', 'Earnings', 'app', 'user', EarningsView),

  route('admin', '/admin', 'Admin', 'app', 'admin', AdminDashboardView),
  route('admin-kyc', '/admin/kyc', 'KYC queue', 'app', 'admin', AdminKycView),
  route('admin-disputes', '/admin/disputes', 'Disputes', 'app', 'admin', AdminDisputesView),
  route('admin-dispute-detail', '/admin/disputes/:id', 'Dispute', 'app', 'admin', AdminDisputeDetailView),
  route('admin-users', '/admin/users', 'Users', 'app', 'admin', AdminUsersView),
  route('admin-tasks', '/admin/tasks', 'Tasks', 'app', 'admin', AdminTasksView),
  route('admin-task-detail', '/admin/tasks/:id', 'Task', 'app', 'admin', AdminTaskDetailView),
  route('admin-categories', '/admin/categories', 'Categories & cities', 'app', 'admin', AdminCategoriesView),
];
