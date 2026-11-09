import React, { useRef, useState } from 'react';
import { Check, Copy, FolderOpen, Lock, Mail } from 'lucide-react';
import {
  BELI_REQUEST_SUBJECT,
  BELI_SUPPORT_EMAIL,
  BELI_TURNAROUND,
  beliRequestBody,
  beliRequestMailto,
} from '../../lib/beliImportUi';
import { BeliToJellyArt, Hero, PrimaryButton, QuietButton, SecondaryButton } from './parts';

export const SignInStep: React.FC<{ onSignIn: () => void; onAsk: () => void }> = ({ onSignIn, onAsk }) => (
  <>
    <Hero title="Sign in to bring your Beli list" art={<BeliToJellyArt />}>
      Your rankings are saved to your jelly account, so they’re on every device and never only in this browser.
    </Hero>
    <button
      type="button"
      onClick={onSignIn}
      className="min-h-11 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-bold flex items-center justify-center gap-2"
    >
      <span className="font-extrabold text-[#4285f4]" aria-hidden="true">
        G
      </span>
      Continue with Google
    </button>
    <QuietButton onClick={onAsk}>Don’t have your Beli file yet? Ask Beli first</QuietButton>
  </>
);

export const FileStep: React.FC<{
  busy: boolean;
  error: string | null;
  onFiles: (files: File[]) => void;
  onAsk: () => void;
  resumable?: { savedAt: number; spots: number } | null;
  onResume?: () => void;
}> = ({ busy, error, onFiles, onAsk, resumable, onResume }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <>
      <Hero title="Bring your Beli rankings" art={<BeliToJellyArt />}>
        Your lists come over in your order. Nothing changes in Beli.
      </Hero>

      {resumable && onResume && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-3.5 flex flex-col gap-2">
          <p className="text-sm font-bold">Pick up where you left off</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Your import of {resumable.spots} places is saved on this device. Nothing was added yet.
          </p>
          <PrimaryButton grow={false} onClick={onResume} className="self-start">
            Continue import
          </PrimaryButton>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
        }}
        className={`rounded-3xl border-2 border-dashed p-5 flex flex-col items-center text-center gap-2.5 transition-colors ${
          dragging ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30' : 'border-zinc-200 dark:border-zinc-700'
        }`}
      >
        <FolderOpen className="w-7 h-7 text-zinc-400" aria-hidden="true" />
        <p className="text-sm font-bold">Choose your Beli export</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-[34ch]">
          The .zip Beli emailed you, or the CSV files inside it. Look in Files, Downloads or the email.
        </p>
        {/* No `accept` filter: iOS greys out zips for some apps, and a folder of CSVs must stay pickable */}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          data-testid="beli-file-input"
          onChange={(e) => {
            const files = e.target.files ? [...e.target.files] : [];
            e.target.value = '';
            if (files.length) onFiles(files);
          }}
        />
        <PrimaryButton grow={false} disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Reading…' : 'Choose file'}
        </PrimaryButton>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 p-3.5 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      <SecondaryButton onClick={onAsk}>I don’t have it yet – ask Beli</SecondaryButton>

      <div className="flex gap-2.5 items-start rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 p-3.5 text-xs text-zinc-600 dark:text-zinc-300">
        <Lock className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <p>
          <b className="text-zinc-900 dark:text-zinc-100">Read on this device.</b> jelly opens your rankings, want-to-try and
          notes. Only each place’s name and city go to Google Maps to find it. Your profile, phone and email in the file are
          never read.
        </p>
      </div>

      <details className="text-xs text-zinc-500 dark:text-zinc-400">
        <summary className="cursor-pointer font-semibold text-zinc-700 dark:text-zinc-300 min-h-8 flex items-center">
          Which files jelly reads
        </summary>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 mt-1.5">
          {[
            ['rankings.csv · bookmarks.csv', 'Read'],
            ['notes_dishes.csv', 'Read'],
            ['labels.csv · follows.csv', 'Counted only'],
            ['user_profile.csv · devices.csv', 'Never opened'],
            ['photos.csv · preferences.csv', 'Never opened'],
          ].map(([file, what]) => (
            <React.Fragment key={file}>
              <dt className="min-w-0 break-words">{file}</dt>
              <dd className={what === 'Read' ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'font-semibold'}>{what}</dd>
            </React.Fragment>
          ))}
        </dl>
      </details>
    </>
  );
};

export const AskBeliStep: React.FC<{
  username: string;
  onUsername: (name: string) => void;
}> = ({ username, onUsername }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = `To: ${BELI_SUPPORT_EMAIL}\nSubject: ${BELI_REQUEST_SUBJECT}\n\n${beliRequestBody(username)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard refused: the text is on screen to select by hand
    }
  };
  return (
    <>
      <Hero title="First, ask Beli for a copy">
        Beli has no export button, so you ask by email. They usually reply the same day and send the zip in {BELI_TURNAROUND}.
      </Hero>
      <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 p-4 flex flex-col gap-3">
        <label htmlFor="beli-username" className="text-xs font-bold">
          Your Beli username
        </label>
        <div className="flex items-center gap-1 min-h-11 px-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 focus-within:border-emerald-500">
          <span className="text-zinc-400" aria-hidden="true">
            @
          </span>
          <input
            id="beli-username"
            value={username}
            onChange={(e) => onUsername(e.target.value.replace(/^@+/, ''))}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            placeholder="yourname"
            className="flex-1 min-w-0 bg-transparent text-base sm:text-sm outline-none placeholder:text-zinc-400"
          />
        </div>
        <a
          href={beliRequestMailto(username)}
          className="min-h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center justify-center gap-2"
        >
          <Mail className="w-4 h-4" aria-hidden="true" />
          Write the email
        </a>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Opens your mail app with everything filled in. Send it from the email on your Beli account, so they know it’s you.
        </p>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer font-semibold text-zinc-700 dark:text-zinc-300 min-h-8 flex items-center">
          See the email
        </summary>
        <div className="mt-1.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800 p-3 flex flex-col gap-2 text-zinc-700 dark:text-zinc-300 select-text">
          <p>
            <b>To:</b> {BELI_SUPPORT_EMAIL}
          </p>
          <p>
            <b>Subject:</b> {BELI_REQUEST_SUBJECT}
          </p>
          <p className="whitespace-pre-line break-words">{beliRequestBody(username)}</p>
          <SecondaryButton small onClick={copy} className="self-start flex items-center gap-1.5">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy email'}
          </SecondaryButton>
        </div>
      </details>
      <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800/60 p-3.5 text-xs text-zinc-600 dark:text-zinc-400">
        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-1">While you wait</p>
        When the zip arrives, open it from jelly. You don’t need to unzip it. Until then, rank a few favorites.
      </div>
    </>
  );
};
