# Globex — Backend Engineer

**June 2019 to March 2022**
**Remote (company HQ in New York)**

Fictional example file.

## Company context

Globex was a Series B fintech at ~80 engineers when I joined. Core product was a business-to-business payments API. Backend was mostly Python Flask with some Go services for the latency-sensitive paths.

## Scope of ownership

- Billing service (primary)
- Notifications pipeline
- Various cross-cutting backend work across 3 adjacent services
- Mentorship for two junior engineers

## Key projects

### Billing service rewrite

Inherited a Python Flask billing service with chronic latency issues, mostly from N+1 queries and no connection pooling. Rewrote in Go over three months. p99 latency dropped from 800ms to 90ms, measured over a week of production traffic post-rollout.

Kept the HTTP interface identical because the rewrite was meant to be invisible to upstream consumers. Did not attempt to clean up the response shape; that would have been a separate project.

### Kafka notifications pipeline

Shipped an event-driven notifications pipeline processing 400M events per day. Go consumer pool on top of Kafka Streams. Hot path was deliberately lean, enrichment happened in a secondary consumer group.

Biggest operational learning: underinvested in dead-letter queue tooling early. When we hit poison messages in month two, triage was slower than it should have been. Eventually built a proper DLQ viewer.

### Mentorship

Two junior engineers reported to me as a mentor (not a manager). Both promoted to mid-level during my tenure. Most of what I did was code review, architecture whiteboarding, and helping them scope their work into shippable pieces.

## Why I left

Globex was steady but the infrastructure side was staffed separately from backend, and I kept getting pulled toward infra problems outside my remit. Acme had a role that explicitly combined backend and platform work, which was the direction I wanted to grow.

## Honest assessment

Strong role for leveling up backend fluency. If you're curious about billing systems or event-driven pipelines, happy to go deeper.
