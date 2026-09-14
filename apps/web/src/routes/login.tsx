import type { RegisterRequest, Session } from '@apion/contracts';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { RequestError, request, writeToken } from '../api/client.js';
import { keys } from '../api/queries.js';
import { ERROR_TEXT, FIELD, INPUT, LABEL } from '../ui.js';

/*
 * The two ways in, as a tab pair. Only one set of fields is live at a time, so
 * a person is never asked for an organisation while signing in.
 */
const MODE =
  'flex-1 cursor-pointer rounded-sm border border-transparent p-2 text-sm text-text-muted hover:text-text aria-selected:border-line-control aria-selected:bg-surface-0 aria-selected:font-semibold aria-selected:text-text';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

/**
 * Signing in and creating the first account share this screen. Registering
 * creates an organisation as well as a person, so it is the path a new
 * instance is set up through, not a self-service signup.
 */
function LoginPage() {
  const navigate = useNavigate();
  const { queryClient } = Route.useRouteContext();

  const [mode, setMode] = useState<'signIn' | 'register'>('signIn');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [organisationName, setOrganisationName] = useState('');

  const arrive = async (session: Session) => {
    writeToken(session.accessToken);
    // Seed rather than invalidate: the response already carries the user, so
    // the next screen renders without a round trip.
    queryClient.setQueryData(keys.session, session.user);
    await navigate({ to: '/' });
  };

  const signIn = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      request<Session>('/auth/login', { method: 'POST', body: credentials }),
    onSuccess: arrive,
  });

  const register = useMutation({
    mutationFn: (body: RegisterRequest) =>
      request<Session>('/auth/register', { method: 'POST', body }),
    onSuccess: arrive,
  });

  const active = mode === 'signIn' ? signIn : register;
  const errorMessage = describeError(active.error);

  return (
    <main
      className="grid min-h-full place-items-center bg-surface-0 p-5"
      id="main"
    >
      <div className="w-full max-w-88">
        <h1 className="mb-2 text-xl tracking-tight">Apion</h1>
        <p className="mb-8 text-text-muted">
          Agree the API contract before anyone writes the handler.
        </p>

        {/* Two ways in, one at a time: a tab pair rather than two stacked forms. */}
        <div
          className="mb-4 flex gap-1 rounded-md bg-surface-2 p-0.5"
          role="tablist"
          aria-label="Account"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signIn'}
            className={MODE}
            onClick={() => setMode('signIn')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={MODE}
            onClick={() => setMode('register')}
          >
            Create an organisation
          </button>
        </div>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === 'signIn') {
              signIn.mutate({ email, password });
              return;
            }
            register.mutate({
              email,
              password,
              displayName,
              organisationName,
              organisationSlug: slugify(organisationName),
            });
          }}
        >
          {mode === 'register' ? (
            <>
              <label className={FIELD}>
                <span className={LABEL}>Your name</span>
                <input
                  className={INPUT}
                  name="displayName"
                  autoComplete="name"
                  required
                  maxLength={120}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>

              <label className={FIELD}>
                <span className={LABEL}>Organisation</span>
                <input
                  className={INPUT}
                  name="organisationName"
                  autoComplete="organization"
                  required
                  maxLength={120}
                  value={organisationName}
                  onChange={(event) => setOrganisationName(event.target.value)}
                />
                {organisationName ? (
                  <span className="text-sm text-text-muted">
                    Projects will live at /{slugify(organisationName)}/…
                  </span>
                ) : null}
              </label>
            </>
          ) : null}

          <label className={FIELD}>
            <span className={LABEL}>Email</span>
            <input
              className={INPUT}
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className={FIELD}>
            <span className={LABEL}>Password</span>
            <input
              className={INPUT}
              type="password"
              name="password"
              autoComplete={
                mode === 'signIn' ? 'current-password' : 'new-password'
              }
              required
              minLength={mode === 'register' ? 8 : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {mode === 'register' ? (
              <span className="text-sm text-text-muted">
                At least 8 characters.
              </span>
            ) : null}
          </label>

          {/* Announced, not just shown, and never colour alone. */}
          {errorMessage ? (
            <p className={`${ERROR_TEXT} text-sm`} role="alert">
              {errorMessage}
            </p>
          ) : null}

          <button
            className="min-h-11 cursor-pointer rounded-md border border-accent bg-accent p-3 font-semibold text-accent-text disabled:cursor-progress disabled:opacity-70"
            type="submit"
            disabled={active.isPending}
          >
            {active.isPending
              ? mode === 'signIn'
                ? 'Signing in…'
                : 'Creating…'
              : mode === 'signIn'
                ? 'Sign in'
                : 'Create organisation'}
          </button>
        </form>
      </div>
    </main>
  );
}

function describeError(error: unknown): string | null {
  if (error instanceof RequestError) {
    // A validation failure names the field, which is more use than the summary.
    const detail = error.details?.[0];
    return detail ? `${detail.message}` : error.message;
  }
  return error
    ? 'Cannot reach the server. Check your connection and try again.'
    : null;
}

/** Mirrors `slugify` in @apion/domain so the URL is visible before submitting. */
function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}
