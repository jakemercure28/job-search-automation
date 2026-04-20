---
description: Load context files at the start of a job-search session. Use when asked to "load context", "read context", "get up to speed", or at the start of any job-search or career-related session.
allowed-tools: Read, Bash
---

## Step 1: Find the active profile

Read `.env` to find `JOB_PROFILE_DIR`. Default: `profiles/example`.

## Step 2: Read context files

Read the following files in full and internalize them before responding:

1. `.context/people/applicant.md` — who the applicant is, working style, preferences
2. `.context/people/voice.md` — writing rules (critical for anything in the applicant's voice)
3. `.context/projects/job-search.md` — pipeline architecture and features
4. `.context/reference/dashboard-files.md` — file map for what to edit
5. `.context/decisions/architecture.md` — why things are built this way

Then read the active profile's context:

6. `{JOB_PROFILE_DIR}/context.md` — full career context, preferences, deal breakers
7. `{JOB_PROFILE_DIR}/career-detail.md` — deep project documentation

Confirm with one short line: what session context is loaded and you're ready.
