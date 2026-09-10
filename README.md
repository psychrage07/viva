# Viva

**The best way to understand something? Teach it.** Viva reverses the usual AI-tutor relationship: you explain a concept to a curious AI student, answer a few carefully selected questions, and watch that student take an exam using a reconstruction of your own understanding. Its mistakes are deterministic predictions from an authored misconception bank—not AI hallucinations. In 30 seconds: explain a tossed ball → watch belief probabilities collapse → meet your student → add one missing idea → compare its simulated re-sit. Speak or type; no account required.

## A window into understanding

![The live posterior chart during a real browser-tested session](public/screenshots/posterior-after.png)

The chart animates bar widths, ranks, and entropy on every answer. See the interactive zero-call demo on the landing page. [Before the update](public/screenshots/posterior-before.png) · [Landing page](public/screenshots/landing.png) · [Repair screen](public/screenshots/repair.png)

## Quickstart

Node.js 22+ recommended.

```bash
npm install
cp .env.example .env.local
```

For live Gemini, set these values in `.env.local` beside `package.json`:

```dotenv
GEMINI_API_KEY=your-own-key
DEMO_MODE=0
```

Then run:

```bash
npm run dev
```

Open http://localhost:3000. Optional `GEMINI_MODEL` overrides the centralized Flash-Lite default.

**Offline:** set `DEMO_MODE=1` in `.env.local`, or run `DEMO_MODE=1 npm run dev`. No API key or Gemini network calls. Use “Try an example” or `/session?demo=1` for the authored demo fixture. Other inputs gracefully use unknown-coverage/template fallbacks. The entire deterministic session still works. The included `.env.local` in this sandbox enables offline mode; environment files are ignored and must be recreated in a clean clone.

**Voice:** click “Use your voice,” grant microphone permission, speak, then stop and review the editable transcript. Recognition is browser-dependent (Chrome/Edge recommended), may use the vendor's online speech service, and requires localhost or HTTPS. It is not guaranteed to work offline. Text is always available. Read-aloud buttons use browser speech synthesis.

No application database, migrations, auth, or signup. Session state is in React and schema-validated `sessionStorage`. The inherited platform PostgreSQL files are unused by Viva except an optional health check when DATABASE_URL is supplied.

## Architecture: the model controls style, code controls substance

```text
Browser: explanation (typed or dictated)
        │
        ▼
/api/coverage ─── Gemini, structured JSON + zod ─── concept coverage
        │                                             │
        └─────────────────────────────────────────────▼
                                        PURE TYPESCRIPT ENGINE
                                        weak prior over 12 beliefs + SOUND
                                        Bayesian update in log space
                                        EIG selects next unasked probe
                                        3–6 user responses in the UI
                                                     │
                                                     ▼
                                        MAP hypothesis + 4 unseen probes
                                        TABLE LOOKUP commits exam answers
                                                     │
/api/student-voice ─── ONE batched Gemini call ────────┤ approved wording only
/api/repair ────────── ONE Gemini call ────────────────┤ diagnosis + authored repair
                                                     ▼
                                        Reveal → deterministic intervention
                                        counterfactual / sentence inclusion
                                        same four questions re-sat locally
                                                     │
                                                     ▼
                                        URL-encoded unverified result card
```

`src/lib/engine` imports only itself—no React, pack files, Node built-ins, or network. It runs in browser, Vitest, and tsx. All model calls are server-side. SDK: `@google/genai`, stable `models.generateContent`, `config.responseMimeType` + `config.responseSchema`. Model responses are zod-validated; voice is additionally constrained to approved wording consistent with the committed choices.

Three **logical** calls per complete session. Healthy uncached sessions make three physical attempts; demos/cache hits make zero; bounded validation/transport retries can make more (maximum nine total). An instance-local SHA-256 LRU and request coalescing avoid duplicate calls. Per-IP instance-local token bucket limits quota abuse. These are not globally durable serverless controls. See `DECISIONS.md` for limits and the SDK definitions inspected.

## Benchmark tables

<!-- BENCHMARK_TABLES -->

## Engine benchmark

Seed: 74021. 2,000 uniformly sampled ground-truth hypotheses per slip level; 13 hypotheses, 28 original items. Each paired trial uses the same truth, with separate reproducible answer/selection streams. Stopping: MAP ≥ 90% or 6 questions. Likelihood and simulator use the same slip. These are **in-model simulations, not learner validation**.

Capped counts include unsuccessful trials at six. Target-only counts exclude trials that did not reach 90%; the reach column prevents hiding this censoring.

| Slip | Selection | Mean capped | Median capped | Mean to target (reached only) | Median to target | Reached target | Recovery |
|---|---|---:|---:|---:|---:|---:|---:|
| 0.05 | Active | 2.88 | 3 | 2.87 | 3 | 99.9% | 96.2% |
| 0.05 | Random | 4.54 | 5 | 3.84 | 4 | 67.5% | 74.7% |
| 0.12 | Active | 3.51 | 3 | 3.34 | 3 | 93.8% | 93.3% |
| 0.12 | Random | 5.32 | 6 | 4.39 | 5 | 42.0% | 69.2% |
| 0.25 | Active | 4.48 | 4.5 | 3.93 | 4 | 73.4% | 86.0% |
| 0.25 | Random | 5.68 | 6 | 4.60 | 5 | 22.6% | 60.0% |

### Calibration

Buckets group final MAP probabilities, including runs stopped at the cap. Empty buckets are omitted.

| Slip | Selection | Confidence bucket | n | Mean stated confidence | Empirical accuracy |
|---|---|---|---:|---:|---:|
| 0.05 | Active | 0–50% | 3 | 27.1% | 33.3% |
| 0.05 | Active | 90–95% | 636 | 93.2% | 94.0% |
| 0.05 | Active | 95–100% | 1361 | 97.8% | 97.3% |
| 0.05 | Random | 0–50% | 641 | 34.0% | 33.2% |
| 0.05 | Random | 50–70% | 3 | 54.5% | 100.0% |
| 0.05 | Random | 80–90% | 6 | 89.1% | 100.0% |
| 0.05 | Random | 90–95% | 850 | 92.0% | 91.5% |
| 0.05 | Random | 95–100% | 500 | 98.2% | 98.8% |
| 0.12 | Active | 0–50% | 73 | 39.3% | 35.6% |
| 0.12 | Active | 80–90% | 51 | 84.1% | 82.4% |
| 0.12 | Active | 90–95% | 736 | 91.5% | 91.8% |
| 0.12 | Active | 95–100% | 1140 | 97.8% | 98.3% |
| 0.12 | Random | 0–50% | 717 | 32.4% | 31.7% |
| 0.12 | Random | 50–70% | 34 | 52.4% | 44.1% |
| 0.12 | Random | 70–80% | 38 | 78.0% | 84.2% |
| 0.12 | Random | 80–90% | 370 | 85.2% | 83.5% |
| 0.12 | Random | 90–95% | 300 | 92.0% | 90.7% |
| 0.12 | Random | 95–100% | 541 | 97.8% | 97.6% |
| 0.25 | Active | 0–50% | 225 | 31.9% | 30.2% |
| 0.25 | Active | 50–70% | 84 | 65.3% | 61.9% |
| 0.25 | Active | 70–80% | 63 | 74.6% | 84.1% |
| 0.25 | Active | 80–90% | 161 | 86.5% | 87.0% |
| 0.25 | Active | 90–95% | 533 | 92.9% | 92.9% |
| 0.25 | Active | 95–100% | 934 | 97.7% | 97.5% |
| 0.25 | Random | 0–50% | 829 | 30.3% | 28.5% |
| 0.25 | Random | 50–70% | 280 | 64.0% | 67.9% |
| 0.25 | Random | 70–80% | 263 | 74.3% | 73.4% |
| 0.25 | Random | 80–90% | 177 | 85.6% | 83.6% |
| 0.25 | Random | 90–95% | 264 | 92.6% | 94.7% |
| 0.25 | Random | 95–100% | 187 | 96.8% | 97.3% |

### Interpretation and limits

Active-minus-random recovery gaps at slip 0.05, 0.12, and 0.25: 21.5 percentage points, 24.1 percentage points, 26.0 percentage points. The pack was not tuned after this benchmark. Its authored prediction matrix and single-dominant-belief assumption are not validated psychometrics. Transfer items are selected to expose the inferred belief, so the four-item score is not a general physics grade. Calibration here assumes the data-generating model is correct; real people can hold multiple beliefs, guess strategically, or change their minds.

## Coverage evaluation

Provenance: **deterministic-fallback; NOT Gemini responses; API key unavailable**. Model: not run. 0/60 outputs came from Gemini. **Gemini reliability is NOT measured.** The table below measures only the committed outputs, including deterministic unknown fallbacks. Do not interpret it as model performance. No API key was available during this build.

Gold set: 20 authored explanations (10 sound; 10 each omitting a distinct concept), three runs each. These templated gold texts are an easy, narrow evaluation; diverse natural learner explanations are still needed. Covered is the positive class; partial/missing/unknown are negative. Precision is n/a when there are no predicted positives. Consistency is the fraction of examples with the same label on all three runs.

| Concept | Precision (covered) | Recall (covered) | 3-run consistency |
|---|---:|---:|---:|
| Force changes velocity | n/a (no positives) | 0.0% | 100.0% |
| Motion needs no fuel | n/a (no positives) | 0.0% | 100.0% |
| A push is an interaction | n/a (no positives) | 0.0% | 100.0% |
| Mass does not set falling speed | n/a (no positives) | 0.0% | 100.0% |
| Equal and opposite forces | n/a (no positives) | 0.0% | 100.0% |
| Turning takes inward force | n/a (no positives) | 0.0% | 100.0% |
| Surfaces exert forces | n/a (no positives) | 0.0% | 100.0% |
| Gravity needs no air | n/a (no positives) | 0.0% | 100.0% |
| Acceleration can oppose motion | n/a (no positives) | 0.0% | 100.0% |
| Friction opposes slipping | n/a (no positives) | 0.0% | 100.0% |

Reproduce without network: `npm run eval:coverage`. Collect real model outputs: `npm run eval:coverage -- --live` (60 logical calls; retries may add attempts). Live runs bypass cache; replay is the default. Unknown fallbacks can be perfectly self-consistent while conveying no information: consistency is not accuracy.

<!-- /BENCHMARK_TABLES -->

## Intellectual lineage

Viva builds on **diagnostic modelling of procedural bugs** (Brown & Burton's BUGGY, 1978), **teachable agents and the protégé effect** (Betty's Brain, Vanderbilt; Chase et al., 2009), and **concept inventories as validated distractor banks** (Hestenes, Wells & Swackhamer's Force Concept Inventory, 1992).

The contribution here is the **combination**: using Bayesian misconception inference to drive a teachable agent, so the agent's failures are diagnostic rather than arbitrary. The topic's misconception families draw on Halloun & Hestenes (1985), McCloskey (1983), Minstrell (1982), Trowbridge & McDermott (1981), and Besson et al. (2007). Citations are included per belief in the pack. These sources support broad belief categories, not empirical validation of our individual prediction maps.

**FCI items were not reproduced.** All 28 probes are original authored questions in a similar conceptual style. This is not the FCI and is not a validated concept inventory.

## Limitations

- One topic: Newtonian force and motion. Twelve hand-authored belief families are neither exhaustive nor psychometrically validated.
- Single dominant belief assumption; real learners can hold multiple contradictory beliefs, guess, or change beliefs mid-session.
- Synthetic benchmark data follows the same likelihood model as inference. Excellent in-model calibration is not evidence of real-world diagnostic validity.
- **Coverage classification is the weakest link. Live reliability: unmeasured in this build.** No API key was configured. Shipped outputs are explicitly marked deterministic unknown fallbacks; precision is undefined, covered-concept recall 0%, consistency 100%. They are not presented as Gemini performance. A 60-call live evaluation script is supplied.
- The gold explanations are templated, with reordered sound statements and one-concept omissions. A diverse natural-language evaluation is still needed.
- Starter DEMO_MODE fixtures are authored, not recorded Gemini outputs. `record:fixtures` can replace them with actual live recordings when a key is available.
- Voice phrasing is deliberately constrained: the model chooses approved wording rather than inventing unconstrained reasoning. This gives a strong answer-consistency guarantee at the cost of expressive nuance.
- Repair checks explicit inclusion of the authored sentence; it does not semantically certify arbitrary paraphrases. This keeps the three-call budget. The counterfactual/re-sit assumes the repair replaces the attached belief; it is not a fresh diagnosis or measured learning gain.
- The transfer exam prioritizes unseen items affected by the diagnosis, so its score is not an unbiased general physics grade.
- **No evidence of long-term learning gains.** This is a diagnostic interaction prototype, not an efficacy claim.
- Session storage can be cleared or unavailable. Shared cards are editable URL state, not authenticated grades. Never share sensitive information in an explanation.

## Commands and reproducibility

```bash
npm run lint:pack       # structural validity + sorted uniform-prior information gain
npm test               # analytic, synthetic, integration, semantic-safety, repair tests
npm run benchmark      # 2,000 trials × 3 slip levels × 2 policies; seeded, no network
npm run eval:coverage  # reads 60 committed raw outputs; no network
npm run eval:coverage -- --live  # 60 logical Gemini calls; actual data saved with provenance
npm run record:fixtures         # 3 live logical calls on the scripted example path
```

`benchmark` writes real tables and calibration to `BENCHMARK.md`, with raw trial data in `tests/fixtures/engine-results.json`. `eval:coverage` preserves that section and appends its measured table. Live evaluation bypasses caching. The fixture recorder refuses to overwrite the shipped fixtures if any call degrades. Rebuild after recording, because fixtures are bundled at build time. The `scripts/prepare-fixtures.ts` authoring utility **overwrites** starter fixtures; it is not part of normal install/build and should not be used after collecting live data.

The pack linter rejects indistinguishable hypotheses, missing/invalid predictions, fully uninformative probes, unknown concept references, and invalid choice IDs. Weakly informative (not zero-information) items are intentional.

To run the browser gate against an already running app:

```bash
npx playwright install --with-deps chromium
npx tsx scripts/ui-gate.ts
npx tsx scripts/ui-resilience.ts  # mocked dictation + blocked API connections on mobile
```

It exercises keyboard Teach → Probe, reveal, counterfactual, repair, session restore, sharing, and mobile overflow. Screenshots are saved under `public/screenshots`. It expects DEMO_MODE and the authored scripted path. `TEST_URL` can point it at a deployed build.

Production validation:

```bash
npx next typegen
npm exec tsc -- --noEmit --pretty false
npm run build
```

## Deployment

The app is ready for Vercel's standard Next.js deployment: import the repository, keep the detected Next.js build settings, and configure `DEMO_MODE=1` for a replay deployment or `GEMINI_API_KEY` plus `DEMO_MODE=0` for live use. Do not expose the key with a `NEXT_PUBLIC_` prefix. No database variable is required. Browser speech recognition needs HTTPS or localhost.

**Vercel URL: not deployed from this workspace.** No Vercel account/token/project was available. Deployment and live fixture capture on Vercel are not claimed as completed acceptance criteria. The platform production preview is separately built, started, and health-checked.

To record after deploying, use `TEST_URL` for the browser gate. The fixture recorder runs locally against Gemini, writes replay artifacts, then those artifacts must be committed and redeployed. Do not run the live 60-call evaluation repeatedly on a small free-tier budget.

## Privacy, operating budget, and design

- Only the transcript is sent to Viva. Optional dictation may send audio to the browser's recognition provider. Speech data handling depends on that provider.
- Live explanations are sent from the server to Gemini. Do not enter sensitive personal information. In-memory cache entries are bounded, ephemeral, and may persist for the lifetime of an instance.
- Server logs count requests without logging explanation text or keys.
- Local storage saves no audio, only this tab's structured session. Sharing includes diagnosis IDs and scores, not your explanation.
- The visual direction is inspired by Bobbin's warm educational editorial feel. Viva's branding, SVG mascot, and illustrations are original. Local DM Sans / DM Serif Display typefaces are open licensed.
- Runtime is Next.js 16.3.4 (updated from the starter's vulnerable version), not the requested 15. See `DECISIONS.md` for this and the exact prior-floor, minimum-question, and repair-intervention choices.
