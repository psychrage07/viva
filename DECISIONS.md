# Viva — decisions and acceptance status

## Product and visual direction
- A warm editorial interpretation of withbobbin.com: cream, forest green, lilac, muted yellow, generous whitespace, rounded lesson cards and original SVG illustrations. No Bobbin branding, assets, proprietary typefaces, or testimonials copied.
- Locally served DM Sans and DM Serif Display (Google Fonts / SIL Open Font License). The mascot and decorative illustrations are original SVG code.
- The landing page includes a real, deterministic interactive posterior demo rather than an autoplay video. Its example percentages are an illustrative preview, not claimed measurements of the visitor.
- One topic pack, 10 concepts, 12 misconception families, 28 original items; no controlled FCI questions reproduced.
- Voice dictation and read-aloud are optional progressive enhancements using browser speech APIs. Recognition may require a browser vendor's network service. No microphone is requested automatically. Transcripts are visible and editable. Text and browser-local computation remain usable when voice is unsupported or permission is denied.

## Runtime and file layout
- Kept the project's App Router layout under `src/app`, with modules under `src/lib`, instead of moving to root directories.
- The supplied runtime was Next.js 16.2.6, not 15. Upgraded to the available patched 16.3.4 after the audit identified a critical advisory. Did not downgrade to an older major. TypeScript remains strict.
- Viva has no application database, authentication, or user accounts. All learning state is React state plus schema-validated sessionStorage. The inherited PostgreSQL/Drizzle files remain solely for platform compatibility. `/api/health` queries that database through Drizzle only when DATABASE_URL is supplied; a Vercel deployment does not require it.
- Retained the platform's package scripts and registered additional commands through npm tooling, not manual package.json edits.

## Model integration: checked against installed definitions
- Installed `@google/genai` **2.21.0**. Read `node_modules/@google/genai/dist/genai.d.ts`: `Models.generateContent(params: GenerateContentParameters)` is the stable method. `GenerateContentConfig` has `responseMimeType?: string` and `responseSchema?: SchemaUnion` (around lines 5640–5651). Used those exact properties with `application/json`. Did not use interactions or the superseded generative-ai SDK.
- The default Flash-Lite identifier and environment override are centralized in `src/lib/gemini/client.ts`. Model identity is not hardcoded in any other executable module.
- Exactly three logical model call sites: coverage, batched student voice, repair. No reclassification call after repair. Live evaluations intentionally bypass cache.
- The requirements 'exactly 3 calls' and 'retry malformed/rate-limited responses' cannot both describe physical network attempts under failure. Healthy uncached completion makes 3 attempts. Cached/demo completion makes 0. Each logical call has a maximum of 3 total attempts; validation gets at most one repair. Thus exceptional live sessions can exceed 3 physical attempts, never 9. The development counter logs every actual attempt, and tests assert three in a healthy mocked session.
- SHA-256 keys include pack, phase, canonicalized input. 256-entry in-memory LRU; concurrent equal inputs coalesce. Whitespace is normalized; case is preserved because it can carry meaning. Cache is instance-local and ephemeral on Vercel. Cross-region or cold-start runs are NOT guaranteed to hit it.
- Shared IP token bucket: 18 tokens, one token per 30 seconds. Bounded table with expiration and saturation rejection. Depleted requests return safe degraded JSON, not an exception page. In serverless deployments this is best-effort per-instance protection, not a global quota service. Forwarded-IP trust depends on the deployment proxy.
- Response/request size constraints, server-only key access, structured JSON schemas and zod validation, bounded retry/backoff with jitter, request timeout, and deterministic fallbacks.

## Safety of substance
- Engine modules import only each other. No React, Node built-ins, network, packs, or LLM in the engine. Dependency purity is tested.
- Every exam choice is a table lookup, not model text. The browser never uses a generated choice to score the exam. A test returns garbage from the mocked Gemini SDK and proves commitments remain unchanged.
- General semantic entailment of arbitrary learner prose cannot be reliably established with a string check. Therefore Gemini chooses between two approved, first-person reasoning phrasings per committed item. zod validates shape; a strict allowlist validates semantic commitments. Contradictory but schema-valid prose is rejected. This sacrifices expressive richness for a defensible guarantee. User explanation is supplied as context but no unrestricted quote can inject a contradictory answer.
- Repair wording must preserve the pack's concept ID and exact authored sentence. Only diagnosis prose can vary.
- An unknown classifier result does not justify saying 'you never said X'. Reveal uses uncertainty-sensitive annotation; coverage marked covered is framed as revisiting an idea rather than asserting an omission.

## Bayesian and pedagogical choices
- Likelihood exactly follows the specified slip mixture. Posterior updates are log-space and normalized. EIG is exact over choices; deterministic ID tie-breaks. Impossible observations at slip=0 preserve the prior rather than return NaN.
- The brief's clamp-to-.01-then-renormalize algorithm can yield final entries below .01. Used water-filling to guarantee the testable final lower bound, preserving proportional weights among unclamped hypotheses. A single missing concept raises attached misconceptions above other misconceptions; SOUND can remain most likely if all other concepts are covered, as prescribed by soundBias=1.5.
- Engine/benchmark stops immediately at the threshold or 6 questions. UI asks at least 3 for the requested 3–6 experience, then stops at .90 or 6. This difference is explicit rather than retroactively altering benchmark results.
- Choice IDs remain canonical in the pack; display order is deterministically shuffled. The displayed A/B/C/D position is not the persisted choice identity.
- Transfer set selects four unseen items prioritizing failures predicted by MAP, then ID. Scores therefore expose a belief, not representative topic achievement.
- Counterfactual is an explicit instructional intervention: mark the concept covered, rebuild the prior, retain only observations unrelated to that concept, and move probability on repaired attached beliefs to SOUND. This is more than passive coverage reweighting: it **assumes the repair replaces that belief**. Labeled as such in the UI. It is not an observed learning outcome.
- Repair uses exact normalized authored-sentence inclusion. A paraphrase is not falsely certified by keyword matching. User can use the supplied sentence and add their own prose. This avoids a fourth model call but is a clear limitation versus arbitrary semantic reclassification.
- Shared results encode version, hypothesis ID, before/after scores, and concept ID in the URL. zod validates bounded values; no raw explanation is shared. URL contents are editable and explicitly unverified.

## Measurement and provenance
- Pack linter gate passed before the engine and UI. It checks complete maps, valid references, distinct hypotheses (including SOUND), and zero-information items; prints uniform-prior EIG.
- The 500-student test measured 94% recovery at .12 slip, exceeding the unweakened .80 threshold. The full benchmark uses 2,000 trials at each of .05, .12, .25; both selection strategies; fixed seed; raw results committed as project artifacts. No pack changes were made to improve the table after seeing the benchmark.
- At .12 slip, the full benchmark measured 93.3% active vs 69.2% random recovery. Full calibration, reach/censoring details, and all three slip levels are in BENCHMARK.md.
- **No GEMINI_API_KEY was configured.** No live evaluation or response recording is claimed. Shipped demo fixtures are explicitly `recorded:false` and degraded; they are authored starter responses. `record:fixtures` refuses to claim fallback data as live.
- Coverage gold fixtures: 20 examples, 10 complete, 10 with one distinct omitted concept. Sound examples vary sentence order/framing, not semantic complexity; this is an easy and limited gold set. The 60 shipped raw outputs are actual deterministic all-unknown fallback outputs, not fabricated Gemini outputs. `eval:coverage` computes a table from them and prominently reports live coverage reliability as unmeasured. `--live` requires a key and writes all 60 results, retaining degraded provenance.
- The fully live coverage-evaluation acceptance item is **not satisfied** without an API key. The README and UI do not conceal this.

## Deployment and verification
- Vercel-ready App Router routes; add GEMINI_API_KEY and set DEMO_MODE=0 for live, or DEMO_MODE=1 for no Gemini network calls. No separate database provisioning for Viva.
- No Vercel account/token/project was available, so a Vercel deployment and deployed live fixture recording are **not claimed**. The platform production preview is built/started/health-checked independently.
- Browser gate covers keyboard teaching/probing, responsive no-overflow landing, reveal, what-if, repair, session restore, and URL result. Additional unit tests cover model faults, three-attempt bounds, exact normal request count, cache, pack purity, and offline replay.
- No evidence of lasting learning gains; single dominant belief; non-exhaustive authored bank; no individual prediction map psychometric validation. Citations support broad misconception families, not every authored response mapping.
- Dependency audit after compatible fixes: no high or critical findings; four moderate findings remain in the inherited Drizzle development-tool esbuild chain. No forced breaking downgrade was applied. Recheck the audit before deployment; advisories can change.
- The resilience browser test injects a speech-recognition stub to verify transcript UI behavior, then aborts every model-route request and completes the mobile flow using local fallbacks. This does not certify any real browser vendor's recognition accuracy or microphone behavior.
