# Acme Corp — Senior Platform Engineer

**March 2022 to present**
**Austin, TX (hybrid, 2 days in office)**

Fictional example file.

## Company context

Acme Corp was a Series C growth-stage company at ~200 engineers when I joined. Ran on AWS, mostly EKS, Postgres, Go and Python services. Infrastructure was owned by a 6-person platform team that I joined as the 4th engineer.

## Scope of ownership

- Cost posture across all production AWS accounts
- EKS cluster operations and upgrades
- Internal developer platform (Backstage-based)
- Multi-region Postgres for the core transactional workload
- Rotating on-call across the full platform stack

## Key projects

### Cost reduction program

Reduced AWS spend from $85K/month to $51K/month over four months. Biggest wins:

- EKS node right-sizing after analysis showed 40% idle capacity
- Migration of batch jobs to spot instances with graceful interruption handling
- Reserved instance purchases for workloads that had stabilized
- Rewriting a few services to batch API calls rather than per-row

### ECS to EKS migration

Moved 22 services over six weeks. Used weighted DNS for gradual cutover. One service (pricing) hit a Kubernetes DNS issue during rollout and needed a pod-level DNS policy override.

### Internal developer platform

Built on Backstage with custom plugins for our service template, deployment visibility, and runbook search. 40+ engineers self-serve new services now. Adoption was uneven in the first quarter, hit critical mass once the second and third teams started using it.

### Postgres topology

Patroni-managed cluster with one primary and two replicas per region. Synchronous replication to the near replica, asynchronous to the remote region. Peak load is 15K TPS, sustained around 6K TPS. Failover is about 40 seconds end-to-end, tested quarterly via game days.

## Honest assessment

I'd rate this role a strong fit overall. The platform team was well-staffed enough that I wasn't a single point of failure, but small enough that I genuinely owned things. The biggest learning was that I underinvested in observability early and paid for it during a Q3 incident that took longer to root-cause than it should have.

Would I do it again? Yes, with earlier observability investment.
