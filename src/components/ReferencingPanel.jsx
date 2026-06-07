/**
 * ReferencingPanel component.
 * Three-way 1H referencing selector: DSS, solvent (water), or floating.
 * Heteronuclear referencing is always derived from 1H via IUPAC Xi ratios.
 */

import { useState, useEffect } from 'react';

/**
 * IUPAC Xi ratios relative to 1H = 1.0 (from BMRB/Iowa State).
 */
export const XI_RATIOS = {
  '1H': 1.0,
  '19F': 0.94094008,
  '31P': 0.404808636,
  '13C': 0.251449530,
  '15N': 0.101329118
};

/**
 * Calculate the temperature-dependent 1H water chemical shift on the DSS scale.
 * δ(H₂O) = 7.83 − T/96.9 ppm  (≈ 4.755 ppm at 298 K)
 *
 * @param {number} temperature - Temperature in Kelvin
 * @returns {number} Water chemical shift on DSS scale (ppm)
 */
export function calculateWaterShift(temperature) {
  return 7.83 - temperature / 96.9;
}

/**
 * Calculate the reference offset for a spectrum referenced to the solvent (water).
 * Bruker spectrometers place water at exactly 4.70 ppm; the true DSS-scale water
 * shift is temperature-dependent. The offset corrects from the 4.70 ppm convention
 * back to the DSS scale: offset = δ(H₂O, T) − 4.70 = 3.13 − T/96.9 ppm.
 *
 * @param {number} temperature - Temperature in Kelvin
 * @returns {number} Reference offset (ppm) to apply to all nuclei
 */
export function calculateWaterReference(temperature) {
  return 3.13 - temperature / 96.9;
}

/**
 * Calculate the spectrometer frequency for nucleus X given 1H frequency.
 */
export function calculateSpectrometerFrequency(nucleus, protonFrequencyMHz) {
  const xiRatio = XI_RATIOS[nucleus];
  if (!xiRatio) return null;
  return protonFrequencyMHz * xiRatio;
}

/**
 * Calculate the reference offset for nucleus X from 1H reference offset.
 * Uses IUPAC Xi ratios.  When no actual spectrometer frequency is provided,
 * the Xi approximation gives delta_X = delta_1H exactly.
 */
export function calculateLinkedReferenceOffset(nucleus, protonFrequencyMHz, protonReferenceOffsetPpm, nucleusFrequencyMHz = null) {
  if (nucleus === '1H') return protonReferenceOffsetPpm;

  const xiX = XI_RATIOS[nucleus];
  const xiH = XI_RATIOS['1H'];

  if (!xiX) return 0;

  const nuDSS_H = protonFrequencyMHz * (1 - protonReferenceOffsetPpm / 1e6);
  const nu0_X = nuDSS_H * (xiX / xiH);
  const bfX = nucleusFrequencyMHz || (protonFrequencyMHz * (xiX / xiH));
  return ((bfX - nu0_X) / bfX) * 1e6;
}

/**
 * Build referencing configuration for fitting.
 *
 * @param {Array<string>} nuclei - Nuclei that have observed shifts
 * @param {string|null} protonReferencing - '1H' referencing mode: 'dss' | 'water' | 'floating'
 * @param {number} dssShift - DSS chemical shift (used only for 'dss' mode)
 * @param {Object} spectrometerFreqs - nucleus -> MHz (optional, for precise Xi linking)
 * @param {number} temperature - Temperature in K (for water reference calculation)
 * @returns {Object} Referencing configuration for the fitting engine
 */
export function buildReferencingConfig(nuclei, protonReferencing, dssShift, spectrometerFreqs, temperature) {
  const config = {
    nucleusConfigs: {},
    linkedToProton: [],
    referenceOffsets: {},
    refineReferences: {},
    referenceBounds: {},
    // Always provide a proton frequency so Xi linking works; 600 MHz gives exact delta_X = delta_1H
    protonFrequency: spectrometerFreqs?.['1H'] || 600
  };

  const waterRef = calculateWaterReference(temperature);

  for (const nucleus of nuclei) {
    if (nucleus === '1H') {
      if (protonReferencing === 'dss') {
        config.nucleusConfigs['1H'] = { mode: 'dss' };
        config.referenceOffsets['1H'] = dssShift ?? 0;
        config.refineReferences['1H'] = false;
      } else if (protonReferencing === 'water') {
        // Reference offset is fixed from the temperature-dependent formula; no fitting needed
        config.nucleusConfigs['1H'] = { mode: 'water', waterRef };
        config.referenceOffsets['1H'] = waterRef;
        config.refineReferences['1H'] = false;
      } else {
        // floating
        config.nucleusConfigs['1H'] = { mode: 'floating' };
        config.referenceOffsets['1H'] = 0;
        config.refineReferences['1H'] = true;
        config.referenceBounds['1H'] = { min: -5, max: 5 };
      }
    } else {
      // Heteronucleus: always Xi-linked from 1H except in floating mode
      if (protonReferencing === 'floating') {
        config.nucleusConfigs[nucleus] = { mode: 'floating' };
        config.referenceOffsets[nucleus] = 0;
        config.refineReferences[nucleus] = true;
        config.referenceBounds[nucleus] = { min: -5, max: 5 };
      } else {
        // dss or water: offset = delta_1H via Xi (≈ exact without spectrometer freqs)
        const h1Offset = protonReferencing === 'dss' ? (dssShift ?? 0) : waterRef;
        config.nucleusConfigs[nucleus] = { mode: 'linked' };
        config.referenceOffsets[nucleus] = h1Offset;
        config.refineReferences[nucleus] = false;
        config.linkedToProton.push(nucleus);
      }
    }
  }

  return config;
}

/**
 * DSS shift input sub-component.
 */
function DSSShiftInput({ dssShift, onDSSShiftChange }) {
  const [text, setText] = useState(dssShift?.toString() ?? '0');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(dssShift?.toString() ?? '0');
  }, [dssShift, editing]);

  return (
    <div className="dss-shift-input inline">
      <label>
        DSS shift:
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setEditing(true);
            const parsed = parseFloat(e.target.value);
            if (!isNaN(parsed)) onDSSShiftChange(parsed);
          }}
          onBlur={() => {
            setEditing(false);
            const parsed = parseFloat(text);
            if (isNaN(parsed)) { setText('0'); onDSSShiftChange(0); }
            else { setText(parsed.toString()); onDSSShiftChange(parsed); }
          }}
          placeholder="0.00"
        />
        ppm
      </label>
    </div>
  );
}

/**
 * ReferencingPanel component.
 */
export function ReferencingPanel({
  nuclei,
  protonReferencing,
  dssShift,
  temperature,
  onProtonReferencingChange,
  onDSSShiftChange
}) {
  if (nuclei.length === 0) return null;

  const hasHeteronuclei = nuclei.some(n => n !== '1H');
  const waterShift = calculateWaterShift(temperature);
  const waterOffset = calculateWaterReference(temperature);

  return (
    <div className="referencing-panel compact">
      <h3>Chemical Shift Referencing</h3>

      <div className="referencing-step compact">
        <div className="step-row">
          <span className="step-question"><sup>1</sup>H referencing:</span>
          <div className="radio-group inline">
            <label>
              <input
                type="radio"
                name="protonRef"
                checked={protonReferencing === 'dss'}
                onChange={() => onProtonReferencingChange('dss')}
              />
              DSS
            </label>
            <label>
              <input
                type="radio"
                name="protonRef"
                checked={protonReferencing === 'water'}
                onChange={() => onProtonReferencingChange('water')}
              />
              Solvent (water)
            </label>
            <label>
              <input
                type="radio"
                name="protonRef"
                checked={protonReferencing === 'floating'}
                onChange={() => onProtonReferencingChange('floating')}
              />
              None (floating)
            </label>
          </div>

          {protonReferencing === 'dss' && (
            <DSSShiftInput dssShift={dssShift} onDSSShiftChange={onDSSShiftChange} />
          )}
        </div>

        {protonReferencing === 'dss' && (
          <div className="referencing-message">
            <span className="hint">
              Enter the observed DSS peak position (0 if the spectrum is already referenced to DSS).
            </span>
          </div>
        )}

        {protonReferencing === 'water' && (
          <div className="referencing-message">
            <span className="hint">
              Bruker places H<sub>2</sub>O at 4.70 ppm. At {Math.round(temperature)} K,
              δ(H<sub>2</sub>O) = 7.83 − <em>T</em>/96.9 = {waterShift.toFixed(3)} ppm (DSS scale);
              reference offset = {waterOffset >= 0 ? '+' : ''}{waterOffset.toFixed(3)} ppm.
            </span>
          </div>
        )}

        {protonReferencing === 'floating' && (
          <div className="referencing-message">
            <span className="hint">
              The reference offset is a free parameter in the fit (requires ≥2 independent buffer resonances).
            </span>
          </div>
        )}
      </div>

      {hasHeteronuclei && protonReferencing !== null && (
        <div className="referencing-message">
          <span className="hint">
            {protonReferencing === 'floating'
              ? 'Heteronuclear reference offsets are fitted independently.'
              : 'The same reference offset (in ppm) is applied to all nuclei, assuming spectrometer frequencies are set via IUPAC ξ ratios.'}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Reference configuration summary for results panel.
 */
export function ReferenceConfigSummary({
  nuclei,
  protonReferencing,
  dssShift,
  temperature,
  fittedReferenceOffsets
}) {
  const getStatusForNucleus = (nucleus) => {
    if (nucleus === '1H') {
      if (protonReferencing === 'dss') {
        return { status: 'Fixed', detail: `DSS at ${(dssShift ?? 0).toFixed(3)} ppm` };
      } else if (protonReferencing === 'water') {
        const waterShift = calculateWaterShift(temperature);
        const waterOffset = calculateWaterReference(temperature);
        return {
          status: 'Fixed',
          detail: `H₂O at ${waterShift.toFixed(3)} ppm → offset ${waterOffset >= 0 ? '+' : ''}${waterOffset.toFixed(3)} ppm`
        };
      } else {
        const fitted = fittedReferenceOffsets?.['1H'];
        if (fitted !== undefined) {
          return { status: 'Fitted', detail: `${fitted >= 0 ? '+' : ''}${fitted.toFixed(3)} ppm` };
        }
        return { status: 'Fitted', detail: 'independently' };
      }
    } else {
      if (protonReferencing === 'floating') {
        const fitted = fittedReferenceOffsets?.[nucleus];
        if (fitted !== undefined) {
          return { status: 'Fitted', detail: `${fitted >= 0 ? '+' : ''}${fitted.toFixed(3)} ppm` };
        }
        return { status: 'Fitted', detail: 'independently' };
      } else {
        const fitted = fittedReferenceOffsets?.[nucleus];
        if (fitted !== undefined) {
          return { status: 'Linked', detail: `${fitted >= 0 ? '+' : ''}${fitted.toFixed(3)} ppm (from ¹H via ξ)` };
        }
        return { status: 'Linked', detail: 'from ¹H via ξ ratio' };
      }
    }
  };

  return (
    <div className="reference-config-summary">
      <h4>Reference Configuration</h4>
      <table className="summary-table compact">
        <thead>
          <tr>
            <th>Nucleus</th>
            <th>Status</th>
            <th>Offset</th>
          </tr>
        </thead>
        <tbody>
          {nuclei.map(nucleus => {
            const info = getStatusForNucleus(nucleus);
            return (
              <tr key={nucleus}>
                <td>
                  <sup>{nucleus.match(/^\d+/)?.[0]}</sup>
                  {nucleus.replace(/^\d+/, '')}
                </td>
                <td>{info.status}</td>
                <td>{info.detail}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default ReferencingPanel;
