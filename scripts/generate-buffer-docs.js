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

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Read database
const dbPath = join(rootDir, 'public/database/database.json');
const db = JSON.parse(readFileSync(dbPath, 'utf-8'));

// Helper to format value with uncertainty
function formatValue(val, decimals = 2) {
  if (Array.isArray(val)) {
    return `${val[0].toFixed(decimals)} ± ${val[1].toFixed(decimals)}`;
  }
  return typeof val === 'number' ? val.toFixed(decimals) : val;
}

// Helper to format nucleus with superscript
function formatNucleus(nucleus) {
  const match = nucleus.match(/^(\d+)(\w+)$/);
  if (match) {
    return `<sup>${match[1]}</sup>${match[2]}`;
  }
  return nucleus;
}

// Build samples map
const samplesMap = new Map(db.samples.map(s => [s.sample_id, s]));

// Generate HTML
let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Buffer Database - NMR pH calibration</title>
  <link rel="stylesheet" href="./shared.css">
</head>
<body>
  <div class="page-container">
    <nav class="app-nav">
      <a href="../">Home</a>
      <a href="./">Docs</a>
      <a href="./buffers.html">Buffers</a>
      <a href="../plots/index.html">Data</a>
      <a href="https://github.com/waudbylab/nmr-pH">GitHub</a>
    </nav>

    <header class="app-header">
      <h1>Buffer Database</h1>
      <p class="subtitle">Comprehensive NMR buffer chemical shift database</p>
      <span class="version">v${db.database_version}</span>
    </header>

    <section>
    <div class="meta">
      <strong>Database Version:</strong> ${db.database_version} ·
      <strong>Last Updated:</strong> ${db.last_updated} ·
      <strong>Buffers:</strong> ${db.buffers.length} ·
      <strong>Samples:</strong> ${db.samples.length}
    </div>
`;

// Add buffers as H2 sections
for (const buffer of db.buffers) {
  const sample = samplesMap.get(buffer.sample_id);
  const nuclei = Object.keys(buffer.chemical_shifts);

  html += `    <h2>${buffer.buffer_name}`;

  if (nuclei.length > 0) {
    html += `<span class="nuclei-badges">`;
    for (const nucleus of nuclei) {
      html += `<span class="nucleus-badge">${formatNucleus(nucleus)}</span>`;
    }
    html += `</span>`;
  }

  html += `</h2>

    <div class="buffer-meta">
      <strong>Solvent:</strong> ${sample ? sample.solvent : 'Unknown'}<br>
      <strong>Ionisation States:</strong> ${buffer.ionisation_states}<br>
      <strong>Sample:</strong> <code>${buffer.sample_id}</code> (T<sub>ref</sub> = ${sample?.reference_temperature_K || 298} K)
    </div>

    <h3>Thermodynamic Parameters</h3>
    <div class="pka-section">
`;

  // pKa parameters
  for (const pka of buffer.pKa_parameters) {
    const dH   = pka['ΔH_kJ_mol'];
    const dCp  = pka['ΔCp_kJ_mol_per_K'];
    const A    = pka['davies_prefactor'];
    const zp   = pka['protonated_charge'];
    html += `      <div class="pka-item">
        <strong>pKa${pka.pKa_index}:</strong> ${formatValue(pka.pKa)}
`;
    if (dH != null) {
      html += `        <span class="pka-line">ΔH = ${formatValue(dH, 1)} kJ/mol</span>
`;
    }
    if (dCp != null) {
      html += `        <span class="pka-line">ΔCp = ${formatValue(dCp, 3)} kJ/(mol·K)</span>
`;
    }
    if (A != null) {
      html += `        <span class="pka-line">Davies prefactor = ${formatValue(A, 3)}</span>
`;
    }
    if (zp != null) {
      html += `        <span class="pka-line">Protonated charge: ${zp > 0 ? '+' : ''}${zp}</span>
`;
    }
    html += `      </div>
`;
  }

  html += `    </div>

    <h3>Chemical Shifts</h3>
`;

  // Chemical shifts table for each nucleus
  for (const [nucleus, resonances] of Object.entries(buffer.chemical_shifts)) {
    html += `    <p><strong>${formatNucleus(nucleus)}</strong></p>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th rowspan="2">Resonance</th>
`;

    // Add group headers for each ionisation state
    for (let i = 0; i < buffer.ionisation_states; i++) {
      html += `          <th colspan="3" class="group-header">State ${i}</th>
`;
    }

    html += `        </tr>
        <tr>
`;

    // Add sub-headers (δ, αT, αI) for each state
    for (let i = 0; i < buffer.ionisation_states; i++) {
      html += `          <th>δ (ppm)</th>
          <th>α<sub>T</sub> (ppm/K)</th>
          <th>α<sub>I</sub> (ppm/M)</th>
`;
    }

    html += `        </tr>
      </thead>
      <tbody>
`;

    for (const res of resonances) {
      const mult = res.multiplicity ? ` <small>(${res.multiplicity[0]})</small>` : '';
      html += `        <tr>
          <td><code>${res.resonance_id}</code>${mult}</td>
`;

      // Get shifts for each state with coefficients in separate columns
      for (let i = 0; i < buffer.ionisation_states; i++) {
        const stateShift = res.limiting_shifts.find(ls => ls.ionisation_state === i);
        if (stateShift) {
          html += `          <td>${formatValue(stateShift.shift_ppm, 3)}</td>
`;
          const alphaT = stateShift.temperature_coefficient_ppm_per_K;
          html += alphaT != null
            ? `          <td class="coeff-cell">${formatValue(alphaT, 5)}</td>\n`
            : `          <td class="empty-cell">-</td>\n`;
          const alphaI = stateShift.ionic_strength_coefficient_ppm_per_M;
          html += alphaI != null
            ? `          <td class="coeff-cell">${formatValue(alphaI, 3)}</td>\n`
            : `          <td class="empty-cell">-</td>\n`;
        } else {
          html += `          <td class="empty-cell">-</td>
          <td class="empty-cell">-</td>
          <td class="empty-cell">-</td>
`;
        }
      }

      html += `        </tr>
`;
    }

    html += `      </tbody>
      </table>
    </div>
`;
  }

  if (buffer.notes) {
    html += `    <p style="font-style: italic; color: var(--color-text-secondary);"><strong>Notes:</strong> ${buffer.notes}</p>
`;
  }
}

html += `    <div class="timestamp">
      Generated: ${new Date().toISOString().split('T')[0]}
    </div>
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
