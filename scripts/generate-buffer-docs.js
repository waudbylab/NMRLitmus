#!/usr/bin/env node
/**
 * Generate buffer documentation HTML from the database JSON.
 *
 * Usage: node scripts/generate-buffer-docs.js
 *
 * Reads: public/database/database.json
 * Writes: public/docs/buffers.html
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Molecule } from 'openchemlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Read database
const dbPath = join(rootDir, 'public/database/database.json');
const db = JSON.parse(readFileSync(dbPath, 'utf-8'));

// Helpers
function smilesToSVG(smiles, width, height) {
  try {
    const mol = Molecule.fromSmiles(smiles);
    mol.inventCoordinates();
    return mol.toSVG(width, height, null, { suppressChiralText: true });
  } catch (_) {
    return '';
  }
}

function formatValue(val, decimals = 2) {
  if (Array.isArray(val)) {
    return `${val[0].toFixed(decimals)} ± ${val[1].toFixed(decimals)}`;
  }
  return typeof val === 'number' ? val.toFixed(decimals) : val;
}

function formatNucleus(nucleus) {
  const match = nucleus.match(/^(\d+)(\w+)$/);
  if (match) return `<sup>${match[1]}</sup>${match[2]}`;
  return nucleus;
}

function bufferId(buffer) {
  return `buffer-${buffer.buffer_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${buffer.sample_id}`;
}

function sampleId(sampleIdStr) {
  return `sample-${sampleIdStr}`;
}

const samplesMap = new Map(db.samples.map(s => [s.sample_id, s]));

// Group buffers by sample
const buffersBySample = new Map();
for (const sample of db.samples) {
  buffersBySample.set(sample.sample_id, []);
}
for (const buffer of db.buffers) {
  const list = buffersBySample.get(buffer.sample_id);
  if (list) list.push(buffer);
}

// GitHub icon SVG
const githubIcon = `<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" fill="currentColor" style="vertical-align:middle;margin-right:4px"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

// Generate HTML
let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reference data - NMR pH calibration</title>
  <link rel="stylesheet" href="./shared.css">
  <style>
    .sample-section {
      margin-bottom: var(--spacing-xl);
    }
    .sample-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-md);
      margin: var(--spacing-md) 0;
    }
    @media (max-width: 640px) { .sample-info { grid-template-columns: 1fr; } }
    .info-block {
      background: var(--color-bg-subtle);
      border-radius: var(--radius-md);
      padding: var(--spacing-md);
      font-size: var(--font-size-base);
    }
    .info-block h4 {
      font-size: var(--font-size-sm);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-sm);
    }
    .info-block p { margin: 0.2rem 0; }
    .buffer-index {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-sm);
      margin: var(--spacing-md) 0;
    }
    .buffer-index a {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-xs);
      padding: 0.3rem 0.75rem;
      background: var(--color-accent-lighter);
      border: 1px solid var(--color-accent-light);
      border-radius: var(--radius-pill, 999px);
      font-size: var(--font-size-sm);
      color: var(--color-accent-hover);
      text-decoration: none;
      transition: background 0.15s;
    }
    .buffer-index a:hover { background: var(--color-accent-lightest); }
    .buffer-entry {
      scroll-margin-top: 1rem;
    }
    .buffer-entry-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      flex-wrap: wrap;
    }
    .buffer-structure-inline {
      float: right;
      margin: 0 0 var(--spacing-md) var(--spacing-lg);
      background: var(--color-bg-subtle);
      border-radius: var(--radius-md);
      padding: var(--spacing-sm);
      text-align: center;
    }
    .buffer-structure-inline canvas {
      display: block;
    }
    .back-links {
      display: flex;
      gap: var(--spacing-md);
      font-size: var(--font-size-sm);
      margin-top: var(--spacing-lg);
      padding-top: var(--spacing-md);
      border-top: 1px solid var(--color-border-lighter);
      color: var(--color-text-secondary);
    }
    .back-links a { color: var(--color-accent); }
  </style>
</head>
<body>
  <div class="page-container">
    <nav class="app-nav">
      <a href="../">Home</a>
      <a href="./index.html">Theory</a>
      <a href="./buffers.html" class="active">Reference data</a>
      <a href="../plots/index.html">Reference plots</a>
      <a href="./contribute.html">Contributing</a>
      <div class="nav-right">
        <a href="https://waudbylab.org">Waudby Lab</a>
        <a href="https://github.com/waudbylab/nmr-pH" class="nav-github">
          ${githubIcon}GitHub
        </a>
      </div>
    </nav>

    <header class="app-header">
      <h1>Reference data</h1>
      <p class="subtitle">pKa and chemical shift parameters for all buffers</p>
      <span class="version">v${db.database_version}</span>
    </header>

    <section id="top">
    <div class="meta">
      <strong>Database Version:</strong> ${db.database_version} ·
      <strong>Last Updated:</strong> ${db.last_updated} ·
      <strong>Buffers:</strong> ${db.buffers.length} ·
      <strong>Samples:</strong> ${db.samples.length}
    </div>

`;

// ── SAMPLE SUMMARIES SECTION ────────────────────────────────────────────────
for (const sample of db.samples) {
  const sId = sampleId(sample.sample_id);
  const title = sample.title || sample.sample_id.replace(/_/g, ' ');
  const buffers = buffersBySample.get(sample.sample_id) || [];

  html += `    <div class="sample-section" id="${sId}">
      <h2>${title}</h2>
`;

  // Sample info grid
  html += `      <div class="sample-info">
`;

  // Left block: measurement details
  html += `        <div class="info-block">
          <h4>Measurement Details</h4>
          <p><strong>Solvent:</strong> ${sample.solvent}</p>
          <p><strong>Reference temperature:</strong> ${sample.reference_temperature_K} K</p>
`;
  if (sample.date_measured) {
    html += `          <p><strong>Date measured:</strong> ${sample.date_measured}</p>
`;
  }
  if (sample.measurement_ranges) {
    const r = sample.measurement_ranges;
    if (r.pH) {
      html += `          <p><strong>pH range:</strong> ${r.pH[0].toFixed(1)} – ${r.pH[1].toFixed(1)}</p>
`;
    }
    if (r.temperature_K) {
      html += `          <p><strong>Temperature range:</strong> ${r.temperature_K[0]} – ${r.temperature_K[1]} K</p>
`;
    }
    if (r.ionic_strength_M) {
      html += `          <p><strong>Ionic strength range:</strong> ${r.ionic_strength_M[0]} – ${r.ionic_strength_M[1]} M</p>
`;
    }
  }
  html += `        </div>
`;

  // Right block: calibration & authors
  html += `        <div class="info-block">
          <h4>Calibration &amp; Authors</h4>
`;
  if (sample.authors && sample.authors.length > 0) {
    const authorList = sample.authors.map(a => {
      let s = a.name;
      if (a.orcid) s += ` <a href="https://orcid.org/${a.orcid}" target="_blank" rel="noopener">[ORCID]</a>`;
      if (a.affiliation) s += ` <span style="color:var(--color-text-muted);font-style:italic">(${a.affiliation})</span>`;
      return s;
    });
    html += `          <p><strong>Authors:</strong> ${authorList.join('; ')}</p>
`;
  }
  if (sample.temperature_calibration) {
    html += `          <p><strong>Temperature calibration:</strong> ${sample.temperature_calibration}</p>
`;
  }
  if (sample.pH_calibration) {
    html += `          <p><strong>pH calibration:</strong> ${sample.pH_calibration}</p>
`;
  }
  if (sample.ionic_strength_control) {
    html += `          <p><strong>Ionic strength control:</strong> ${sample.ionic_strength_control}</p>
`;
  }
  html += `        </div>
      </div>
`;

  // Buffer index
  if (buffers.length > 0) {
    html += `      <h3 style="margin-top:var(--spacing-md)">Buffers in this dataset</h3>
      <div class="buffer-index">
`;
    for (const buf of buffers) {
      const nuclei = Object.keys(buf.chemical_shifts);
      const nucleiBadges = nuclei.map(n => `<span style="font-size:0.75em">${formatNucleus(n)}</span>`).join(' ');
      html += `        <a href="#${bufferId(buf)}">${buf.buffer_name} ${nucleiBadges}</a>
`;
    }
    html += `      </div>
`;
  }

  html += `    </div>
`;
}

// ── BUFFER DATA SECTIONS ────────────────────────────────────────────────────
html += `    <hr style="margin:var(--spacing-xl) 0;border:none;border-top:2px solid var(--color-border-lighter)">
    <h2 style="margin-top:0">Buffer Parameters</h2>
`;

for (const buffer of db.buffers) {
  const sample = samplesMap.get(buffer.sample_id);
  const nuclei = Object.keys(buffer.chemical_shifts);
  const bid = bufferId(buffer);
  const sampleTitle = sample?.title || buffer.sample_id.replace(/_/g, ' ');
  const backToSampleHref = `#${sampleId(buffer.sample_id)}`;

  html += `    <div class="buffer-entry" id="${bid}">
`;

  // Structure (floated right if SMILES available)
  if (buffer.smiles) {
    html += `      <div class="buffer-structure-inline">
        ${smilesToSVG(buffer.smiles, 180, 130)}
      </div>
`;
  }

  // Buffer heading
  html += `      <div class="buffer-entry-header">
        <h2 style="margin-top:0;border-top:none;padding-top:0">${buffer.buffer_name}`;
  if (nuclei.length > 0) {
    html += `<span class="nuclei-badges">`;
    for (const nucleus of nuclei) {
      html += `<span class="nucleus-badge">${formatNucleus(nucleus)}</span>`;
    }
    html += `</span>`;
  }
  html += `</h2>
      </div>

      <div class="buffer-meta">
        <strong>Solvent:</strong> ${sample ? sample.solvent : 'Unknown'} ·
        <strong>Dataset:</strong> <a href="${backToSampleHref}">${sampleTitle}</a> ·
        <strong>T<sub>ref</sub>:</strong> ${sample?.reference_temperature_K || 298} K ·
        <strong>Ionisation states:</strong> ${buffer.ionisation_states}
      </div>

      <h3>Thermodynamic Parameters</h3>
      <div class="pka-section">
`;

  for (const pka of buffer.pKa_parameters) {
    const dH  = pka['ΔH_kJ_mol'];
    const dCp = pka['ΔCp_kJ_mol_per_K'];
    const A   = pka['davies_prefactor'];
    const zp  = pka['protonated_charge'];
    html += `        <div class="pka-item">
          <strong>pKa${pka.pKa_index}:</strong> ${formatValue(pka.pKa)}
`;
    if (dH  != null) html += `          <span class="pka-line">ΔH = ${formatValue(dH, 1)} kJ/mol</span>\n`;
    if (dCp != null) html += `          <span class="pka-line">ΔCp = ${formatValue(dCp, 3)} kJ/(mol·K)</span>\n`;
    if (A   != null) html += `          <span class="pka-line">Davies prefactor = ${formatValue(A, 3)}</span>\n`;
    if (zp  != null) html += `          <span class="pka-line">Protonated charge: ${zp > 0 ? '+' : ''}${zp}</span>\n`;
    html += `        </div>\n`;
  }

  html += `      </div>

      <h3>Chemical Shifts</h3>
`;

  for (const [nucleus, resonances] of Object.entries(buffer.chemical_shifts)) {
    html += `      <p><strong>${formatNucleus(nucleus)}</strong></p>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th rowspan="2">Resonance</th>
`;
    for (let i = 0; i < buffer.ionisation_states; i++) {
      html += `              <th colspan="3" class="group-header">State ${i}</th>\n`;
    }
    html += `            </tr>
            <tr>
`;
    for (let i = 0; i < buffer.ionisation_states; i++) {
      html += `              <th>δ (ppm)</th>
              <th>α<sub>T</sub> (ppm/K)</th>
              <th>α<sub>I</sub> (ppm/M)</th>
`;
    }
    html += `            </tr>
          </thead>
          <tbody>
`;
    for (const res of resonances) {
      const mult = res.multiplicity ? ` <small>(${res.multiplicity[0]})</small>` : '';
      html += `            <tr>
              <td><code>${res.resonance_id}</code>${mult}</td>
`;
      for (let i = 0; i < buffer.ionisation_states; i++) {
        const stateShift = res.limiting_shifts.find(ls => ls.ionisation_state === i);
        if (stateShift) {
          html += `              <td>${formatValue(stateShift.shift_ppm, 3)}</td>\n`;
          const aT = stateShift.temperature_coefficient_ppm_per_K;
          html += aT != null
            ? `              <td class="coeff-cell">${formatValue(aT, 5)}</td>\n`
            : `              <td class="empty-cell">–</td>\n`;
          const aI = stateShift.ionic_strength_coefficient_ppm_per_M;
          html += aI != null
            ? `              <td class="coeff-cell">${formatValue(aI, 3)}</td>\n`
            : `              <td class="empty-cell">–</td>\n`;
        } else {
          html += `              <td class="empty-cell">–</td>
              <td class="empty-cell">–</td>
              <td class="empty-cell">–</td>\n`;
        }
      }
      html += `            </tr>\n`;
    }
    html += `          </tbody>
        </table>
      </div>
`;
  }

  if (buffer.notes) {
    html += `      <p style="font-style:italic;color:var(--color-text-secondary)"><strong>Notes:</strong> ${buffer.notes}</p>\n`;
  }

  html += `      <div class="back-links">
        <a href="#top">↑ Back to top</a>
        <a href="${backToSampleHref}">↑ Back to ${sampleTitle}</a>
      </div>
    </div>
`;
}

html += `
    <div class="timestamp">Generated: ${new Date().toISOString().split('T')[0]}</div>
    </section>

    <footer class="app-footer">
      <p class="footer-affiliation">
        NMR pH calibration · <a href="https://waudbylab.org">Waudby Group</a> · UCL School of Pharmacy
      </p>
    </footer>
  </div>

</body>
</html>
`;

// Ensure docs directory exists
mkdirSync(join(rootDir, 'public/docs'), { recursive: true });

// Write output
const outputPath = join(rootDir, 'public/docs/buffers.html');
writeFileSync(outputPath, html);

console.log(`Generated: ${outputPath}`);
console.log(`  - ${db.samples.length} samples`);
console.log(`  - ${db.buffers.length} buffers`);
