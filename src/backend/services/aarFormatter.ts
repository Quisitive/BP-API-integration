// ---------------------------------------------------------------------------
// After Action Report — Formatter
// ---------------------------------------------------------------------------
// Renders an AfterActionReport as Markdown (for export/sharing) or as a
// self-contained printable HTML document (for PDF via browser print).
// ---------------------------------------------------------------------------

import type { AfterActionReport, RemediationAction } from '../types.js';

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export function renderReportMarkdown(report: AfterActionReport): string {
  const lines: string[] = [];
  lines.push(`# Incident After Action Report — ${report.title}`);
  lines.push('');
  lines.push(`- **Report ID:** ${report.id}`);
  lines.push(`- **Tenant:** ${report.tenantAlias}`);
  lines.push(`- **Status:** ${report.status.toUpperCase()}`);
  lines.push(`- **Severity:** ${report.severity}`);
  lines.push(`- **Authored by:** ${report.authoredBy}`);
  lines.push(`- **Created:** ${report.createdAt}`);
  lines.push(`- **Last updated:** ${report.updatedAt}`);
  lines.push(`- **Outstanding risk:** ${report.outstandingRisk ? 'Yes' : 'No'}`);
  lines.push('');

  section(lines, 'Executive Summary', report.executiveSummary);
  section(lines, 'Detection Summary', report.detectionSummary);

  lines.push('## Aggregated Sources');
  lines.push('');
  if (report.sources.length === 0) {
    lines.push('_No sources aggregated._');
  } else {
    lines.push('| System | Type | Title | Severity | Status | Created |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const s of report.sources) {
      lines.push(`| ${s.system} | ${s.kind} | ${escapePipes(s.title || s.id)} | ${s.severity || '—'} | ${s.status || '—'} | ${s.createdAt || '—'} |`);
    }
  }
  lines.push('');

  lines.push('## Impacted Assets');
  lines.push('');
  lines.push(report.impactedAssets.length ? report.impactedAssets.map((a) => `- ${a}`).join('\n') : '_None recorded._');
  lines.push('');

  lines.push('## Timeline');
  lines.push('');
  if (report.timeline.length === 0) {
    lines.push('_No timeline entries._');
  } else {
    for (const t of report.timeline) {
      lines.push(`- **${t.timestamp}** _(${t.source})_ — ${t.label}${t.detail ? ` · ${t.detail}` : ''}`);
    }
  }
  lines.push('');

  section(lines, 'Investigation Findings', report.investigationFindings);
  section(lines, 'Containment Actions', report.containmentActions);
  section(lines, 'Root Cause', report.rootCause);
  section(lines, 'Lessons Learned', report.lessonsLearned);

  lines.push('## Recommended Next Steps (Remediation)');
  lines.push('');
  if (report.remediationActions.length === 0) {
    lines.push('_No remediation actions._');
  } else {
    lines.push('| Priority | Action | Owner (by who) | Timeline | Status |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const a of sortActions(report.remediationActions)) {
      lines.push(`| ${a.priority} | ${escapePipes(a.title)} | ${escapePipes(a.owner)} | ${escapePipes(a.timeline)} | ${a.status} |`);
    }
    lines.push('');
    for (const a of sortActions(report.remediationActions)) {
      lines.push(`### [${a.priority}] ${a.title}`);
      lines.push(`- **Owner:** ${a.owner}`);
      lines.push(`- **Timeline:** ${a.timeline}`);
      lines.push(`- **Status:** ${a.status}`);
      if (a.description) {
        lines.push('');
        lines.push(a.description);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function section(lines: string[], heading: string, body: string): void {
  lines.push(`## ${heading}`);
  lines.push('');
  lines.push(body && body.trim() ? body : '_Not documented._');
  lines.push('');
}

function escapePipes(value: string): string {
  return (value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function sortActions(actions: RemediationAction[]): RemediationAction[] {
  return [...actions].sort((a, b) => a.priority.localeCompare(b.priority));
}

// ---------------------------------------------------------------------------
// HTML (printable)
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderReportHtml(report: AfterActionReport): string {
  const sourceRows = report.sources
    .map(
      (s) =>
        `<tr><td>${esc(s.system)}</td><td>${esc(s.kind)}</td><td>${esc(s.title || s.id)}</td><td>${esc(s.severity || '—')}</td><td>${esc(s.status || '—')}</td><td>${esc(s.createdAt || '—')}</td></tr>`,
    )
    .join('');

  const timelineRows = report.timeline
    .map(
      (t) =>
        `<li><strong>${esc(t.timestamp)}</strong> <em>(${esc(t.source)})</em> — ${esc(t.label)}${t.detail ? ` · ${esc(t.detail)}` : ''}</li>`,
    )
    .join('');

  const actionRows = sortActions(report.remediationActions)
    .map(
      (a) =>
        `<tr class="prio-${esc(a.priority)}"><td>${esc(a.priority)}</td><td><strong>${esc(a.title)}</strong><br/><span class="muted">${esc(a.description)}</span></td><td>${esc(a.owner)}</td><td>${esc(a.timeline)}</td><td>${esc(a.status)}</td></tr>`,
    )
    .join('');

  const assets = report.impactedAssets.length
    ? `<ul>${report.impactedAssets.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
    : '<p class="muted">None recorded.</p>';

  const narrative = (heading: string, body: string) =>
    `<h2>${esc(heading)}</h2><p>${body && body.trim() ? esc(body).replace(/\n/g, '<br/>') : '<span class="muted">Not documented.</span>'}</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>AAR — ${esc(report.title)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1b1f27; margin: 2rem; line-height: 1.5; }
  h1 { font-size: 1.6rem; border-bottom: 3px solid #0b5cab; padding-bottom: .4rem; }
  h2 { font-size: 1.15rem; color: #0b5cab; margin-top: 1.6rem; }
  table { border-collapse: collapse; width: 100%; margin: .6rem 0 1rem; font-size: .9rem; }
  th, td { border: 1px solid #d0d5dd; padding: .45rem .6rem; text-align: left; vertical-align: top; }
  th { background: #f2f6fb; }
  .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: .25rem 1.5rem; font-size: .9rem; margin: 1rem 0; }
  .muted { color: #667085; }
  .badge { display: inline-block; padding: .1rem .5rem; border-radius: 4px; font-weight: 600; font-size: .8rem; }
  .sev-Critical, .prio-P1 td:first-child { color: #b42318; font-weight: 700; }
  .sev-High, .prio-P2 td:first-child { color: #b54708; font-weight: 700; }
  tr.prio-P1 { background: #fff4f2; }
  tr.prio-P2 { background: #fff8f0; }
  @media print { body { margin: 1rem; } h2 { page-break-after: avoid; } tr { page-break-inside: avoid; } }
</style>
</head>
<body>
<h1>Incident After Action Report — ${esc(report.title)}</h1>
<div class="meta">
  <div><strong>Report ID:</strong> ${esc(report.id)}</div>
  <div><strong>Tenant:</strong> ${esc(report.tenantAlias)}</div>
  <div><strong>Status:</strong> ${esc(report.status.toUpperCase())}</div>
  <div><strong>Severity:</strong> <span class="badge sev-${esc(report.severity)}">${esc(report.severity)}</span></div>
  <div><strong>Authored by:</strong> ${esc(report.authoredBy)}</div>
  <div><strong>Outstanding risk:</strong> ${report.outstandingRisk ? 'Yes' : 'No'}</div>
  <div><strong>Created:</strong> ${esc(report.createdAt)}</div>
  <div><strong>Last updated:</strong> ${esc(report.updatedAt)}</div>
</div>

${narrative('Executive Summary', report.executiveSummary)}
${narrative('Detection Summary', report.detectionSummary)}

<h2>Aggregated Sources</h2>
<table><thead><tr><th>System</th><th>Type</th><th>Title</th><th>Severity</th><th>Status</th><th>Created</th></tr></thead>
<tbody>${sourceRows || '<tr><td colspan="6" class="muted">No sources aggregated.</td></tr>'}</tbody></table>

<h2>Impacted Assets</h2>
${assets}

<h2>Timeline</h2>
<ul>${timelineRows || '<li class="muted">No timeline entries.</li>'}</ul>

${narrative('Investigation Findings', report.investigationFindings)}
${narrative('Containment Actions', report.containmentActions)}
${narrative('Root Cause', report.rootCause)}
${narrative('Lessons Learned', report.lessonsLearned)}

<h2>Recommended Next Steps (Remediation)</h2>
<table><thead><tr><th>Priority</th><th>Action</th><th>Owner (by who)</th><th>Timeline</th><th>Status</th></tr></thead>
<tbody>${actionRows || '<tr><td colspan="5" class="muted">No remediation actions.</td></tr>'}</tbody></table>

</body>
</html>`;
}
