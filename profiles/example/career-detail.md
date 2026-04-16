# John Doe — Career Detail

Fictional example profile. This file supplements `resume.md` with the behind-the-scenes detail that doesn't fit on a resume: motivation, honest assessments, and the stories behind the metrics.

## Acme Corp — Senior Platform Engineer (March 2022 to present)

### Why I took the role

Acme was a Series C growth-stage company when I joined. Previous role at Globex had scaled me into solid backend fluency, but I wanted to get closer to infrastructure and own more of the production story. Acme was hiring for a hybrid "backend plus platform" role that matched what I was already drifting toward.

### The AWS cost reduction

Joined and inherited an EKS setup that had been running without right-sizing for two years. Some node groups were 40% idle. Migrated batch workloads to spot instances after a two-week test run on a non-critical pipeline. Rewrote a few chatty services to batch API calls rather than fire one request per row.

End state: $85K/month down to $51K/month. Took about four months of part-time work on top of my main project load.

Honest assessment: some of this was low-hanging fruit from a platform that had grown without attention. Would not expect to repeat a 40% reduction at a company that was already paying attention to cost.

### The EKS migration

22 services moved from ECS to EKS. Biggest risk was stateful services with long-lived connections. Kept ECS definitions running in parallel for two weeks, used a weighted DNS strategy to shift 10%, 50%, then 100% of traffic. One service hit a Kubernetes DNS resolution bug during rollout; worked around it with a pod-level DNS policy override.

### Internal developer platform

Built on Backstage. The hard part was not the scaffolding, it was getting the template library to be opinionated enough to be useful without being so rigid that teams routed around it. Iterated three times on the service template based on feedback from early adopter teams.

### Multi-region Postgres

15K TPS peak is real but represents maybe three hours per day at that level. Sustained load is closer to 6K TPS. Topology is Patroni with two replicas per region, synchronous replication to the nearest replica and asynchronous to the remote region. Failover takes about 40 seconds end-to-end.

### What I'd do differently

Spent too long on the IDP in the early months when I should have been paying down observability debt first. A couple of incidents in Q3 would have been caught earlier with better tracing.

## Globex — Backend Engineer (June 2019 to March 2022)

### Billing service rewrite

Old service was a Python Flask app with a lot of N+1 query patterns. Rewrote it in Go with proper connection pooling and batched DB access. p99 latency 800ms to 90ms was measured over a week of production traffic after rollout.

Honest assessment: this was not a clean rewrite. Kept some of the original error handling shape because the upstream consumers depended on specific HTTP status codes and response structures. A second pass would clean that up.

### Kafka notifications pipeline

400M events per day, processed in roughly real-time. Built on Kafka Streams with a Go consumer pool. Kept the hot path lean, offloaded heavier enrichment to a secondary consumer group.

Biggest lesson: underinvested in dead-letter queue tooling early. When we hit a poison message, triage was harder than it should have been.

## Initech — Software Engineer (July 2017 to June 2019)

### Early-stage context

First engineering hire. Founders were technical but stretched thin. I owned the API, schema, deploys, and the on-call pager for my first 18 months.

### What it gave me

Comfort with ambiguity, willingness to touch whatever needs touching, a default instinct to write runbooks even when nobody is asking for them.

### What it cost

Two years without peer code review is real technical debt. The first year at Globex was a steep recalibration on code quality norms.
