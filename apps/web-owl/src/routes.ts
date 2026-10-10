import type { Guard, Layout, RouteDef } from '@/router/router';
import { DashboardView } from '@/views/DashboardView';
import { FeedView } from '@/views/FeedView';
import { ForgotPasswordView } from '@/views/ForgotPasswordView';
import { NewTaskView } from '@/views/NewTaskView';
import { PlaceholderView } from '@/views/PlaceholderView';
import { ResetPasswordView } from '@/views/ResetPasswordView';
import { SignInView } from '@/views/SignInView';
import { SignUpView } from '@/views/SignUpView';
import { TaskDetailView } from '@/views/TaskDetailView';
import { TasksView } from '@/views/TasksView';
import { VerifyEmailView } from '@/views/VerifyEmailView';

function route(
  name: string,
  path: string,
  title: string,
  layout: Layout,
  guard: Guard,
  component: RouteDef['component'] = PlaceholderView,
): RouteDef {
  return { name, path, title, layout, guard, component };
}

/**
 * Every route in apps/web, one entry each (27). First match wins, so fixed
 * paths (/tasks/new) are listed before their parameterised siblings
 * (/tasks/:id). Replace `PlaceholderView` as each screen is ported.
 */
export const routes: RouteDef[] = [
  route('landing', '/', 'OnSite', 'marketing', 'public'),
  route('offline', '/offline', 'Offline', 'marketing', 'public'),

  route('sign-in', '/sign-in', 'Sign in', 'auth', 'public', SignInView),
  route('sign-up', '/sign-up', 'Create account', 'auth', 'public', SignUpView),
  route('forgot-password', '/forgot-password', 'Forgot password', 'auth', 'public', ForgotPasswordView),
  route('reset-password', '/reset-password', 'Reset password', 'auth', 'public', ResetPasswordView),
  route('verify-email', '/verify-email', 'Verify email', 'auth', 'public', VerifyEmailView),

  route('dashboard', '/dashboard', 'Dashboard', 'app', 'user', DashboardView),
  route('feed', '/feed', 'Feed', 'app', 'user', FeedView),
  route('tasks', '/tasks', 'My tasks', 'app', 'user', TasksView),
  route('task-new', '/tasks/new', 'Post a task', 'app', 'user', NewTaskView),
  route('task-detail', '/tasks/:id', 'Task', 'app', 'user', TaskDetailView),
  route('payments', '/payments', 'Payments', 'app', 'user'),
  route('notifications', '/notifications', 'Notifications', 'app', 'user'),
  route('settings', '/settings', 'Settings', 'app', 'user'),
  route('kyc', '/kyc', 'Identity verification', 'app', 'user'),
  route('profile', '/profile/:id', 'Profile', 'app', 'user'),
  route('worker-onboarding', '/worker/onboarding', 'Become a worker', 'app', 'user'),
  route('worker-earnings', '/worker/earnings', 'Earnings', 'app', 'user'),

  route('admin', '/admin', 'Admin', 'app', 'admin'),
  route('admin-kyc', '/admin/kyc', 'KYC queue', 'app', 'admin'),
  route('admin-disputes', '/admin/disputes', 'Disputes', 'app', 'admin'),
  route('admin-dispute-detail', '/admin/disputes/:id', 'Dispute', 'app', 'admin'),
  route('admin-users', '/admin/users', 'Users', 'app', 'admin'),
  route('admin-tasks', '/admin/tasks', 'Tasks', 'app', 'admin'),
  route('admin-task-detail', '/admin/tasks/:id', 'Task', 'app', 'admin'),
  route('admin-categories', '/admin/categories', 'Categories & cities', 'app', 'admin'),
];
