// Demo account — shown on the login page and auto-provisioned on first
// "Continue as Demo" click. The isDemo check gates all mock dashboards
// and locks destructive actions to view-only.
export const DEMO_EMAIL = 'demo@b2bintel.com';
export const DEMO_PASSWORD = 'Demo@2026!';
export const DEMO_NAME = 'Demo User';

export function isDemoUser(user) {
  if (!user) return false;
  return (user.email || '').toLowerCase() === DEMO_EMAIL;
}
