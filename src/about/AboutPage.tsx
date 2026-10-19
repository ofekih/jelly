import React from 'react';
import { ArrowLeft, ArrowRight, Scale, Sparkles, Swords } from 'lucide-react';
import { JellyBeanIcon } from '../components/JellyBeanIcon';
import { RATING_TIERS } from '../lib/ratingTiers';
import { CATEGORY_EMOJI, CATEGORY_LABEL, GROUP_CATEGORIES } from '../types';
import { BucketsDemo } from './demos/BucketsDemo';
import { ScoreDemo } from './demos/ScoreDemo';
import { SpectrumDemo } from './demos/SpectrumDemo';
import { SxSDemo } from './demos/SxSDemo';
import { TasteDemo } from './demos/TasteDemo';
import { Callout, Nerd, Section, Tex } from './ui';

const TOC = [
  { id: 'premise', label: 'Why jelly' },
  { id: 'gut', label: 'Gut feeling' },
  { id: 'sxs', label: 'Side-by-side' },
  { id: 'score', label: 'The score' },
  { id: 'friends', label: 'Taste match' },
  { id: 'name', label: 'The name' },
  { id: 'us', label: 'Who we are' },
];

const STEPS = [
  { icon: Sparkles, title: 'Gut feeling', body: 'One quick tap on a spectrum: roughly how good was it?' },
  { icon: Swords, title: 'Side-by-side', body: 'A few “this or that?” questions find its exact place in your list.' },
  { icon: Scale, title: 'Score', body: 'Your order becomes 1–10 scores, scaled by how good things felt.' },
];

/** Tier shares of the bar (see Step 1); "how often" averages MovieLens, Letterboxd and BeerAdvocate */
const SHARE_ROWS = [
  { label: 'How often', values: [11, 20, 26, 31, 12] },
  { label: 'Plain line', values: [33, 22, 17, 14, 13] },
  { label: 'jelly’s bar', values: RATING_TIERS.map((t) => t.barShare), bold: true },
];

const GROUPS: Array<{ key: keyof typeof GROUP_CATEGORIES; name: string }> = [
  { key: 'eat', name: 'Eat' },
  { key: 'explore', name: 'Explore' },
  { key: 'travel', name: 'Travel' },
];

const A: React.FC<{ href: string; children: React.ReactNode }> = ({ href, children }) => (
  <a
    href={href}
    className="font-semibold text-jade-700 underline decoration-jade-300 underline-offset-2 hover:decoration-jade-600 dark:text-jade-300 dark:decoration-jade-700"
  >
    {children}
  </a>
);

export const AboutPage: React.FC = () => (
  <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
    <main className="mx-auto max-w-2xl px-4 pb-20 pt-6 sm:pt-10">
      <a href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" /> Back to jelly
      </a>

      {/* Hero */}
      <header className="mt-8">
        <div className="flex items-center gap-3">
          <JellyBeanIcon size={52} />
          <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">About jelly</h1>
        </div>
        <p className="mt-5 text-lg leading-relaxed text-zinc-600 dark:text-zinc-300">
          jelly ranks the restaurants, sights and places you've been by having you <b>compare</b> them, not{' '}
          <b>score</b> them. This page explains why, and how the math works, with live demos running jelly's real
          ranking code.
        </p>
        <nav className="mt-6 flex flex-wrap gap-1.5" aria-label="Sections">
          {TOC.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-600 hover:border-jade-400 hover:text-jade-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-jade-300"
            >
              {t.label}
            </a>
          ))}
        </nav>
      </header>

      <Section id="premise" eyebrow="The premise" title="People are bad at scoring and good at choosing">
        <p>
          Ask someone to rate last night's dinner from 1 to 10 and the number depends on their mood, what they ate last
          week, and how generous they feel. Ask whether it was better than their favourite taco place and they'll
          answer instantly and stick to it. That's why every review site drifts toward 4.3 stars: the scores stop
          meaning anything.
        </p>
        <p>
          Ranking by side-by-side comparisons fixes that. Doing it well, though, means avoiding a few traps.
        </p>

        <h3 className="pt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">Trap 1: rigid buckets</h3>
        <p>
          A common approach is to first make you sort a place into <i>bad</i>, <i>okay</i> or <i>good</i>, give each
          bucket a fixed score range (say good = 6.7–10), and only then compare it with the rest of that bucket. Koren
          (Ofek's brother) spotted the contradiction: the premise is that people are bad at scoring, yet the very
          first step asks them to score, and a place can never leave its bucket no matter how the comparisons go.
        </p>
        <p>
          The bottom of “good” is probably better than the top of “okay”. That's the whole premise. In jelly, the
          comparisons are the source of truth for the order, and nothing ever overrules them.
        </p>

        <h3 className="pt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">Trap 2: not enough granularity</h3>
        <p>
          Fixed buckets also flatten very different lists into the same shape. Picture two people who each call six
          places “good”:
        </p>
        <BucketsDemo />
        <p>
          This hurts most when you've only ranked a handful of places, and most people in any app have only ranked a
          handful. It never fully goes away, either.
        </p>

        <h3 className="pt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">Trap 3: apples vs. espresso</h3>
        <p>
          A great espresso bar and a great steakhouse shouldn't compete for the same spot. jelly keeps a separate,
          independently ranked list for each kind of place, in three groups:
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.key} className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
              <div className="font-display text-sm font-bold text-zinc-900 dark:text-zinc-100">{g.name}</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {GROUP_CATEGORIES[g.key].map((c) => (
                  <span key={c} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11.5px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {CATEGORY_EMOJI[c]} {CATEGORY_LABEL[c]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p>
          Ranks, scores, comparisons and friends' averages never cross lists. The same place can still show up in
          more than one, like a café in both Coffee & Tea and Brunch, ranked separately in each.
        </p>

        <h3 className="pt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">Trap 4: one person's 7 is another's 9</h3>
        <p>
          Some people never give out anything above an 8; others hand out 9s freely. Averaging their raw numbers mixes
          two different scales. jelly compares people relative to their own scale (more on that{' '}
          <A href="#friends">below</A>).
        </p>
      </Section>

      <Section id="how" eyebrow="The method" title="Three steps, one source of truth">
        <div className="grid gap-2 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="relative rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-jade-100 text-jade-700 dark:bg-jade-900/70 dark:text-jade-300">
                  <s.icon className="h-4 w-4" />
                </span>
                <span className="text-[11px] font-bold text-zinc-400">STEP {i + 1}</span>
              </div>
              <div className="mt-2 font-display font-bold text-zinc-900 dark:text-zinc-100">{s.title}</div>
              <div className="mt-1 text-[13.5px] leading-snug">{s.body}</div>
              {i < STEPS.length - 1 && (
                <ArrowRight className="absolute -right-3.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 text-zinc-300 dark:text-zinc-600 sm:block" />
              )}
            </div>
          ))}
        </div>
        <Callout>
          Comparisons decide the <span className="text-jade-600 dark:text-jade-400">order</span>. Gut feelings decide
          how that order maps to <span className="text-jade-600 dark:text-jade-400">numbers</span>.
        </Callout>
      </Section>

      <Section id="gut" eyebrow="Step 1" title="A gut feeling, not a score">
        <p>
          When you add a place, jelly asks one rough question: how did it feel? You answer on a spectrum of five
          tiers, Skip, Mid, Good, Great and Incredible, each with words instead of digits. It doesn't need to be
          precise. Its main job is to tell the side-by-side search where to start looking.
        </p>
        <SpectrumDemo />
        <p>
          The bar isn't a straight 1–10 line: each tier's width matches how often people actually feel that way. We
          looked at about 12 million ratings from people logging everything they tried (MovieLens and Letterboxd for
          films, BeerAdvocate for beer), matched their star levels to jelly's words, and sized the tiers to fit.
          “Really liked it” and “Great” come up most, so Good and Great get the most room. Incredible is rare, so it
          gets the least. A plain 1–10 line would hand a third of the bar to Skip.
        </p>
        <p>
          The labels are deliberately <b>calibrated low</b>. “Loved it” sits near the Great/Incredible boundary, and
          “Flawless · Literally nothing could be improved” is reserved for 9.8 and up. Every scale gets inflated over
          time; starting the words low pushes you to use the whole range.
        </p>
        <Nerd>
          <p>
            Each tier's share of the bar is <Tex>{String.raw`\tfrac34`}</Tex> how often people feel that way plus{' '}
            <Tex>{String.raw`\tfrac14`}</Tex> its share of a plain 1–10 line, so even rare tiers stay easy to tap:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-[12.5px] tabular-nums">
              <thead>
                <tr className="text-[11px] text-zinc-400">
                  <th />
                  {RATING_TIERS.map((t) => (
                    <th key={t.name} className={`px-0.5 pb-1 font-semibold ${t.zoneClass}`}>
                      {t.name === 'Incredible' ? 'Incred.' : t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SHARE_ROWS.map((row) => (
                  <tr key={row.label} className={row.bold ? 'font-bold text-zinc-900 dark:text-zinc-100' : ''}>
                    <td className="py-0.5 pr-2 text-left">{row.label}</td>
                    {row.values.map((v, i) => (
                      <td key={i} className="px-0.5">
                        {v}%
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Within a tier, the bar is a straight line between the tier's start and end ratings. That puts 5.0 in the
            middle of Mid, and gives the Great tier (1.3 points of rating) more than a quarter of the bar. Prefer a
            straight line? Settings has a linear-scale switch.
          </p>
        </Nerd>
      </Section>

      <Section id="sxs" eyebrow="Step 2" title="Side-by-side: binary search with a belief">
        <p>
          A list of <Tex>n</Tex> places has <Tex>n+1</Tex> gaps, and the new place belongs in one of them. jelly keeps a
          probability for every gap. Your gut feeling sets the starting guess (gaps next to places with similar scores
          get more weight), and each question is asked at the <b>median</b> of the current belief, the comparison that
          splits the remaining probability in half. Every answer rules out one side, so the search homes in fast.
        </p>
        <SxSDemo />
        <p>A few details make the questions easier to answer and the result more trustworthy:</p>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-jade-500">
          <li>
            <b>Like vs. like.</b> “Is this ramen better than that ramen?” is easier than ramen vs. barbecue. When it
            can, jelly picks an opponent with the same cuisine (or museum type, or country), and before finishing it
            checks the nearest same-cuisine place above and below, using up to two extra questions.
          </li>
          <li>
            <b>Ties and skips.</b> “About the same” settles it in the gap next to that place; “can't compare” just
            tries someone else.
          </li>
          <li>
            <b>Few questions.</b> jelly asks <Tex>{String.raw`\min\bigl(5,\ \lceil \log_2(n+1) \rceil\bigr)`}</Tex>{' '}
            questions and stops early once one gap holds two-thirds of the probability. Up to 31 places that's a full
            binary search. Beyond that it lands within a few spots, and you can always drag to fine-tune.
          </li>
        </ul>
        <Nerd>
          <p>
            <b>Starting belief.</b> Each gap <Tex>k</Tex> has a reference score <Tex>m_k</Tex> (the average of its two
            neighbours; past either end, 0.35 beyond the end score). With gut rating <Tex>g</Tex>:
          </p>
          <Tex block>{String.raw`w_k \;\propto\; \exp\!\left(-\frac{(g - m_k)^2}{2\sigma^2}\right) + 0.03`}</Tex>
          <p>
            with <Tex>\sigma = 1.5</Tex>. The small floor of 0.03 means no gap is ever ruled out by your gut alone. <b>After each answer</b>, gaps that
            agree with it are multiplied by 0.92 and the rest by 0.05, and a hard window of still-possible gaps shrinks.
          </p>
          <p>
            <b>Elo.</b> Alongside the belief, jelly tracks an Elo rating, the system chess uses. The expected chance that
            the new place <Tex>c</Tex> beats opponent <Tex>o</Tex>, and the update after the real result{' '}
            <Tex>{String.raw`S \in \{1, \tfrac12, 0\}`}</Tex>:
          </p>
          <Tex block>{String.raw`E = \frac{1}{1 + 10^{(R_o - R_c)/400}}`}</Tex>
          <Tex block>{String.raw`R_c \leftarrow R_c + \underbrace{64}_{K_c}\,(S - E)`}</Tex>
          <Tex block>{String.raw`R_o \leftarrow R_o - \underbrace{14}_{K_o}\,(S - E)`}</Tex>
          <p>
            The newcomer moves fast (<Tex>K = 64</Tex>) while established places only get a gentle nudge{' '}
            <span className="whitespace-nowrap">
              (<Tex>K = 14</Tex>).
            </span> A starting Elo comes from the gut rating, <Tex>R = 950 + 100g</Tex>, averaged with the
            Elo of the place whose score is closest. Elo is also clamped so it can't contradict a won or lost
            comparison.
          </p>
        </Nerd>
      </Section>

      <Section id="score" eyebrow="Step 3" title="From order to score">
        <p>
          Once everything is in order, jelly turns positions into the 1–10 scores you see. The order is fixed; only the
          numbers are being decided. Three ideas do the work:
        </p>
        <ol className="list-decimal space-y-1.5 pl-5 marker:font-bold marker:text-jade-600">
          <li>
            <b>Your scale, your level.</b> The spread of Elo ratings is mapped onto the average and spread of your own
            gut ratings. If everything you've ranked felt like a 9, your list lives in the 9s; that's how Alex and Sam
            end up in different places above.
          </li>
          <li>
            <b>A little of each gut feeling.</b> 15% of each score comes from that place's own gut rating, so a list of
            places that all felt amazing doesn't get stretched down to 5.
          </li>
          <li>
            <b>Never against the order.</b> A final pass makes sure scores only go down the list. If a place you
            rated 8.0 lost to one you rated 7.5, they meet in the middle rather than contradicting your choice.
          </li>
        </ol>
        <ScoreDemo />
        <Nerd>
          <p>
            For place <Tex>k</Tex> with Elo <Tex>E_k</Tex> and gut rating <Tex>g_k</Tex>, with <Tex>\mu</Tex>,{' '}
            <Tex>\sigma</Tex> the mean and spread across the list (floored at 85 Elo and 0.65 points):
          </p>
          <Tex block>{String.raw`\underbrace{c_k = \mu_g + \frac{E_k - \mu_E}{\sigma_E}\,\sigma_g}_{\text{calibrated to you}}`}</Tex>
          <Tex block>{String.raw`\underbrace{a_k = \frac{E_k - 950}{100}}_{\text{absolute anchor}}`}</Tex>
          <Tex block>{String.raw`s_k = 0.85\,\bigl(0.6\,c_k + 0.4\,a_k\bigr) + 0.15\,g_k`}</Tex>
          <p>
            Then <b>isotonic regression</b> finds the closest scores that never increase down the list:
          </p>
          <Tex block>{String.raw`\hat s = \arg\min_{\hat s_1 \,\ge\, \hat s_2 \,\ge\, \cdots \,\ge\, \hat s_n} \sum_k \bigl(\hat s_k - s_k\bigr)^2`}</Tex>
          <p>
            It's solved with <i>pool adjacent violators</i>: walk down the list, and whenever two neighbours are out of
            order, replace them with their average and keep going. The same pass first cleans up the Elo ratings
            themselves (with a minimum gap of 12 between neighbours), so a drag-to-reorder is respected all the way down.
          </p>
        </Nerd>
      </Section>

      <Section id="friends" eyebrow="Friends" title="Taste match and predictions">
        <p>
          Follow friends and jelly can tell you how much your taste overlaps, and guess how much you'd like a place
          they've been to. Both depend on comparing people on their <b>own</b> scale: a tough grader's 7.6 can mean
          the same thing as your 9.4.
        </p>
        <p>Taste match blends three views of the places you've both ranked:</p>
        <ul className="list-disc space-y-1.5 pl-5 marker:text-jade-500">
          <li>
            <b>Pearson correlation</b>: when your scores go up, do theirs? It ignores scale entirely.
          </li>
          <li>
            <b>Kendall's tau</b>: take every pair of places. Do you both put them in the same order?
          </li>
          <li>
            <b>z-agreement</b>: how close you are once each score is expressed as “how far above my usual”. It still
            works with just one or two places in common.
          </li>
        </ul>
        <p>
          Then a dose of humility: with few places in common, the result gets pulled toward a neutral starting point.
          One shared favourite shouldn't make anyone your taste twin.
        </p>
        <TasteDemo />
        <p>
          The guess works the same way: jelly asks how far above <i>their</i> usual each friend rated the place, averages
          that (trusting closer palates more), and translates it back onto <i>your</i> scale. When there's little to
          go on, it leans on how you've rated similar cuisines. Eat Together uses these guesses to sort “friends' top
          picks you haven't tried”, next to the places you all want to try and the favourites you share.
        </p>
        <Nerd>
          <p>With <Tex>n</Tex> places in common:</p>
          <Tex block>{String.raw`\text{sim}_{\text{raw}} = 0.5\,r + 0.35\,\tau + 0.15\,z`}</Tex>
          <Tex block>{String.raw`\text{sim} = \frac{n}{n+3}\,\text{sim}_{\text{raw}} + \frac{3}{n+3}\cdot 0.15`}</Tex>
          <p>
            The displayed match is <Tex>{String.raw`68 + 30\,(0.65\,\text{sim}_{\text{raw}} + 0.35\,z)`}</Tex>, kept
            between 35% and 99%. For a place you haven't been, each rater <Tex>u</Tex> with similarity{' '}
            <Tex>{String.raw`\text{sim}_u > 0`}</Tex> contributes their standardised score, and the result is mapped
            onto your mean and spread (Resnick's collaborative filtering):
          </p>
          <Tex block>{String.raw`z_u = \frac{s_u - \mu_u}{\sigma_u}`}</Tex>
          <Tex block>{String.raw`\hat s_{\text{you}} = \mu_{\text{you}} + \sigma_{\text{you}}\,\frac{\sum_u w_u z_u}{\sum_u w_u}`}</Tex>
          <Tex block>{String.raw`w_u = \text{sim}_u \times \begin{cases} 1.35 & \text{friend you follow} \\ 1 & \text{otherwise} \end{cases}`}</Tex>
          <p>
            That's blended with your personal prior (your average, nudged by how you rate the same cuisine) with weight{' '}
            <Tex>{String.raw`\alpha = \tfrac{W}{W + 0.35}`}</Tex>, where <Tex>{String.raw`W = \sum_u w_u`}</Tex>: the more
            evidence from other people, the less the prior matters. Cuisine nudges are damped the same way,{' '}
            <Tex>{String.raw`\tfrac{n_c}{n_c + 2}`}</Tex>, so one great sushi dinner doesn't decide every sushi place.
          </p>
        </Nerd>
      </Section>

      <Section id="name" eyebrow="The name" title="Why “jelly”?">
        <p>
          Two reasons. Ofek's favourite candy is Jelly Belly, and he loved visiting the factory to pick up Belly Flops,
          the oddly shaped beans that didn't make the cut. Hence the beans in the logo.
        </p>
        <p>
          And Jelly was the family cat. She passed away recently, and this app carries her name in her memory.
        </p>
      </Section>

      <Section id="us" eyebrow="Who we are" title="The people behind it">
        <p>
          jelly is built by <A href="https://ofek.phd">Ofek Gila</A>, with plenty of input from{' '}
          <b>Nicole</b>, his wife and a big foodie, and <b>Koren</b>, his brother, whose critique of rigid buckets
          shaped jelly's premise. It's a small, personal project for
          people who like keeping track of where they've been and what was worth it.
        </p>
      </Section>

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-6 text-sm dark:border-zinc-800">
        <a
          href="/"
          className="inline-flex items-center gap-2 rounded-full bg-jade-600 px-4 py-2 font-semibold text-white hover:bg-jade-700 dark:bg-jade-500 dark:text-jade-950"
        >
          <JellyBeanIcon size={18} /> Open jelly
        </a>
        <a href="/privacy.html" className="text-zinc-400 underline hover:text-zinc-600 dark:hover:text-zinc-300">
          Privacy
        </a>
      </footer>
    </main>
  </div>
);
