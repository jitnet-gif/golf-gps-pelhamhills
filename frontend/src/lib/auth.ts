// Accounts: email and password against Supabase Auth.
//
// Password rather than an emailed code because Supabase's built-in mailer only
// delivers to the project's own team and twice an hour - a player on the 1st
// tee would never get the code. With "Confirm email" off in the dashboard,
// signing up signs straight in and no mail is sent at all.

import type { Session, User } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY, supabase } from './supabase';
import { useAppStore } from '@/store/appStore';

export type AuthProblem =
  | 'invalid'
  | 'exists'
  | 'weak'
  | 'badEmail'
  | 'unconfirmed'
  | 'rate'
  | 'network'
  | 'unavailable'
  | 'other';

export type AuthResult =
  | { ok: true; needsConfirmation?: boolean }
  | { ok: false; problem: AuthProblem; detail?: string };

let started = false;

const applyUser = (user: User | null | undefined) => {
  useAppStore
    .getState()
    .setAccount(user ? { id: user.id, email: user.email ?? null } : null);
};

const apply = (session: Session | null) => applyUser(session?.user);

/** The account this phone last signed in with, read from storage - no network. */
const savedUser = (): User | null => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    const user = raw ? (JSON.parse(raw) as { user?: User }).user : undefined;
    return user?.id ? user : null;
  } catch {
    return null;
  }
};

/**
 * Start listening once for the whole app. The listener only writes to the
 * store: calling back into supabase from inside it can deadlock the client.
 *
 * The card waits for the account (useScorecardSync), and getSession cannot
 * answer until it has refreshed a login more than an hour old - on one bar of
 * signal that took minutes, and with none it never came, so the Scorecard sat
 * on "Opening your card...". The account saved on the phone opens the card
 * now; the session confirms it, or the server ending it signs out.
 */
export const startAuth = () => {
  if (started) return;
  started = true;
  if (!supabase) {
    apply(null);
    return;
  }
  const saved = savedUser();
  if (saved) applyUser(saved);
  // A refresh that failed for want of signal answers "no session" but leaves
  // the login in storage for auth-js to try again; one the server refused is
  // removed, with SIGNED_OUT. So a login still in storage still counts.
  const keep = (session: Session | null) => !session && savedUser() !== null;
  supabase.auth
    .getSession()
    .then(({ data }) => {
      if (!keep(data.session)) apply(data.session);
    })
    .catch(() => {
      if (!savedUser()) apply(null);
    });
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION' && keep(session)) return;
    apply(session);
  });
};

const classify = (error: unknown): AuthResult => {
  const e = error as { code?: string; name?: string; message?: string; status?: number };
  const code = e?.code ?? '';
  const message = e?.message ?? '';
  let problem: AuthProblem = 'other';
  if (e?.name === 'AuthRetryableFetchError' || /fetch|network/i.test(message)) problem = 'network';
  else if (code === 'invalid_credentials' || /invalid login/i.test(message)) problem = 'invalid';
  else if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(message)) problem = 'exists';
  else if (code === 'weak_password' || /password should be/i.test(message)) problem = 'weak';
  else if (code === 'email_address_invalid' || code === 'validation_failed') problem = 'badEmail';
  else if (code === 'email_not_confirmed' || /not confirmed/i.test(message)) problem = 'unconfirmed';
  else if (/rate limit/i.test(code + message)) problem = 'rate';
  return { ok: false, problem, detail: message || undefined };
};

export const signIn = async (email: string, password: string): Promise<AuthResult> => {
  if (!supabase) return { ok: false, problem: 'unavailable' };
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? classify(error) : { ok: true };
  } catch (err) {
    return classify(err);
  }
};

export const signUp = async (email: string, password: string): Promise<AuthResult> => {
  if (!supabase) return { ok: false, problem: 'unavailable' };
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return classify(error);
    // No session means "Confirm email" is still on in the dashboard: the
    // account exists but cannot sign in until the email link is followed.
    return { ok: true, needsConfirmation: !data.session };
  } catch (err) {
    return classify(err);
  }
};

export const signOut = async () => {
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    // Offline: the local session is dropped anyway by the listener below.
    apply(null);
  }
};
