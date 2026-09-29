// ---------------------------------------------------------------------------
// Metrics Registry
// ---------------------------------------------------------------------------
// Zero-dependency Prometheus text-exposition metrics. Kept intentionally small:
// counters + histograms recorded in-process and rendered on demand for a
// /metrics scrape. Avoids high-cardinality labels (no raw ids / tenant aliases
// beyond a normalized route) so a Prometheus/Grafana backend stays healthy.
// ---------------------------------------------------------------------------

const DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface Histogram {
  buckets: number[];
  counts: number[]; // per-bucket cumulative counts filled at render time
  raw: number[]; // count of observations <= each bucket boundary
  sum: number;
  count: number;
}

function newHistogram(): Histogram {
  return {
    buckets: DURATION_BUCKETS,
    counts: [],
    raw: new Array(DURATION_BUCKETS.length).fill(0),
    sum: 0,
    count: 0,
  };
}

function observe(h: Histogram, valueSeconds: number): void {
  h.sum += valueSeconds;
  h.count += 1;
  for (let i = 0; i < h.buckets.length; i++) {
    if (valueSeconds <= h.buckets[i]) h.raw[i] += 1;
  }
}

// key = serialized label set -> value
const counters = new Map<string, number>();
const histograms = new Map<string, Histogram>();
let httpInFlight = 0;

function labelKey(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${escapeLabel(labels[k])}"`)
    .join(',');
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function incCounter(name: string, labels: Record<string, string>, by = 1): void {
  const key = `${name}{${labelKey(labels)}}`;
  counters.set(key, (counters.get(key) || 0) + by);
}

function observeHistogram(name: string, labels: Record<string, string>, seconds: number): void {
  const key = `${name}{${labelKey(labels)}}`;
  let h = histograms.get(key);
  if (!h) {
    h = newHistogram();
    histograms.set(key, h);
  }
  observe(h, seconds);
}

// ---------------------------------------------------------------------------
// Recording API
// ---------------------------------------------------------------------------

export function recordHttp(method: string, route: string, status: number, durationMs: number): void {
  incCounter('http_requests_total', { method, route, status: String(status) });
  observeHistogram('http_request_duration_seconds', { method, route }, durationMs / 1000);
}

export function recordUpstream(provider: string, ok: boolean, status: number, durationMs: number): void {
  incCounter('upstream_requests_total', {
    provider,
    outcome: ok ? 'success' : 'error',
    status: String(status),
  });
  observeHistogram('upstream_request_duration_seconds', { provider }, durationMs / 1000);
}

export function incSecurityEvent(event: string): void {
  incCounter('security_events_total', { event });
}

export function httpInFlightInc(): void {
  httpInFlight += 1;
}

export function httpInFlightDec(): void {
  httpInFlight = Math.max(0, httpInFlight - 1);
}

// ---------------------------------------------------------------------------
// Rendering (Prometheus text format v0.0.4)
// ---------------------------------------------------------------------------

export function renderMetrics(): string {
  const lines: string[] = [];

  lines.push('# HELP http_requests_total Total HTTP requests handled.');
  lines.push('# TYPE http_requests_total counter');
  for (const [key, value] of counters) {
    if (key.startsWith('http_requests_total')) lines.push(`${key} ${value}`);
  }

  lines.push('# HELP http_request_duration_seconds HTTP request latency.');
  lines.push('# TYPE http_request_duration_seconds histogram');
  renderHistograms('http_request_duration_seconds', lines);

  lines.push('# HELP upstream_requests_total Total upstream API calls (Blackpoint / Defender / Graph).');
  lines.push('# TYPE upstream_requests_total counter');
  for (const [key, value] of counters) {
    if (key.startsWith('upstream_requests_total')) lines.push(`${key} ${value}`);
  }

  lines.push('# HELP upstream_request_duration_seconds Upstream API latency.');
  lines.push('# TYPE upstream_request_duration_seconds histogram');
  renderHistograms('upstream_request_duration_seconds', lines);

  lines.push('# HELP security_events_total Security-relevant events (auth failures, rate limits, tenant denials).');
  lines.push('# TYPE security_events_total counter');
  for (const [key, value] of counters) {
    if (key.startsWith('security_events_total')) lines.push(`${key} ${value}`);
  }

  lines.push('# HELP http_in_flight_requests In-flight HTTP requests.');
  lines.push('# TYPE http_in_flight_requests gauge');
  lines.push(`http_in_flight_requests ${httpInFlight}`);

  return lines.join('\n') + '\n';
}

function renderHistograms(name: string, lines: string[]): void {
  for (const [key, h] of histograms) {
    if (!key.startsWith(name)) continue;
    const inner = key.slice(name.length + 1, -1); // label set without braces
    const prefix = inner ? `${inner},` : '';
    let cumulative = 0;
    for (let i = 0; i < h.buckets.length; i++) {
      cumulative = h.raw[i];
      lines.push(`${name}_bucket{${prefix}le="${h.buckets[i]}"} ${cumulative}`);
    }
    lines.push(`${name}_bucket{${prefix}le="+Inf"} ${h.count}`);
    lines.push(`${name}_sum{${inner}} ${h.sum}`);
    lines.push(`${name}_count{${inner}} ${h.count}`);
  }
}
