# Eval decisions

Model: gemma4:e4b-it-q4_K_M (Ollama), persona: recruiter. Rates are passes / runs.

## 2026-10-08

**Timeline facts (8000d88).** Gap mentioned at medium+: recent-gap 1/3 → 3/3, my-resume 1/3 → 3/3.
The model weighs gaps well; it couldn't do the date math. Code computes it, prompt states it.

**Date range inside the fact (331b6aa → kept).** Fixed the model quoting our fact as resume
text (recent-gap grounding 15/17 → 20/20).

**Typo "regression" — not real.** Typo looked like it fell from 3/3. Two hypotheses (heading
wording, facts section) tested and refuted; an identical-to-baseline prompt also scored 1/5.
Pooled: 7/19 (~37%). The baseline 3/3 was luck. Lesson: confirm a drop at the previous commit
before hunting a cause. Typo detection deferred to a dedicated proofreader persona (Phase 3).

**Summary not used as evidence (149813d).** my-resume 2/6 → 5/5; buzzword-summary still
criticizes its summary 5/5.

**One-clause timeline fact (31f68b7).** Duplicate gap issues 2/5 → 2/10; first verdict dip
(3/5) confirmed as noise over 10 runs (8/10).

## Baseline (<commit>)
<paste the summary block here>
