# NMR pH Calibration

A web application for estimating sample pH, temperature, and ionic strength from NMR buffer chemical shifts.

**[Launch the app &rarr;](https://waudbylab.github.io/nmr-pH/)**

---

## Overview

NMR buffers have characteristic chemical shifts that vary predictably with pH, temperature, and ionic strength. This tool fits observed buffer resonances to a thermodynamic model using nonlinear least-squares optimisation, yielding accurate pH estimates with propagated uncertainties — directly from your NMR spectrum, without a pH meter.

Multiple buffers and nuclei can be used simultaneously, overdetermining the problem and improving accuracy. Temperature and ionic strength can be refined alongside pH if sufficient data is available.

## Features

- **Multi-buffer, multi-nucleus fitting** — combine ¹H, ¹⁹F, and ³¹P resonances from any number of buffers
- **Automatic peak assignment** — observed shifts are matched to predicted resonances automatically
- **Uncertainty propagation** — Jacobian-based confidence intervals on all fitted parameters
- **Temperature & ionic strength refinement** — optionally refined from nominal values
- **Chemical shift referencing** — supports DSS-referenced and unreferenced spectra; IUPAC Ξ ratios used to calculate heteronuclear references
- **Reference data plots** — browse titration curves and parameter summaries for all buffers in the [database](https://waudbylab.github.io/nmr-pH/plots/)
- **Citable output** — generates formatted citations for all buffer data used

## Available Buffers

| Buffer | Nuclei | Solvent |
|--------|--------|---------|
| Acetate | ¹H | D₂O, H₂O |
| Cacodylate | ¹H | D₂O, H₂O |
| DFHBA (2,6-difluoro-4-hydroxybenzoic acid) | ¹⁹F | D₂O |
| Formate | ¹H | D₂O, H₂O |
| HEPES | ¹H | H₂O |
| Imidazole | ¹H | D₂O, H₂O |
| Maleate | ¹H | D₂O, H₂O |
| Phosphate | ³¹P | D₂O, H₂O |
| Piperazine | ¹H | D₂O, H₂O |
| TFP (2,4,6-trifluorophenol) | ¹⁹F, ¹H | D₂O, H₂O |
| Tris | ¹H | D₂O, H₂O |

Buffer parameters are fitted to experimental titration data across a range of temperatures (283–320 K) and ionic strengths (0–0.3 M), using van't Hoff and Davies/Debye-Hückel corrections.

## How to Use

1. **Select your solvent** (10% D₂O, 100% D₂O, or H₂O)
2. **Set nominal conditions** — temperature and ionic strength
3. **Choose buffers** present in your sample
4. **Enter observed chemical shifts** for each buffer resonance
5. **Click Calculate** — pH (and optionally T, ionic strength, reference offsets) are returned with uncertainties

See the [Theory page](https://waudbylab.github.io/nmr-pH/docs/) for the underlying equations and fitting methodology.

## Contributing

Buffer data is stored as YAML files in `data/` and community contributions are welcome. See the [Contributing guide](https://waudbylab.github.io/nmr-pH/docs/contribute.html) for the data format and submission process.

## Development

```bash
npm install
npm run dev       # start development server
npm run build     # production build (also runs Julia data generation)
npm run test      # run unit tests
```

The numerical fitting code (`src/numerical/`) is framework-independent and fully unit-testable. Buffer reference data is compiled from YAML sources by a Julia script (`julia/fit-and-build.jl`) that fits thermodynamic models and generates the database and plots.

## License

MIT — [Waudby Group](https://waudbylab.org), UCL School of Pharmacy
