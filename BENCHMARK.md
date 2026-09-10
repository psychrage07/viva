# Viva — measured benchmarks

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
