# NMR pH Calibration

**[waudbylab.github.io/nmr-pH](https://waudbylab.github.io/nmr-pH/)**

Estimates sample pH from NMR buffer chemical shifts by nonlinear least-squares fitting of a thermodynamic model. Temperature, ionic strength, and chemical shift reference offsets can be refined simultaneously. Uncertainties are propagated via the fit Jacobian.

Buffer resonances from multiple nuclei (¹H, ¹⁹F, ³¹P) and multiple buffers can be combined in a single fit, overdetermining the problem. Observed shifts are assigned automatically to predicted resonances.

Buffer reference data are fitted to experimental titration data covering 283–320 K and ionic strengths up to 0.3 M, with pKa corrections using van't Hoff (temperature) and Davies/Debye-Hückel (ionic strength) equations.

## Contributing

Buffer data live in `data/` as YAML files. See the [contributing guide](https://waudbylab.github.io/nmr-pH/docs/contribute.html) for the format and submission process.

[Waudby Group](https://waudbylab.org), UCL School of Pharmacy
