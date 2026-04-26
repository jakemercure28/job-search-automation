'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./logger')('clusters');

const CANONICAL_FILENAME = 'canonical_clusters.json';

function loadCanonicalClusters(profileDir) {
  try {
    const p = path.join(profileDir, CANONICAL_FILENAME);
    if (fs.existsSync(p)) {
      const clusters = JSON.parse(fs.readFileSync(p, 'utf8'));
      log.debug('Clusters loaded', { count: clusters.length });
      return clusters;
    }
  } catch (_) {}
  log.debug('No clusters file found');
  return null;
}

function saveCanonicalClusters(profileDir, clusters) {
  const p = path.join(profileDir, CANONICAL_FILENAME);
  const canonical = clusters.slice(0, 4).map(c => ({ name: c.name, emoji: c.emoji }));
  fs.writeFileSync(p, JSON.stringify(canonical, null, 2));
  log.info('Clusters saved', { count: canonical.length, names: canonical.map(c => c.name) });
  return canonical;
}

function buildClusterRule(canonicalClusters, jobCount) {
  if (canonicalClusters && canonicalClusters.length > 0) {
    const list = canonicalClusters.map(c => `  ${c.emoji} "${c.name}"`).join('\n');
    return `- skill_clusters: You MUST use exactly these ${canonicalClusters.length} cluster names and emojis — do not rename, merge, reorder, or add clusters:\n${list}\n  For each cluster, analyze which JDs primarily belong to it and return fresh metrics: skills (6-8 tightest co-occurring skills for that cluster), applicant_match_pct (% of cluster skills on resume, 0-100), anchor_skill (the ONE missing skill not on resume that would most increase match), anchor_note (1 sentence citing co-occurrence frequency), job_count (how many JDs primarily belong to this cluster). The name and emoji fields in your response must be byte-for-byte identical to the list above.`;
  }

  return `- skill_clusters: Derive the top 4 dominant archetypes from co-occurrence patterns across all ${jobCount} JDs. These will become the permanent canonical clusters tracked over time — choose names that are stable and broadly applicable (not too narrow or too specific to a moment). Expected patterns to look for: GPU/Ray/Vector DB (AI infra), GitOps/IDP/Backstage (Platform), AWS/Terraform/SRE/Observability (Scale Infra), FedRAMP/Zero Trust/Compliance (Security). For each cluster: name = descriptive archetype name, emoji = single emoji, skills = the 6-8 skills with tightest co-occurrence, applicant_match_pct = what % of cluster skills appear on the candidate resume (0-100), anchor_skill = the ONE missing skill that would most increase match (must not be on resume), anchor_note = 1 sentence on why that skill unlocks the cluster (cite co-occurrence frequency), job_count = how many JDs primarily belong to this cluster.`;
}

module.exports = { loadCanonicalClusters, saveCanonicalClusters, buildClusterRule };
