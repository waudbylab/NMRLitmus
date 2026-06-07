import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { DatabaseLoader, useDatabase } from './components/DatabaseLoader';
import { SolventSelector } from './components/SolventSelector';
import { ConditionsPanel } from './components/ConditionsPanel';
import { BufferSelector } from './components/BufferSelector';
import { ReferencingPanel, buildReferencingConfig } from './components/ReferencingPanel';
import { NucleusTabPanel } from './components/NucleusTabPanel';
import { HeadlineResult } from './components/HeadlineResult';
import { ResultsPanel } from './components/ResultsPanel';
import { fitWithReassignment } from './numerical/fitting';
import { validateFitResult, validateDegreesOfFreedom } from './numerical/validation';
import './App.css';

/**
 * Main application content (requires DatabaseContext).
 */
function AppContent() {
  const { database, getNucleiForBuffers } = useDatabase();

  // State
  const [solvent, setSolvent] = useState('');
  const [selectedBufferIds, setSelectedBufferIds] = useState([]);
  const [temperature, setTemperature] = useState(298);
  const [ionicStrength, setIonicStrength] = useState(0.15);
  const [refineTemperature, setRefineTemperature] = useState(false);
  const [refineIonicStrength, setRefineIonicStrength] = useState(false);

  // Referencing state
  const [hasDSS, setHasDSS] = useState(null);
  const [dssShift, setDssShift] = useState(0);
  const [heteroReferencedToDSS, setHeteroReferencedToDSS] = useState(null);
  const [spectrometerFreqs, setSpectrometerFreqs] = useState({});

  // Data state
  const [observedShifts, setObservedShifts] = useState({});
  const [shiftLabels, setShiftLabels] = useState({});
  const [shiftUncertainties, setShiftUncertainties] = useState({});
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState(null);
  const [validation, setValidation] = useState(null);

  // Ref for debounce timer
  const calculateTimerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const resultsRef = useRef(null);

  // Scroll to results section
  const scrollToResults = useCallback(() => {
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Derived state
  const selectedBuffers = useMemo(() => {
    if (!database) return [];
    return selectedBufferIds
      .map(id => database.buffersMap.get(id))
      .filter(Boolean);
  }, [database, selectedBufferIds]);

  const nuclei = useMemo(() => {
    return getNucleiForBuffers(selectedBuffers);
  }, [selectedBuffers, getNucleiForBuffers]);

  // Count total observed shifts per nucleus
  const shiftCounts = useMemo(() => {
    const counts = {};
    for (const [nucleus, shifts] of Object.entries(observedShifts)) {
      counts[nucleus] = shifts?.length || 0;
    }
    return counts;
  }, [observedShifts]);

  const totalObservedShifts = useMemo(() => {
    return Object.values(observedShifts).reduce((sum, shifts) => sum + (shifts?.length || 0), 0);
  }, [observedShifts]);

  // Build referencing configuration based on current UI state
  // Filter to only include nuclei that actually have observed shifts
  const referencingConfig = useMemo(() => {
    if (hasDSS === null || nuclei.length === 0) {
      return null;
    }

    // Only include nuclei that have at least one observed shift
    const nucleiWithShifts = nuclei.filter(n =>
      observedShifts[n] && observedShifts[n].length > 0
    );

    if (nucleiWithShifts.length === 0) {
      return null;
    }

    return buildReferencingConfig(
      nucleiWithShifts,
      hasDSS,
      dssShift,
      heteroReferencedToDSS,
      spectrometerFreqs,
      temperature
    );
  }, [nuclei, hasDSS, dssShift, heteroReferencedToDSS, spectrometerFreqs, temperature, observedShifts]);

  // Create a modified config that uses fixed water reference when DOF is insufficient
  // Also track whether we're using assumed water referencing
  const { effectiveReferencingConfig, usingAssumedWaterRef } = useMemo(() => {
    if (!referencingConfig) {
      return { effectiveReferencingConfig: null, usingAssumedWaterRef: false };
    }

    // Check if we need to fix the water reference due to insufficient DOF
    if (hasDSS === false && referencingConfig.refineReferences['1H']) {
      // Count 1H shifts
      const h1Shifts = observedShifts['1H']?.length || 0;

      // If only 1 proton shift and we'd need to fit the reference, fix it instead
      if (h1Shifts === 1) {
        const fixedConfig = { ...referencingConfig };
        fixedConfig.refineReferences = { ...referencingConfig.refineReferences, '1H': false };
        // Keep the water reference value but mark it as fixed
        return { effectiveReferencingConfig: fixedConfig, usingAssumedWaterRef: true };
      }
    }

    return { effectiveReferencingConfig: referencingConfig, usingAssumedWaterRef: false };
  }, [referencingConfig, hasDSS, observedShifts]);

  // Validate degrees of freedom using the effective config
  const dofValidation = useMemo(() => {
    if (!effectiveReferencingConfig || totalObservedShifts === 0) {
      return null;
    }
    return validateDegreesOfFreedom(
      shiftCounts,
      effectiveReferencingConfig.refineReferences,
      effectiveReferencingConfig.linkedToProton,
      refineTemperature,
      refineIonicStrength
    );
  }, [effectiveReferencingConfig, shiftCounts, refineTemperature, refineIonicStrength, totalObservedShifts]);

  // Check if can calculate
  const canCalculate = useMemo(() => {
    if (selectedBuffers.length === 0) return false;
    if (totalObservedShifts === 0) return false;
    if (hasDSS === null) return false;
    if (!dofValidation || !dofValidation.valid) return false;
    return true;
  }, [selectedBuffers.length, totalObservedShifts, hasDSS, dofValidation]);

  // Determine if frequency inputs should be shown
  const showFrequencyInputs = useMemo(() => {
    const hasHeteronuclei = nuclei.some(n => n !== '1H');
    return hasHeteronuclei && hasDSS !== null && !(hasDSS && heteroReferencedToDSS);
  }, [nuclei, hasDSS, heteroReferencedToDSS]);

  // Perform calculation
  const performCalculation = useCallback(async () => {
    if (!canCalculate || !database || !effectiveReferencingConfig) return;

    // Cancel any previous calculation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setCalculating(true);

    try {
      // Use effective settings from DoF validation (may disable T/I refinement if insufficient DoF)
      const effectiveRefineTemp = dofValidation?.effectiveRefineTemperature ?? refineTemperature;
      const effectiveRefineIonic = dofValidation?.effectiveRefineIonicStrength ?? refineIonicStrength;

      const options = {
        refineTemperature: effectiveRefineTemp,
        refineIonicStrength: effectiveRefineIonic,
        refineReferences: effectiveReferencingConfig.refineReferences,
        referenceBounds: effectiveReferencingConfig.referenceBounds,
        linkedToProton: effectiveReferencingConfig.linkedToProton,
        protonFrequency: effectiveReferencingConfig.protonFrequency,
        spectrometerFreqs, // Pass all spectrometer frequencies for linked offset calculation
        shiftUncertainties: Object.keys(shiftUncertainties).length > 0 ? shiftUncertainties : undefined,
        shiftLabels: Object.keys(shiftLabels).length > 0 ? shiftLabels : undefined,
        initialPH: 7.0,
        useGridSearch: true
      };

      const conditions = {
        temperature,
        ionicStrength,
        referenceOffsets: effectiveReferencingConfig.referenceOffsets
      };

      // Get samples for selected buffers
      const sampleIds = [...new Set(selectedBuffers.map(b => b.sample_id))];
      const samples = sampleIds
        .map(id => database.samplesMap.get(id))
        .filter(Boolean);

      // Run fitting
      const fitResult = await new Promise((resolve) => {
        setTimeout(() => {
          const result = fitWithReassignment(
            observedShifts,
            selectedBuffers,
            database.samplesMap,
            conditions,
            options
          );
          resolve(result);
        }, 10);
      });

      // Check if aborted
      if (abortControllerRef.current?.signal.aborted) {
        return;
      }

      // Merge DoF validation warnings into the result
      if (fitResult.success && dofValidation?.warnings?.length > 0) {
        fitResult.warnings = [
          ...(dofValidation.warnings || []),
          ...(fitResult.warnings || [])
        ];
      }

      setResult(fitResult);

      // Validate result
      if (fitResult.success) {
        const validationResult = validateFitResult(fitResult, conditions, samples);
        setValidation(validationResult);
      } else {
        setValidation(null);
      }
    } catch (error) {
      if (!abortControllerRef.current?.signal.aborted) {
        console.error('Calculation error:', error);
        setResult({
          success: false,
          error: error.message
        });
        setValidation(null);
      }
    } finally {
      if (!abortControllerRef.current?.signal.aborted) {
        setCalculating(false);
      }
    }
  }, [
    canCalculate,
    database,
    selectedBuffers,
    observedShifts,
    shiftUncertainties,
    temperature,
    ionicStrength,
    refineTemperature,
    refineIonicStrength,
    effectiveReferencingConfig,
    dofValidation
  ]);

  // Auto-calculate with debounce when inputs change
  useEffect(() => {
    // Clear previous timer
    if (calculateTimerRef.current) {
      clearTimeout(calculateTimerRef.current);
    }

    // Clear results immediately when inputs change
    if (result) {
      setResult(null);
      setValidation(null);
    }

    // Only auto-calculate if we can
    if (!canCalculate) {
      return;
    }

    // Debounce the calculation
    calculateTimerRef.current = setTimeout(() => {
      performCalculation();
    }, 500);

    return () => {
      if (calculateTimerRef.current) {
        clearTimeout(calculateTimerRef.current);
      }
    };
  }, [
    canCalculate,
    observedShifts,
    shiftUncertainties,
    temperature,
    ionicStrength,
    refineTemperature,
    refineIonicStrength,
    effectiveReferencingConfig,
    spectrometerFreqs,
    dssShift
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle solvent change - reset buffer selection
  const handleSolventChange = useCallback((newSolvent) => {
    setSolvent(newSolvent);
    setSelectedBufferIds([]);
    setObservedShifts({});
    setShiftLabels({});
    setResult(null);
    setValidation(null);
  }, []);

  // Handle buffer selection change
  const handleBufferSelectionChange = useCallback((bufferIds) => {
    setSelectedBufferIds(bufferIds);
    setResult(null);
    setValidation(null);
  }, []);

  // Handle referencing changes
  const handleHasDSSChange = useCallback((value) => {
    setHasDSS(value);
    if (!value) {
      setHeteroReferencedToDSS(null);
    }
  }, []);

  const handleDSSShiftChange = useCallback((value) => {
    setDssShift(value);
  }, []);

  const handleHeteroReferencedChange = useCallback((value) => {
    setHeteroReferencedToDSS(value);
    if (value) {
      setSpectrometerFreqs({});
    }
  }, []);

  const handleSpectrometerFreqChange = useCallback((nucleus, freq) => {
    setSpectrometerFreqs(prev => ({
      ...prev,
      [nucleus]: freq
    }));
  }, []);

  // Handle shifts change
  const handleShiftsChange = useCallback((nucleus, shifts, labels = []) => {
    setObservedShifts(prev => ({ ...prev, [nucleus]: shifts }));
    setShiftLabels(prev => ({ ...prev, [nucleus]: labels }));
  }, []);

  // Handle shift uncertainty change
  const handleShiftUncertaintyChange = useCallback((nucleus, uncertainty) => {
    setShiftUncertainties(prev => ({
      ...prev,
      [nucleus]: uncertainty
    }));
  }, []);

  // Extract fitted reference offsets for display
  const fittedReferenceOffsets = useMemo(() => {
    if (!result?.success) return null;
    const offsets = {};
    if (result.conditions?.referenceOffsets) {
      Object.assign(offsets, result.conditions.referenceOffsets);
    }
    return offsets;
  }, [result]);

  return (
    <div className="app">
      <nav className="app-nav">
        <a href="./">Home</a>
        <a href="./docs/index.html">Theory</a>
        <a href="./docs/buffers.html">Reference data</a>
        <a href="./plots/index.html">Reference plots</a>
        <a href="./docs/contribute.html">Contributing</a>
        <div className="nav-right">
          <a href="https://waudbylab.org">Waudby Lab</a>
          <a href="https://github.com/waudbylab/nmr-pH" className="nav-github">
            <svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" fill="currentColor" style={{verticalAlign: 'middle', marginRight: '4px'}}>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            GitHub
          </a>
        </div>
      </nav>

      <header className="app-header">
        <h1>NMR pH calibration</h1>
        <p className="subtitle">
          pH estimation from chemical shifts
        </p>
        <span className="version">v0.1</span>
      </header>

      <main className="app-main">
        <section className="setup-section">
          <div className="setup-row">
            <SolventSelector value={solvent} onChange={handleSolventChange} />
            <ConditionsPanel
              temperature={temperature}
              ionicStrength={ionicStrength}
              refineTemperature={refineTemperature}
              refineIonicStrength={refineIonicStrength}
              onTemperatureChange={setTemperature}
              onIonicStrengthChange={setIonicStrength}
              onRefineTemperatureChange={setRefineTemperature}
              onRefineIonicStrengthChange={setRefineIonicStrength}
            />
          </div>

          <BufferSelector
            solvent={solvent}
            selectedBufferIds={selectedBufferIds}
            onSelectionChange={handleBufferSelectionChange}
          />

          {nuclei.length > 0 && (
            <ReferencingPanel
              nuclei={nuclei}
              hasDSS={hasDSS}
              dssShift={dssShift}
              heteroReferencedToDSS={heteroReferencedToDSS}
              temperature={temperature}
              onHasDSSChange={handleHasDSSChange}
              onDSSShiftChange={handleDSSShiftChange}
              onHeteroReferencedChange={handleHeteroReferencedChange}
            />
          )}

          {dofValidation && !dofValidation.valid && (
            <div className="dof-warning">
              <strong>Insufficient data:</strong> {dofValidation.message}
            </div>
          )}
        </section>

        {selectedBuffers.length > 0 && hasDSS !== null && (
          <section className="data-section">
            <HeadlineResult
              result={result}
              calculating={calculating}
              onScrollToResults={scrollToResults}
              usingAssumedWaterRef={usingAssumedWaterRef}
              temperature={temperature}
            />

            <NucleusTabPanel
              nuclei={nuclei}
              buffers={selectedBuffers}
              samplesMap={database.samplesMap}
              temperature={temperature}
              ionicStrength={ionicStrength}
              observedShifts={observedShifts}
              onShiftsChange={handleShiftsChange}
              shiftUncertainties={shiftUncertainties}
              onShiftUncertaintyChange={handleShiftUncertaintyChange}
              spectrometerFreqs={spectrometerFreqs}
              onSpectrometerFreqChange={handleSpectrometerFreqChange}
              showFrequencyInputs={showFrequencyInputs}
              fittedPH={result?.success ? result.parameters.pH.value : null}
              phUncertainty={result?.success ? result.parameters.pH.uncertainty : null}
              assignments={result?.success ? result.assignments : null}
              referenceOffsets={fittedReferenceOffsets ?? effectiveReferencingConfig?.referenceOffsets ?? {}}
              fittedReferenceOffsets={fittedReferenceOffsets ?? {}}
              hasDSS={hasDSS}
            />
          </section>
        )}

        {result && (
          <section className="results-section" ref={resultsRef}>
            <ResultsPanel
              result={result}
              validation={validation}
              conditions={{ temperature, ionicStrength }}
              buffers={selectedBuffers}
              samplesMap={database.samplesMap}
              observedShifts={observedShifts}
              nuclei={nuclei}
              hasDSS={hasDSS}
              dssShift={dssShift}
              heteroReferencedToDSS={heteroReferencedToDSS}
              spectrometerFreqs={spectrometerFreqs}
              fittedReferenceOffsets={fittedReferenceOffsets}
            />
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p className="footer-affiliation">
          <a href="https://waudbylab.org">Waudby Group</a>
          {' · '}
          <a href="https://www.ucl.ac.uk/pharmacy">UCL School of Pharmacy</a>
        </p>
      </footer>
    </div>
  );
}

/**
 * Main App component with database provider.
 */
function App() {
  return (
    <DatabaseLoader>
      <AppContent />
    </DatabaseLoader>
  );
}

export default App;
