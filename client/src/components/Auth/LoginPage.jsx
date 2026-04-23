import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Activity, Eye, EyeOff, LogIn, UserPlus, AlertCircle, Sparkles, Copy, Check } from 'lucide-react';
import { DEMO_EMAIL, DEMO_PASSWORD } from '../../utils/demo';

export default function LoginPage() {
  const { login, register, loginAsDemo } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [copied, setCopied] = useState('');

  const isRegister = mode === 'register';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        await register(name, email, password);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(
        err.response?.data?.error ||
        err.message ||
        (isRegister ? 'Registration failed. Please try again.' : 'Login failed. Please check your credentials.')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = async () => {
    setError('');
    setDemoLoading(true);
    try {
      await loginAsDemo();
    } catch (err) {
      setError(err.message || 'Could not sign into the demo account.');
    } finally {
      setDemoLoading(false);
    }
  };

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 1200);
    } catch { /* older browsers */ }
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setPassword('');
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-violet-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 mb-4">
            <Activity size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">B2B Customer Intelligence</h1>
          <p className="text-gray-400 mt-2">Invoice & Payment-Driven Analytics</p>
        </div>

        {/* Auth Card */}
        <div className="glass-card p-8">
          <div className="flex gap-2 mb-6 p-1 rounded-xl bg-gray-900/60 border border-gray-700/30">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                !isRegister ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                isRegister ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Create account
            </button>
          </div>

          <h2 className="text-lg font-semibold text-white mb-6">
            {isRegister ? 'Create your account' : 'Sign in to your account'}
          </h2>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {isRegister && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Full name</label>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                  required
                  minLength={2}
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full bg-gray-900/60 border border-gray-600/50 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder={isRegister ? 'At least 8 characters' : 'Enter your password'}
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  className="w-full bg-gray-900/60 border border-gray-600/50 rounded-xl px-4 py-3 pr-12 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all"
                  required
                  minLength={isRegister ? 8 : undefined}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 disabled:cursor-wait text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : isRegister ? (
                <UserPlus size={18} />
              ) : (
                <LogIn size={18} />
              )}
              {loading
                ? (isRegister ? 'Creating account...' : 'Signing in...')
                : (isRegister ? 'Create account' : 'Sign In')}
            </button>
          </form>

          <p className="text-center text-sm text-gray-400 mt-6">
            {isRegister ? (
              <>Already have an account?{' '}
                <button type="button" onClick={() => switchMode('login')} className="text-indigo-400 hover:text-indigo-300 font-medium">
                  Sign in
                </button>
              </>
            ) : (
              <>New here?{' '}
                <button type="button" onClick={() => switchMode('register')} className="text-indigo-400 hover:text-indigo-300 font-medium">
                  Create an account
                </button>
              </>
            )}
          </p>

          {/* Demo account — auth-only tour. No sample data is bundled; every
              dashboard requires a real Tally sync to render, same as any
              other account. We keep the "Continue as Demo" button so people
              can poke around the UI without signing up, but the card now
              tells them what they'll actually see. */}
          <div className="mt-6 pt-6 border-t border-gray-700/40">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={14} className="text-indigo-300" />
              <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Just looking around?</p>
            </div>
            <div className="rounded-xl bg-indigo-500/5 border border-indigo-500/20 p-4 space-y-3">
              <p className="text-xs text-gray-400 leading-relaxed">
                The demo account lets you navigate the UI without signing up. <b>No sample data is bundled</b> — every dashboard needs a real Tally sync. You can still see the Tally Sync page and the layout of each module.
              </p>
              <div className="grid grid-cols-[auto,1fr,auto] gap-x-2 gap-y-1.5 text-xs items-center">
                <span className="text-gray-500">Email</span>
                <code className="text-gray-200 font-mono truncate">{DEMO_EMAIL}</code>
                <button type="button" onClick={() => copy(DEMO_EMAIL, 'email')} title="Copy" className="text-gray-500 hover:text-indigo-300 p-1">
                  {copied === 'email' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                </button>
                <span className="text-gray-500">Password</span>
                <code className="text-gray-200 font-mono truncate">{DEMO_PASSWORD}</code>
                <button type="button" onClick={() => copy(DEMO_PASSWORD, 'password')} title="Copy" className="text-gray-500 hover:text-indigo-300 p-1">
                  {copied === 'password' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleDemo}
                disabled={demoLoading}
                className="w-full bg-indigo-500/20 hover:bg-indigo-500/30 disabled:opacity-50 disabled:cursor-wait text-indigo-200 font-semibold text-sm py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all border border-indigo-500/30"
              >
                {demoLoading ? (
                  <div className="w-4 h-4 border-2 border-indigo-200/30 border-t-indigo-200 rounded-full animate-spin" />
                ) : (
                  <Sparkles size={15} />
                )}
                {demoLoading ? 'Loading demo...' : 'Continue as Demo'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
