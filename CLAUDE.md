# CLAUDE.md - AI Assistant Guide for NMRLitmus

## Project Overview

This repository contains the development materials for NMRLitmus, a web application for quantitative pH from NMR chemical shifts. The app estimates sample pH, temperature, ionic strength, and chemical shift referencing from NMR indicator chemical shifts using nonlinear least-squares fitting.

**Project Status**: Active development. React/Vite app with numerical fitting, plots, and a YAML-driven indicator database.

**License**: MIT License (Waudby Group, UCL)

## Repository Structure

```
nmr-pH/
├── CLAUDE.md              # This file - AI assistant guidance
├── LICENSE                # MIT License
├── design.md              # Comprehensive development brief (START HERE)
├── draft-schema.json      # JSON Schema for buffer database validation
└── draft-database.json    # Sample database with example buffer data
```

## Key Files

### design.md
The primary design document containing:
- Complete project requirements and specifications
- User interface design with detailed component descriptions
- Technical architecture (React + Plotly.js + Vite)
- Numerical analysis module specifications
- Data flow and algorithm descriptions

**Always reference this file when implementing features.**

### draft-schema.json
JSON Schema (draft-07) defining the buffer database structure:
- `samples`: Experimental metadata (solvent, authors, calibration methods, measurement ranges)
- `buffers`: Buffer parameters (pKa values, chemical shifts, temperature/ionic strength dependencies)
- Values with uncertainties represented as `[value, uncertainty]` arrays

### draft-database.json
Example database with one complete buffer entry (Trifluoroethylamine) demonstrating:
- Multi-nucleus data (1H, 19F)
- Multiple ionisation states
- Temperature and ionic strength coefficients
- Proper uncertainty representation

## Planned Technology Stack

| Component | Technology |
|-----------|------------|
| Frontend Framework | React |
| Plotting | Plotly.js |
| Build Tool | Vite |
| Deployment | GitHub Pages |
| Database | JSON (fetched from GitHub) |

## Planned Code Architecture

```
src/
├── numerical/                    # Pure numerical analysis (no React/UI)
│   ├── bufferModel.js           # pKa corrections, shift predictions
│   ├── peakAssignment.js        # Automatic shift → buffer matching
│   ├── fitting.js               # Levenberg-Marquardt optimizer
│   ├── uncertainty.js           # Jacobian-based uncertainty propagation
│   └── validation.js            # Check DoF, extrapolation, etc.
│
├── components/                   # React UI components
│   ├── DatabaseLoader.jsx
│   ├── SolventSelector.jsx
│   ├── ConditionsPanel.jsx
│   ├── BufferSelector.jsx
│   ├── ReferencingPanel.jsx
│   ├── NucleusTabPanel.jsx
│   │   ├── ChemicalShiftPlot.jsx
│   │   └── ShiftInputArea.jsx
│   ├── CalculateButton.jsx
│   └── ResultsPanel/
│       ├── FittedParameters.jsx
│       ├── AssignmentsTable.jsx
│       ├── ResidualsDisplay.jsx
│       ├── CitationsSection.jsx
│       └── DownloadButtons.jsx
│
└── App.jsx                       # Main component, state orchestration
```

## Development Guidelines

### Code Organization Principles

1. **Separation of Concerns**: Keep numerical analysis code in `src/numerical/` completely independent of React/UI code
2. **Pure Functions**: All numerical operations should be pure functions with clear inputs/outputs
3. **Testability**: Numerical modules must be independently unit-testable
4. **Documentation**: Use JSDoc comments for all numerical functions

### Database Schema Guidelines

When modifying `draft-schema.json` or `draft-database.json`:

1. **Solvent Types**: Use enum values `10pct_D2O`, `100pct_D2O`, `H2O`, `other`
2. **Nucleus Labels**: Use standard NMR notation: `1H`, `13C`, `15N`, `19F`, `31P`
3. **Uncertainties**: Represent as `[value, uncertainty]` arrays OR single numbers when uncertainty is not available
4. **pKa Indexing**: Start from 1, with `pKa_index` corresponding to the deprotonation step
5. **Ionisation States**: Number from 0 (most protonated) to N (most deprotonated)

### Ionic Strength Models

Supported models for pKa correction:
- `davies`: Davies equation (default for most buffers)
- `extended_debye_huckel`: Extended Debye-Hückel with ion size parameter
- `empirical`: Empirical linear correction
- `none`: No ionic strength correction

### Numerical Implementation Notes

1. **Fitting Algorithm**: Levenberg-Marquardt for nonlinear least-squares
2. **Parameter Estimation**: pH always fitted; T, I, and reference offsets optionally refined
3. **Peak Assignment**: Automatic matching based on nearest predicted resonance with confidence scoring
4. **Uncertainty Propagation**: Jacobian-based calculation of parameter uncertainties

### UI Implementation Notes

1. **Debouncing**: 500ms debounce on chemical shift input and plot updates
2. **Visual Feedback**:
   - Horizontal lines for fitted pH
   - Shaded uncertainty bands
   - Color-coding by buffer
3. **Warnings**: Flag extrapolation, poor fits, ambiguous assignments

## Common Tasks

### Adding a New Buffer to the Database

1. Add sample metadata to `samples` array if new measurement source
2. Add buffer entry to `buffers` array following the schema:
   - Unique `buffer_id` (format: `author_year_buffername_solvent`)
   - Reference the `sample_id`
   - Include all pKa parameters with thermodynamic data
   - Add chemical shifts for each nucleus with limiting shifts per ionisation state

### Implementing a New UI Component

1. Create component in `src/components/`
2. Keep component focused on presentation/interaction
3. Pass data via props, use callbacks for state updates
4. No numerical calculations in components - call `src/numerical/` functions

### Adding a New Numerical Function

1. Add to appropriate module in `src/numerical/`
2. Write as pure function with documented parameters
3. Include JSDoc with parameter types and return values
4. Write unit tests

## Testing Strategy

- Unit tests for all `src/numerical/` functions
- Component tests for React UI elements
- Integration tests for fitting workflows
- Visual regression tests for plots (optional)

## Deployment

- GitHub Pages from main branch
- Automatic deployment on push
- Database JSON hosted in same repository
- DOI via Zenodo for citation

## Key Domain Concepts

### Chemical Shift pH Dependence

Buffer chemical shifts depend on ionisation state. For a buffer with multiple pKa values, the observed shift is a population-weighted average:

```
δ_obs = Σ(f_i × δ_i)
```

where `f_i` is the fraction in ionisation state `i` and `δ_i` is the limiting shift.

### pKa Temperature Dependence

Using van't Hoff equation with heat capacity correction:

```
pKa(T) = pKa(T_ref) + (ΔH/R)(1/T - 1/T_ref) + (ΔCp/R)(T_ref/T - 1 + ln(T/T_ref))
```

### pKa Ionic Strength Dependence

Using Davies equation or extended Debye-Hückel:

```
pKa(I) = pKa(I=0) + A·Δz²·(√I/(1+√I) - 0.3I)
```

where `Δz²` is the change in squared charge upon deprotonation.

## Useful Commands

```bash
# When the project is initialized:
npm install          # Install dependencies
npm run dev          # Start development server
npm run build        # Build for production
npm run test         # Run tests
npm run preview      # Preview production build
```

## Resources

- [Henderson-Hasselbalch Equation](https://en.wikipedia.org/wiki/Henderson%E2%80%93Hasselbalch_equation)
- [Debye-Hückel Theory](https://en.wikipedia.org/wiki/Debye%E2%80%93H%C3%BCckel_theory)
- [Plotly.js Documentation](https://plotly.com/javascript/)
- [React Documentation](https://react.dev/)
- [Vite Documentation](https://vitejs.dev/)

## Contact

Waudby Group, UCL School of Pharmacy
