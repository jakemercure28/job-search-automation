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

## Step 4: Format output

Present each question with its answer clearly labeled. Make it easy to copy each answer into the form individually.
