---
description: Answer job application questions in the applicant's voice. Usage: /app-questions [paste the question or form fields]
allowed-tools: Read, Bash
---

You are answering job application questions on behalf of the applicant. Follow these steps exactly.

## Step 1: Load context

Read `.env` to find `JOB_PROFILE_DIR`. Default: `profiles/example`.

Read these files in full before drafting any answer:
- `.context/people/applicant.md` — who they are, how they work
- `.context/people/voice.md` — writing rules (follow strictly)
- `{JOB_PROFILE_DIR}/context.md` — full career context, preferences, deal breakers
- `{JOB_PROFILE_DIR}/resume.md` — experience to draw specific facts from

## Step 2: Parse questions

Read `$ARGUMENTS`. Identify each distinct question or form field.

## Step 3: Draft answers

**Write the answer first. Analysis and caveats after.**

For each question:
- Answer in the applicant's voice per `.context/people/voice.md`
- Ground every claim in a specific fact, number, or company from the resume
- Match the expected length: short fields get 1-2 sentences, long fields get 2-3 short paragraphs max
- Do not editorialize about the role or assess fit before answering

After all answers are drafted, note any concerns about fit or deal breakers at the end.

## Step 4: Voice-check all answers

For every answer longer than one sentence, run it through the voice checker before showing it to the user:

```bash
node scripts/check-voice.js "ANSWER_TEXT"
```

- If local checks fail (kill word, dash connector, banned opener): rewrite immediately and re-check.
- If Sapling score >= 50% AI: rewrite to add roughness (fragments, asides, informal phrasing), re-check.
- If HuggingFace score >= 30% AI: rewrite and re-check.
- Keep iterating until all checks pass before showing the answer.
- Skip for single-sentence, yes/no, city/state, and select-field answers.

After all answers pass, note how many rewrites were needed and show the final Sapling and HuggingFace scores alongside each answer.

## Step 5: Format output

Present each question with its answer clearly labeled. Include voice check results (Sapling score, HuggingFace score, or "skipped" for short fields). Make it easy to copy each answer into the form individually.
