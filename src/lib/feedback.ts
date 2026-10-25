/**
 * Feedback & bug reports: the `feedback/{id}` doc shape shared by the app (`FeedbackModal`), the
 * rules (`isValidFeedback` in `firestore.rules`) and the function that turns each one into a
 * GitHub issue (`functions/src/feedback.ts`). Pure and dependency-free, so `functions/` compiles it.
 */

export type FeedbackKind = 'idea' | 'bug';

export const FEEDBACK_KINDS: FeedbackKind[] = ['idea', 'bug'];

export const FEEDBACK_LIMITS = {
  message: 4000,
  contact: 200,
} as const;

/** What the app attaches to every message, shown to the user before sending */
export interface FeedbackDiagnostics {
  /** Release from the changelog, e.g. "3.4.0" */
  appVersion: string;
  /** Unique build stamp (`__APP_VERSION__`) */
  build: string;
  platform: string;
  userAgent: string;
  /** CSS pixels, e.g. "390×844" */
  viewport: string;
  /** Running as an installed app (home-screen PWA) */
  standalone: boolean;
  /** Group and list open when the sheet was opened */
  group: string;
  list: string;
}

/** Longest each diagnostics string may be; the rules enforce the same caps */
export const DIAGNOSTIC_MAX: Record<Exclude<keyof FeedbackDiagnostics, 'standalone'>, number> = {
  appVersion: 40,
  build: 40,
  platform: 100,
  userAgent: 500,
  viewport: 40,
  group: 40,
  list: 40,
};

/** The client-written part of `feedback/{id}` (`createdAt` is the server timestamp) */
export interface FeedbackInput {
  kind: FeedbackKind;
  message: string;
  /** Only when the user typed one or opted in to their account's name/email */
  contact?: string;
  /** Only when signed in */
  uid?: string;
  diagnostics: FeedbackDiagnostics;
}

export interface DiagnosticsEnv {
  appVersion: string;
  build: string;
  userAgent: string;
  platform?: string;
  width: number;
  height: number;
  standalone: boolean;
  group: string;
  list: string;
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/** Diagnostics clipped to the rules' caps, so an unusual user agent never blocks a send */
export function buildDiagnostics(env: DiagnosticsEnv): FeedbackDiagnostics {
  const raw: FeedbackDiagnostics = {
    appVersion: env.appVersion,
    build: env.build,
    platform: env.platform || 'unknown',
    userAgent: env.userAgent || 'unknown',
    viewport: `${Math.round(env.width)}×${Math.round(env.height)}`,
    standalone: env.standalone,
    group: env.group,
    list: env.list,
  };
  for (const key of Object.keys(DIAGNOSTIC_MAX) as Array<keyof typeof DIAGNOSTIC_MAX>) {
    raw[key] = clip(String(raw[key]), DIAGNOSTIC_MAX[key]);
  }
  return raw;
}

/**
 * The doc to write: trimmed text, and no `contact`/`uid` keys at all when there's none (the rules
 * reject nulls and unknown keys). Returns null when the message is empty or too long.
 */
export function buildFeedbackInput(args: {
  kind: FeedbackKind;
  message: string;
  contact?: string;
  uid?: string | null;
  diagnostics: FeedbackDiagnostics;
}): FeedbackInput | null {
  const message = args.message.trim();
  if (!message || message.length > FEEDBACK_LIMITS.message) return null;
  const contact = clip((args.contact ?? '').trim(), FEEDBACK_LIMITS.contact);
  return {
    kind: args.kind,
    message,
    ...(contact ? { contact } : {}),
    ...(args.uid ? { uid: args.uid } : {}),
    diagnostics: args.diagnostics,
  };
}

/** Rows for the "Included automatically" list in the sheet */
export function diagnosticsRows(d: FeedbackDiagnostics, uid: string | null | undefined): Array<[string, string]> {
  return [
    ['App version', `${d.appVersion} (build ${d.build})`],
    ['Device', d.platform],
    ['Browser', d.userAgent],
    ['Screen', d.viewport],
    ['Installed app', d.standalone ? 'Yes' : 'No'],
    ['Open list', `${d.group} › ${d.list}`],
    ['Account', uid ? `Signed in (${uid})` : 'Signed out'],
  ];
}
