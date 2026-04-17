'use strict';

const { escapeHtml } = require('../utils');
const { COLORS } = require('./helpers');
const { parseYearsFromDescription, classifySeniority } = require('../seniority');

// 3-tier purple luminance: high → vibrant, mid → standard, low → deep
function purpleScale(pct) {
  if (pct > 70) return '#d8b4fe';
  if (pct > 40) return '#a855f7';
  return '#6d28d9';
}

// ---------------------------------------------------------------------------
// Seniority breakdown rendering
// ---------------------------------------------------------------------------

const LEVEL_META = {
  junior: { label: 'Junior / Entry', color: '#6d28d9', yearsLabel: '0\u20132 yrs' },
  mid:    { label: 'Mid-Level',      color: '#a855f7', yearsLabel: '3\u20134 yrs' },
  senior: { label: 'Senior',         color: '#d8b4fe', yearsLabel: '5\u20137 yrs' },
  staff:  { label: 'Staff / Lead+',  color: '#d8b4fe', yearsLabel: '8+ yrs' },
};

function renderSeniorityBreakdown(allJobs) {
  if (!allJobs || !allJobs.length) return '';

  const buckets = { junior: [], mid: [], senior: [], staff: [] };
  let jdSourceCount = 0;

  for (const j of allJobs) {
    const { level, source } = classifySeniority(j.title, j.description);
    buckets[level].push(j);
    if (source === 'jd') jdSourceCount++;
  }

  const total = allJobs.length;
  const titleSourceCount = total - jdSourceCount;

  // Build bar chart rows
  const maxCount = Math.max(...Object.values(buckets).map(b => b.length), 1);
  const levels = ['junior', 'mid', 'senior', 'staff'];

  // Highlight the applicant's seniority level in the chart. Set via APPLICANT_SENIORITY env var.
  // Valid values: junior, mid, senior, staff. Defaults to 'mid'.
  const applicantLevel = process.env.APPLICANT_SENIORITY || 'mid';

  const barRows = levels.map(level => {
    const meta = LEVEL_META[level];
    const count = buckets[level].length;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const barPct = Math.round((count / maxCount) * 100);
    const isApplicant = level === applicantLevel;
    const marker = isApplicant ? `<span style="color:#a855f7;font-size:11px;margin-left:6px;font-weight:700;text-shadow:0 0 10px #a855f7">\u25C0 you</span>` : '';

    return `
    <div style="display:grid;grid-template-columns:140px 1fr 110px;align-items:center;gap:12px;margin-bottom:10px">
      <div style="font-size:13px;color:#e2e8f0;text-align:right;white-space:nowrap">
        ${meta.label}<br><span style="font-size:11px;color:${COLORS.muted}">${meta.yearsLabel}</span>
      </div>
      <div style="height:28px;background:rgba(255,255,255,0.05);border-radius:4px;overflow:hidden;position:relative${isApplicant ? ';box-shadow:0 0 0 1px #a855f7' : ''}">
        <div style="height:100%;width:${barPct}%;background:${meta.color};border-radius:4px;min-width:4px;display:flex;align-items:center;padding-left:8px">
          ${barPct > 20 ? `<span style="font-size:11px;color:#fff;font-weight:600;font-family:var(--font-mono)">${count}</span>` : ''}
        </div>
        ${barPct <= 20 ? `<span style="position:absolute;left:${barPct + 2}%;top:50%;transform:translateY(-50%);font-size:11px;color:#e2e8f0;font-weight:600;font-family:var(--font-mono)">${count}</span>` : ''}
      </div>
      <div style="font-size:13px;color:#e2e8f0;font-weight:600;font-family:var(--font-mono)">${pct}%${marker}</div>
    </div>`;
  }).join('');

  // Compute roles accessible to the applicant based on APPLICANT_YOE env var.
  // Falls back to 4 years if unset.
  const applicantYoe = Number(process.env.APPLICANT_YOE) || 4;
  const accessible = allJobs.filter(j => {
    const { level, years } = classifySeniority(j.title, j.description);
    if (years !== null) return years <= applicantYoe;
    return level === 'junior' || level === 'mid';
  });
  const accessiblePct = total > 0 ? Math.round((accessible.length / total) * 100) : 0;

  // Year distribution for jobs with explicit years in JD
  const yearBuckets = {};
  for (const j of allJobs) {
    const years = parseYearsFromDescription(j.description);
    if (years !== null) {
      yearBuckets[years] = (yearBuckets[years] || 0) + 1;
    }
  }
  const yearEntries = Object.entries(yearBuckets).sort((a, b) => Number(a[0]) - Number(b[0]));
  const maxYearCount = Math.max(...yearEntries.map(e => e[1]), 1);

  const yearRows = yearEntries.map(([yr, count]) => {
    const barPct = Math.round((count / maxYearCount) * 100);
    const yrsNum = Number(yr);
    // Map years to the same level/color as the seniority distribution
    const level = yrsNum <= 2 ? 'junior' : yrsNum <= 4 ? 'mid' : yrsNum <= 7 ? 'senior' : 'staff';
    const barColor = LEVEL_META[level].color;
    const isMatch = level === 'mid';
    return `
    <div style="display:grid;grid-template-columns:60px 1fr 40px;align-items:center;gap:8px;margin-bottom:4px">
      <div style="font-size:12px;color:${barColor};text-align:right;font-weight:${isMatch ? '700' : '400'};font-family:var(--font-mono)">${yr}+ yrs</div>
      <div style="height:18px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${barPct}%;background:${barColor};border-radius:3px;min-width:3px"></div>
      </div>
      <div style="font-size:11px;color:#e2e8f0;font-family:var(--font-mono)">${count}</div>
    </div>`;
  }).join('');

  const experienceCard = yearEntries.length > 0 ? `
  <div class="analytics-section market-section">
    <h2 class="analytics-title">Experience Requirements</h2>
    <p class="analytics-hint">From ${jdSourceCount} JDs with explicit years. Bright = your range. Dark = reach.</p>
    <div style="margin-top:10px">
      ${yearRows}
    </div>
  </div>` : '';

  return `
  <div class="${yearEntries.length > 0 ? 'market-research-grid' : ''}">
    <div class="analytics-section market-section">
      <h2 class="analytics-title">Market Seniority Distribution</h2>
      <p class="analytics-hint">${total} active roles classified by seniority. ${jdSourceCount} from JD experience requirements, ${titleSourceCount} from title only.</p>

      <div style="margin-top:16px">
        ${barRows}
      </div>

      <div style="margin-top:20px;padding:14px 18px;background:rgba(255,255,255,0.04);border-radius:8px;border-left:3px solid #a855f7">
        <div style="font-size:14px;color:#e2e8f0">
          <strong style="font-family:var(--font-mono)">${accessible.length}</strong> of <span style="font-family:var(--font-mono)">${total}</span> roles (<strong style="font-family:var(--font-mono)">${accessiblePct}%</strong>) are realistically accessible at ${applicantYoe} YOE
          <span style="font-size:12px;color:${COLORS.muted}"> \u2014 roles asking \u2264${applicantYoe} years or titled mid-level/junior</span>
        </div>
      </div>
    </div>
    ${experienceCard}
  </div>`;
}

function renderMarketResearch(cache, jobCount, allJobs) {
  const seniorityHtml = renderSeniorityBreakdown(allJobs);

  if (!cache) return seniorityHtml + renderRunPage(null, jobCount);
  const stale = Date.now() - cache.generatedAt > 48 * 3600 * 1000;
  if (stale) return seniorityHtml + renderRunPage(cache.generatedAt, jobCount);
  return seniorityHtml + renderResults(cache);
}

function renderRunPage(generatedAt, jobCount) {
  const lastRun = generatedAt
    ? `<p style="color:#d8b4fe;font-size:13px;margin-bottom:8px">Last run: ${new Date(generatedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} — results are stale (older than 48h)</p>`
    : '';

  return `
<div class="analytics-wrap">
  <div class="analytics-section market-section" style="max-width:600px">
    <h2 class="analytics-title">JD Market Research</h2>
    <p style="color:${COLORS.muted};font-size:14px;line-height:1.7;margin-bottom:16px">
      Analyzes all active job descriptions to surface which skills appear most,
      what gaps exist in your resume, and what the market is actually asking for right now.
    </p>
    ${lastRun}
    <p style="color:${COLORS.muted};font-size:13px;margin-bottom:24px">Will analyze all ~<span style="font-family:var(--font-mono)">${jobCount}</span> active JDs and run Gemini analysis.</p>
    <form method="POST" action="/market-research">
      <button type="submit" style="background:#a855f7;color:#fff;border:none;padding:8px 22px;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600">
        Run Analysis
      </button>
    </form>
  </div>
</div>`;
}

function renderLocationBreakdown(lb, total) {
  if (!lb) return '';
  const cats = [
    { key: 'remote',        label: 'Remote',        color: '#d8b4fe' },
    { key: 'hybrid',        label: 'Hybrid',        color: '#a855f7' },
    { key: 'in_person',     label: 'In-Person',     color: '#6d28d9' },
    { key: 'not_specified', label: 'Not Specified',  color: 'rgba(255,255,255,0.15)' },
  ];
  const maxVal = Math.max(...cats.map(c => lb[c.key] || 0), 1);
  const bars = cats.map(c => {
    const count = lb[c.key] || 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const barPct = Math.round((count / maxVal) * 100);
    return `
    <div style="display:grid;grid-template-columns:120px 1fr 100px;align-items:center;gap:12px;margin-bottom:8px">
      <div style="font-size:13px;color:#e2e8f0;text-align:right">${c.label}</div>
      <div style="height:22px;background:rgba(255,255,255,0.05);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${barPct}%;background:${c.color};border-radius:4px;min-width:${count > 0 ? 4 : 0}px"></div>
      </div>
      <div style="font-size:12px;color:#e2e8f0;font-weight:600;font-family:var(--font-mono)">${count} <span style="font-weight:400;color:${COLORS.muted}">(${pct}%)</span></div>
    </div>`;
  }).join('');

  const cities = (lb.top_cities || []).filter(c => c && c.city);
  const maxCityCount = Math.max(...cities.map(c => c.count || 0), 1);
  const cityBars = cities.map(c => {
    const barPct = Math.round(((c.count || 0) / maxCityCount) * 100);
    const cityPct = total > 0 ? Math.round(((c.count || 0) / total) * 100) : 0;
    return `
    <div style="display:grid;grid-template-columns:130px 1fr 90px;align-items:center;gap:12px;margin-bottom:8px">
      <div style="font-size:13px;color:#e2e8f0;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(c.city)}">${escapeHtml(c.city)}</div>
      <div style="height:20px;background:rgba(255,255,255,0.05);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${barPct}%;background:#a855f7;border-radius:4px;min-width:${c.count > 0 ? 4 : 0}px"></div>
      </div>
      <div style="font-size:12px;color:#e2e8f0;font-weight:600;font-family:var(--font-mono)">${c.count} <span style="font-weight:400;color:${COLORS.muted}">(${cityPct}%)</span></div>
    </div>`;
  }).join('');

  const citiesSection = cities.length > 0 ? `
    <div style="margin-top:24px">
      <div style="font-size:13px;color:${COLORS.muted};margin-bottom:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Top Cities / Metros</div>
      <div style="max-width:600px">${cityBars}</div>
    </div>` : '';

  return `
  <div class="analytics-section market-section">
    <h2 class="analytics-title">Work Location Breakdown</h2>
    <p class="analytics-hint">How <span style="font-family:var(--font-mono)">${total}</span> analyzed JDs break down by location type</p>
    <div style="max-width:600px;margin-top:12px">${bars}</div>
    ${citiesSection}
  </div>`;
}

function renderSkillClusters(clusters) {
  if (!clusters || !clusters.length) return '';

  const cards = clusters.map(c => {
    const matchPct = Math.round(c.applicant_match_pct || 0);
    const barColor = matchPct > 70 ? 'var(--vibrant-purple)' : matchPct > 40 ? 'var(--standard-purple)' : 'var(--deep-purple)';
    const skillTags = (c.skills || []).map(s =>
      `<span style="background:rgba(168,85,247,0.12);color:#a855f7;padding:2px 9px;border-radius:10px;font-size:11px;display:inline-block;margin:2px;border:0.5px solid rgba(168,85,247,0.25)">${escapeHtml(s)}</span>`
    ).join('');

    return `
    <div class="analytics-section market-section" style="display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <span style="font-size:20px;margin-right:8px">${escapeHtml(c.emoji || '')}</span>
          <span style="font-size:15px;font-weight:700;color:var(--text-primary)">${escapeHtml(c.name || '')}</span>
        </div>
        <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);white-space:nowrap;margin-left:8px">${c.job_count || 0} JDs</span>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:0">${skillTags}</div>

      <div style="border-top:0.5px solid var(--glass-border);padding-top:12px;display:flex;flex-direction:column;gap:10px">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;font-weight:600">Your Match</span>
            <span style="font-size:14px;font-weight:700;color:${barColor};font-family:var(--font-mono)">${matchPct}%</span>
          </div>
          <div style="height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${matchPct}%;background:${barColor};border-radius:4px;transition:width 0.3s ease"></div>
          </div>
        </div>

        ${c.anchor_skill ? `
        <div style="background:rgba(245,158,11,0.06);border-radius:6px;padding:10px 12px;border-left:2px solid #f59e0b">
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span style="font-size:10px;color:#f59e0b;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;white-space:nowrap">Unlock with</span>
            <span style="font-size:13px;font-weight:700;color:#ef4444;font-family:var(--font-mono)">${escapeHtml(c.anchor_skill)}</span>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin:4px 0 0;line-height:1.5">${escapeHtml(c.anchor_note || '')}</p>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
  <div>
    <div style="margin-bottom:16px">
      <h2 class="analytics-title" style="margin-bottom:4px">Skill Cluster Intelligence</h2>
      <p class="analytics-hint">Co-occurrence archetypes derived from ${clusters.reduce((a, c) => a + (c.job_count || 0), 0)} JDs. Clusters show which skills appear together most, your current overlap, and the single skill that unlocks each cluster.</p>
    </div>
    <div class="market-research-grid">${cards}</div>
  </div>`;
}

function renderStrategyScore(strategy) {
  if (!strategy) return '';

  const { idp_pct, ops_pct, pivot_direction, pivot_note } = strategy;
  const idp = Math.round(idp_pct || 0);
  const ops = Math.round(ops_pct || 0);

  // Dot position: 0% = full builder, 100% = full operator
  // idp_pct=70 means 70% builder → dot at 30% from left (closer to builder side)
  const dotLeft = Math.max(2, Math.min(96, 100 - idp));

  const badgeColor = pivot_direction === 'builder'
    ? { bg: 'rgba(168,85,247,0.15)', border: 'rgba(168,85,247,0.4)', text: '#d8b4fe' }
    : pivot_direction === 'operator'
    ? { bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.4)', text: '#93c5fd' }
    : { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.2)', text: '#e2e8f0' };

  const badgeLabel = pivot_direction === 'builder' ? 'Leaning Builder'
    : pivot_direction === 'operator' ? 'Leaning Ops'
    : 'Balanced';

  return `
  <div class="analytics-section market-section">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;flex-wrap:wrap;gap:8px">
      <div>
        <h2 class="analytics-title" style="margin-bottom:2px">Market Pivot 2026</h2>
        <p class="analytics-hint" style="margin:0">Are JDs asking for Tool Builders (IDP/Platform) or System Operators (Reliability/Ops)?</p>
      </div>
      <span style="font-size:12px;font-weight:600;padding:4px 12px;border-radius:12px;background:${badgeColor.bg};border:1px solid ${badgeColor.border};color:${badgeColor.text};white-space:nowrap">${badgeLabel}</span>
    </div>

    <div style="margin-top:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="text-align:left">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Tool Builder</div>
          <div style="font-size:18px;font-weight:700;color:#d8b4fe;font-family:var(--font-mono)">${idp}%</div>
          <div style="font-size:10px;color:var(--text-muted)">IDP / Platform / DX</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">System Operator</div>
          <div style="font-size:18px;font-weight:700;color:#93c5fd;font-family:var(--font-mono)">${ops}%</div>
          <div style="font-size:10px;color:var(--text-muted)">Reliability / SRE / Infra</div>
        </div>
      </div>

      <div style="position:relative;height:20px;border-radius:10px;overflow:hidden;background:linear-gradient(to right, #7c3aed, rgba(255,255,255,0.08), #1d4ed8)">
        <div style="position:absolute;top:50%;left:${dotLeft}%;transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 0 8px rgba(255,255,255,0.6);border:2px solid rgba(255,255,255,0.9)"></div>
      </div>

      <div style="display:flex;justify-content:space-between;margin-top:4px">
        <span style="font-size:10px;color:var(--text-muted)">◄ more builder</span>
        <span style="font-size:10px;color:var(--text-muted)">more ops ►</span>
      </div>
    </div>

    ${pivot_note ? `<p style="font-size:13px;color:var(--text-muted);line-height:1.6;margin-top:16px;padding-top:14px;border-top:0.5px solid var(--glass-border)">${escapeHtml(pivot_note)}</p>` : ''}
  </div>`;
}

function renderEmergingHighScore(terms) {
  if (!terms || !terms.length) return '';

  const rows = terms.map(t => `
    <div style="display:grid;grid-template-columns:180px 1fr 70px;align-items:start;gap:12px;padding:10px 0;border-bottom:0.5px solid var(--glass-border)">
      <div style="font-size:13px;font-weight:700;color:#d8b4fe;font-family:var(--font-mono);padding-top:1px">${escapeHtml(t.term)}</div>
      <div style="font-size:12px;color:var(--text-muted);line-height:1.5">${escapeHtml(t.note || '')}</div>
      <div style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono);text-align:right;white-space:nowrap">${t.job_count} JDs</div>
    </div>`).join('');

  return `
  <div class="analytics-section market-section">
    <h2 class="analytics-title">Emerging Signals — High-Score Jobs (9+)</h2>
    <p class="analytics-hint">Terms and concepts that appear in the highest-scoring JDs but are rare in lower-scored ones. These are what the best-fit roles are actually asking for.</p>
    <div style="margin-top:12px">${rows}</div>
  </div>`;
}

function renderResults(cache) {
  const { data, generatedAt, jobCount } = cache;
  if (!data || typeof data !== 'object') return renderRunPage(generatedAt, jobCount);
  const { summary, top_skills, gap_analysis, resume_strengths, trending, location_breakdown, sample_size,
          skill_clusters, strategy_score, emerging_high_score } = data;
  const runDate = new Date(generatedAt).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});

  const hasClusters = skill_clusters && skill_clusters.length > 0;

  // Top skills bar chart (shown as fallback when no clusters, or always as secondary reference)
  const maxCount = (top_skills?.[0]?.count) || 1;
  const skillRows = (top_skills || []).slice(0, 20).map(s => {
    const pct = Math.round((s.count / maxCount) * 100);
    const color = purpleScale(pct);
    return `
    <div style="display:grid;grid-template-columns:210px 1fr 80px;align-items:center;gap:12px;margin-bottom:8px">
      <div style="font-size:13px;color:var(--text-dim);text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(s.skill)}">${escapeHtml(s.skill)}</div>
      <div style="height:20px;background:rgba(255,255,255,0.05);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;min-width:4px"></div>
      </div>
      <div style="font-size:12px;color:var(--text-primary);font-weight:600;font-family:var(--font-mono)">${s.count} <span style="font-weight:400;color:var(--text-muted)">(${s.pct}%)</span></div>
    </div>`;
  }).join('');

  // Gap analysis
  const gapRows = (gap_analysis || []).map(s => `
    <tr>
      <td style="font-weight:600;color:${COLORS.red};font-family:var(--font-mono)">${escapeHtml(s.skill)}</td>
      <td style="color:${COLORS.muted};font-family:var(--font-mono)">${s.count}</td>
      <td style="color:${COLORS.muted};font-family:var(--font-mono)">${s.pct}%</td>
      <td style="color:${COLORS.muted};font-size:12px">${escapeHtml(s.note || '')}</td>
    </tr>`).join('');

  // Resume strengths
  const strengthRows = (resume_strengths || []).map(s => `
    <tr>
      <td style="font-weight:600;color:#d8b4fe;font-family:var(--font-mono)">${escapeHtml(s.skill)}</td>
      <td style="color:${COLORS.muted};font-family:var(--font-mono)">${s.count}</td>
    </tr>`).join('');

  return `
<div class="analytics-wrap">

  <div class="analytics-section market-section">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2 class="analytics-title" style="margin-bottom:0">JD Market Research</h2>
      <div style="display:flex;align-items:center;gap:16px">
        <span style="font-size:12px;color:${COLORS.muted}">Analyzed <span style="font-family:var(--font-mono)">${sample_size || jobCount}</span> JDs &middot; ${runDate}</span>
        <form method="POST" action="/market-research" style="margin:0">
          <button type="submit" class="btn btn-sm btn-archive">Re-run</button>
        </form>
      </div>
    </div>
    <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:16px 20px;border-left:3px solid #a855f7">
      <p style="color:#e2e8f0;font-size:14px;line-height:1.75;margin:0">${escapeHtml(summary || '')}</p>
    </div>
  </div>

  ${hasClusters ? renderSkillClusters(skill_clusters) : `
  <div class="analytics-section market-section">
    <h2 class="analytics-title">Top Skills Across All JDs</h2>
    <p class="analytics-hint">Skills appearing most frequently across all active job descriptions in your pipeline</p>
    <div style="max-width:720px;margin-top:8px">${skillRows || '<div style="color:var(--text-muted)">No data</div>'}</div>
  </div>`}

  ${renderStrategyScore(strategy_score)}

  ${renderEmergingHighScore(emerging_high_score)}

  ${hasClusters ? `
  <div class="analytics-section market-section">
    <h2 class="analytics-title">Top Skills Across All JDs</h2>
    <p class="analytics-hint">Raw skill frequency across all active JDs for reference</p>
    <div style="max-width:720px;margin-top:8px">${skillRows || '<div style="color:var(--text-muted)">No data</div>'}</div>
  </div>` : ''}

  <div class="analytics-section market-section">
    <h2 class="analytics-title">Gap Analysis — In JDs, Missing From Your Resume</h2>
    <p class="analytics-hint">Skills that appear frequently in target JDs but are absent or underrepresented on your resume</p>
    <table class="calibration-table">
      <thead><tr><th>Skill</th><th>JD Count</th><th>% of JDs</th><th>Note</th></tr></thead>
      <tbody>${gapRows || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No significant gaps identified</td></tr>'}</tbody>
    </table>
  </div>

  <div class="analytics-section market-section">
    <h2 class="analytics-title">Resume Strengths — You Have What They Want</h2>
    <p class="analytics-hint">Your skills that are heavily requested across target JDs — validation that you&rsquo;re in the right lane</p>
    <table class="calibration-table">
      <thead><tr><th>Skill</th><th>JD Count</th></tr></thead>
      <tbody>${strengthRows || '<tr><td colspan="2" style="text-align:center;color:var(--text-muted)">No data</td></tr>'}</tbody>
    </table>
  </div>

  ${location_breakdown ? renderLocationBreakdown(location_breakdown, sample_size) : ''}

</div>`;
}

module.exports = { renderMarketResearch };
