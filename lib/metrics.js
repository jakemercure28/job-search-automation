'use strict';

/**
 * Prometheus metrics collector. No dependencies — generates the text exposition format directly.
 *
 * Usage:
 *   const metrics = require('./lib/metrics');
 *   metrics.httpRequestsTotal.inc({ method: 'GET', path: '/', status: 200 });
 *   metrics.httpRequestDuration.observe({ method: 'GET', path: '/' }, 0.045);
 *   const output = metrics.serialize();  // Prometheus text format
 */

class Counter {
  constructor(name, help, labelNames) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.values = new Map();
  }

  inc(labels = {}, value = 1) {
    const key = this._key(labels);
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  _key(labels) {
    return this.labelNames.map(n => `${n}="${labels[n] || ''}"`).join(',');
  }

  serialize() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.values) {
      lines.push(`${this.name}{${key}} ${value}`);
    }
    return lines.join('\n');
  }
}

class Histogram {
  constructor(name, help, labelNames, buckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.buckets = buckets;
    this.observations = new Map();
  }

  observe(labels = {}, value) {
    const key = this.labelNames.map(n => `${n}="${labels[n] || ''}"`).join(',');
    if (!this.observations.has(key)) {
      this.observations.set(key, { sum: 0, count: 0, buckets: this.buckets.map(() => 0) });
    }
    const obs = this.observations.get(key);
    obs.sum += value;
    obs.count++;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) { obs.buckets[i]++; break; }
    }
  }

  serialize() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, obs] of this.observations) {
      const prefix = key ? `${this.name}_bucket{${key},` : `${this.name}_bucket{`;
      for (let i = 0; i < this.buckets.length; i++) {
        const cumulative = obs.buckets.slice(0, i + 1).reduce((a, b) => a + b, 0);
        lines.push(`${prefix}le="${this.buckets[i]}"} ${cumulative}`);
      }
      lines.push(`${prefix}le="+Inf"} ${obs.count}`);
      const sumPrefix = key ? `{${key}}` : '';
      lines.push(`${this.name}_sum${sumPrefix} ${obs.sum}`);
      lines.push(`${this.name}_count${sumPrefix} ${obs.count}`);
    }
    return lines.join('\n');
  }
}

class Gauge {
  constructor(name, help, labelNames = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.values = new Map();
  }

  set(labels = {}, value) {
    const key = this.labelNames.length
      ? this.labelNames.map(n => `${n}="${labels[n] || ''}"`).join(',')
      : '';
    this.values.set(key, value);
  }

  serialize() {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [key, value] of this.values) {
      lines.push(key ? `${this.name}{${key}} ${value}` : `${this.name} ${value}`);
    }
    return lines.join('\n');
  }
}

// App metrics
const httpRequestsTotal = new Counter(
  'http_requests_total', 'Total HTTP requests', ['method', 'path', 'status']
);

const httpRequestDuration = new Histogram(
  'http_request_duration_seconds', 'HTTP request duration in seconds', ['method', 'path']
);

const geminiApiCalls = new Counter(
  'gemini_api_calls_total', 'Total Gemini API calls', ['status']
);

const jobsScraped = new Gauge(
  'jobs_scraped_today', 'Jobs scraped today by platform', ['platform']
);

const jobsByStatus = new Gauge(
  'jobs_by_status', 'Job count by status', ['status']
);

const jobsByStage = new Gauge(
  'jobs_by_stage', 'Job count by pipeline stage', ['stage']
);

function serialize() {
  return [
    httpRequestsTotal,
    httpRequestDuration,
    geminiApiCalls,
    jobsScraped,
    jobsByStatus,
    jobsByStage,
  ].map(m => m.serialize()).filter(s => s.includes('}')).join('\n\n') + '\n';
}

module.exports = {
  httpRequestsTotal,
  httpRequestDuration,
  geminiApiCalls,
  jobsScraped,
  jobsByStatus,
  jobsByStage,
  serialize,
};
