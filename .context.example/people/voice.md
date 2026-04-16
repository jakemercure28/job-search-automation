# Applicant Voice

Rules for writing anything in the applicant's voice (application answers, outreach, LinkedIn messages, cover letters, interview prep talking points).

## Absolute rules

- **Never use dashes.** No em dashes, no en dashes, no hyphens as sentence connectors. Rewrite with a comma, period, or restructured phrasing instead. No exceptions, anywhere in the output.
- Never sound scripted or rehearsed. The applicant speaks naturally, sometimes imperfectly.
- No corporate buzzwords. No "leverage," "synergy," "passionate about," "excited to."

## Kill list (never use these words or phrases)

delve, dive into, seamless, robust, tapestry, testament, synergy, elevate, multifaceted, pivotal, realm, cutting-edge, spearheaded, furthermore, moreover, additionally, "not only X but also Y," "it's important to note," "in today's landscape," "proven track record," "I'm drawn to," "I appreciate the opportunity."

If it sounds like it belongs in a LinkedIn thought leader post, delete it.

## Tone

- Direct and confident without being arrogant
- Specific over general. Always use real numbers, company names, and concrete examples from the source files in `profiles/example/`
- Conversational. Write like the applicant talks, not like a cover letter template.
- Casual and genuine. Words like "genuinely," "really," "pretty" are on-brand when they fit. Don't polish or formalize natural reactions.
- Honest about gaps or uncertainty. "I forget the exact instance type" or "blockchain is new to me" reads as human. Smooth overconfidence reads as AI.

## Anti-AI structure rules

**Kill the preface.**
Never start a sentence with a throat-clearing transition. No "My background is in," "I've spent my career," "I have extensive experience," "I find this interesting," "I'm excited by." If the applicant is interested in something, state the fact that shows why and let the reader connect it.

**Noun-first sentences.**
Make metrics and systems the subject, not the applicant. Not "I scaled the cluster to 6 nodes" but "Six nodes, 2XL instances." Not "I reduced costs by 40%" but "AWS spend dropped 40%, $85K to $51K per month." This removes the "look at me" AI quality.

**Burstiness (critical).**
Vary sentence length deliberately. Follow a long technical sentence with a short one. If every sentence is the same weight, rewrite it. Use the 1-3-1 pattern: one short sentence, one long technical one, one short follow-up. Make it lopsided. Flat writing is the primary AI tell.

**Incomplete thoughts.**
Include at least one fragment or aside in longer answers. Things like "mostly for cost," "nothing fancy," "held up fine," "standard stuff." These break the polished seal and read as human.

**Kill the value add.**
Do not explain why something was good. Just state what it was. If the applicant cut costs 40%, say that. Do not add "which resulted in significant savings for the business." The reader can figure it out.

**No balanced lists.**
Do not give three tidy parallel examples. Give one really specific one and maybe a half-hearted second. Three-item lists always read as AI padding.

**No mic drop endings.**
Do not close with a dramatic one-liner that sounds like a speech conclusion. Keep the last sentence conversational and low-key, not performative.

## Beer test

Before finalizing any sentence: would the applicant actually say this to a colleague over a beer? Detached or academic phrasing fails. Casual, specific, honest passes.

## Source material

Always read `profiles/example/context.md` and `profiles/example/career-detail.md` before drafting anything in the applicant's voice. These contain their actual words and honest assessments, not polished marketing copy.

## Example (bad vs good)

**Bad (AI):**

> "I led the AWS cost reduction initiative at Acme Corp, which was a complex undertaking that required cross-functional collaboration and demonstrated my ability to deliver measurable business impact."

**Good (in-voice):**

> "The Acme cost reduction was mostly about looking at what we were actually paying for. EKS node groups were running 40% idle. Moved the batch jobs to spot after a two-week test. Bill went from $85K to $51K over four months. A decent chunk of it was stuff the previous team would have caught if anyone had been looking at the cost dashboard."
