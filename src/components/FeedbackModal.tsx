import React, { useMemo, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { Bug, CheckCircle2, ChevronDown, CloudOff, Lightbulb, Loader2, MessageCircleHeart, UserRound } from 'lucide-react';
import { db, trackEvent } from '../firebase';
import { CURRENT_VERSION } from '../lib/changelog';
import { isRunningAsPwa } from '../lib/pwaService';
import {
  buildDiagnostics,
  buildFeedbackInput,
  diagnosticsRows,
  FEEDBACK_LIMITS,
  type FeedbackKind,
} from '../lib/feedback';
import { Sheet, SheetHeader } from './Sheet';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The signed-in account, or null when signed out */
  account: { uid: string; displayName?: string | null; email?: string | null } | null;
  /** Group and list on screen, e.g. "Eat" and "Restaurants" */
  groupLabel: string;
  listLabel: string;
}

/** How long to wait for the server before calling a send queued (the cache keeps it for later) */
const SEND_TIMEOUT_MS = 10_000;

type Status = 'editing' | 'sending' | 'sent' | 'queued' | 'error';

const KINDS: Array<{ kind: FeedbackKind; label: string; icon: typeof Lightbulb; placeholder: string }> = [
  {
    kind: 'idea',
    label: 'Idea / request',
    icon: Lightbulb,
    placeholder: 'What would make jelly better for you? A feature, a list, a tweak…',
  },
  {
    kind: 'bug',
    label: 'Something’s broken',
    icon: Bug,
    placeholder: 'What happened, and what did you expect? Steps to make it happen again help a lot.',
  },
];

function platformName(): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } };
  const p = nav.userAgentData?.platform || nav.platform || '';
  return nav.userAgentData?.mobile ? `${p} (mobile)` : p;
}

/** Send feedback or a bug report; each one becomes an issue on jelly's GitHub (see `functions/src/feedback.ts`). */
export const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose, account, groupLabel, listLabel }) => {
  const [kind, setKind] = useState<FeedbackKind>('idea');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [status, setStatus] = useState<Status>('editing');
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const diagnostics = useMemo(
    () =>
      buildDiagnostics({
        appVersion: CURRENT_VERSION,
        build: __APP_VERSION__,
        userAgent: navigator.userAgent,
        platform: platformName(),
        width: window.innerWidth,
        height: window.innerHeight,
        standalone: isRunningAsPwa(),
        group: groupLabel,
        list: listLabel,
      }),
    // Snapshot when the sheet opens; rotating the phone mid-message shouldn't matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, groupLabel, listLabel]
  );

  if (!isOpen) return null;

  const trimmedLength = message.trim().length;
  const canSend = trimmedLength > 0 && message.length <= FEEDBACK_LIMITS.message && status !== 'sending';
  const accountContact = account ? [account.displayName, account.email].filter(Boolean).join(' · ') : '';
  const activeKind = KINDS.find((k) => k.kind === kind)!;

  const close = () => {
    if (status === 'sent' || status === 'queued') {
      setMessage('');
      setContact('');
      setStatus('editing');
    }
    onClose();
  };

  const send = async () => {
    const input = buildFeedbackInput({ kind, message, contact, uid: account?.uid, diagnostics });
    if (!input || status === 'sending') return;
    setStatus('sending');
    // The local cache keeps the write and sends it once back online, so offline isn't a failure
    const write = addDoc(collection(db, 'feedback'), { ...input, createdAt: serverTimestamp() });
    if (!navigator.onLine) {
      write.catch(() => {});
      setStatus('queued');
      trackEvent('send_feedback', { kind, queued: true });
      return;
    }
    try {
      const result = await Promise.race([
        write.then(() => 'sent' as const),
        new Promise<'queued'>((resolve) => setTimeout(() => resolve('queued'), SEND_TIMEOUT_MS)),
      ]);
      setStatus(result);
      trackEvent('send_feedback', { kind, queued: result === 'queued' });
    } catch (err) {
      console.warn('feedback send failed', err);
      setStatus('error');
    }
  };

  return (
    <Sheet onClose={close} maxWidthClassName="max-w-md" maxHeightClassName="max-h-[90vh]">
      {(scrollContainerRef) => (
        <>
          <SheetHeader
            icon={<MessageCircleHeart className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
            title="Feedback & bug reports"
            onClose={close}
          />

          {status === 'sent' || status === 'queued' ? (
            <div ref={scrollContainerRef} className="px-6 py-8 overflow-y-auto flex-1 text-center space-y-3">
              <div
                className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center ${
                  status === 'sent'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                }`}
              >
                {status === 'sent' ? <CheckCircle2 className="w-7 h-7" /> : <CloudOff className="w-7 h-7" />}
              </div>
              <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-100">
                {status === 'sent' ? 'Thank you – got it!' : 'Saved – it’ll send when you’re back online'}
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-xs mx-auto">
                {kind === 'idea'
                  ? 'I read every message, and most requests ship within 24 hours. Watch Settings › What’s new.'
                  : 'I read every report, and bugs jump the queue. Thanks for helping make jelly better.'}
              </p>
              {status === 'queued' && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">Keep jelly open or come back later; nothing is lost.</p>
              )}
              <button
                type="button"
                onClick={close}
                className="mt-2 px-5 py-2 rounded-full bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950 text-sm font-semibold hover:bg-emerald-700 dark:hover:bg-emerald-400 transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div ref={scrollContainerRef} className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  jelly is built by one person, and I read every message. Most requests ship within 24 hours.
                </p>

                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800" role="radiogroup" aria-label="Type">
                  {KINDS.map(({ kind: k, label, icon: Icon }) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={kind === k}
                      onClick={() => setKind(k)}
                      className={`py-2 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                        kind === k
                          ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                      }`}
                    >
                      <Icon className={`w-3.5 h-3.5 ${kind === k ? (k === 'bug' ? 'text-rose-500' : 'text-amber-500') : ''}`} />
                      {label}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="feedback-message" className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 block">
                    {kind === 'idea' ? 'Your idea' : 'What went wrong'}
                  </label>
                  <textarea
                    id="feedback-message"
                    rows={5}
                    value={message}
                    maxLength={FEEDBACK_LIMITS.message}
                    onChange={(e) => {
                      setMessage(e.target.value);
                      if (status === 'error') setStatus('editing');
                    }}
                    placeholder={activeKind.placeholder}
                    className="w-full px-3 py-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 leading-relaxed resize-y min-h-[120px] focus:outline-none focus:border-emerald-500"
                  />
                  <div className="flex justify-end">
                    <span
                      className={`text-[10px] tabular-nums ${
                        message.length > FEEDBACK_LIMITS.message * 0.9 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400 dark:text-zinc-500'
                      }`}
                    >
                      {message.length.toLocaleString()}/{FEEDBACK_LIMITS.message.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="feedback-contact" className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 block">
                    How can I reach you? <span className="normal-case tracking-normal font-normal">(optional)</span>
                  </label>
                  <input
                    id="feedback-contact"
                    type="text"
                    value={contact}
                    maxLength={FEEDBACK_LIMITS.contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="Email, phone or @handle"
                    autoComplete="email"
                    className="w-full text-sm px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-500"
                  />
                  {accountContact && contact !== accountContact && (
                    <button
                      type="button"
                      onClick={() => setContact(accountContact.slice(0, FEEDBACK_LIMITS.contact))}
                      className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                    >
                      <UserRound className="w-3 h-3" />
                      Use {accountContact}
                    </button>
                  )}
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-normal">
                    Your message becomes an issue on jelly’s public GitHub. Contact details stay private.
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setShowDiagnostics((v) => !v)}
                    aria-expanded={showDiagnostics}
                    className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-semibold text-zinc-500 dark:text-zinc-400"
                  >
                    Included automatically
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDiagnostics ? 'rotate-180' : ''}`} />
                  </button>
                  {showDiagnostics && (
                    <dl className="px-3 pb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                      {diagnosticsRows(diagnostics, account?.uid).map(([label, value]) => (
                        <React.Fragment key={label}>
                          <dt className="text-zinc-400 dark:text-zinc-500 whitespace-nowrap">{label}</dt>
                          <dd className="text-zinc-700 dark:text-zinc-300 break-all">{value}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                  )}
                </div>
              </div>

              <div className="px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-zinc-100 dark:border-zinc-800 space-y-2">
                {status === 'error' && (
                  <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
                    Couldn’t send that – your message is still here. Please try again in a moment.
                  </p>
                )}
                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-emerald-700 dark:hover:bg-emerald-400 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  {status === 'sending' && <Loader2 className="w-4 h-4 animate-spin" />}
                  {status === 'sending' ? 'Sending…' : kind === 'idea' ? 'Send idea' : 'Send bug report'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
};
