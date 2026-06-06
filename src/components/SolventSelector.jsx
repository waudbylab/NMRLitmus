import { useDatabase } from './DatabaseLoader';

const SOLVENT_LABELS = {
  '10pct_D2O': '10% D₂O / 90% H₂O',
  '100pct_D2O': '100% D₂O',
  'H2O': 'H₂O',
  'other': 'Other'
};

export function SolventSelector({ value, onChange }) {
  const { solvents } = useDatabase();

  return (
    <div className="solvent-selector">
      <label>Solvent System</label>
      <div className="solvent-cards">
        {solvents.map(solvent => (
          <button
            key={solvent}
            type="button"
            className={`solvent-card ${value === solvent ? 'selected' : ''}`}
            onClick={() => onChange(solvent)}
          >
            {SOLVENT_LABELS[solvent] || solvent}
          </button>
        ))}
      </div>
    </div>
  );
}

export default SolventSelector;
