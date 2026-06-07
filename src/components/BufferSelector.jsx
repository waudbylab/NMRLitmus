import { useDatabase } from './DatabaseLoader';
import { getValue } from '../numerical/bufferModel';
import { SmilesDiagram } from './SmilesDiagram';

const NUCLEUS_LABELS = {
  '1H': { number: '1', element: 'H' },
  '13C': { number: '13', element: 'C' },
  '15N': { number: '15', element: 'N' },
  '19F': { number: '19', element: 'F' },
  '31P': { number: '31', element: 'P' }
};

function NucleusIcon({ nucleus }) {
  const label = NUCLEUS_LABELS[nucleus];
  if (!label) return <span className="nucleus-icon">{nucleus}</span>;
  return (
    <span className="nucleus-icon">
      <sup>{label.number}</sup>{label.element}
    </span>
  );
}

function BufferTile({ buffer, selected, onToggle }) {
  const nuclei = Object.keys(buffer.chemical_shifts);
  const pKaValues = buffer.pKa_parameters
    .map(p => getValue(p.pKa))
    .sort((a, b) => a - b);
  const pKaDisplay = pKaValues.length > 0
    ? `pKa ${pKaValues.map(v => v.toFixed(1)).join(', ')}`
    : '';

  return (
    <button
      className={`buffer-tile ${selected ? 'selected' : ''}`}
      onClick={() => onToggle(buffer.buffer_id)}
      type="button"
    >
      {buffer.smiles && (
        <div className="buffer-structure">
          <SmilesDiagram smiles={buffer.smiles} width={160} height={110} />
        </div>
      )}
      <div className="buffer-name">{buffer.buffer_name}</div>
      <div className="buffer-nuclei">
        {nuclei.map(n => (
          <NucleusIcon key={n} nucleus={n} />
        ))}
      </div>
      <div className="buffer-pka">{pKaDisplay}</div>
    </button>
  );
}

export function BufferSelector({ solvent, selectedBufferIds, onSelectionChange }) {
  const { getBuffersForSolvent } = useDatabase();
  const availableBuffers = getBuffersForSolvent(solvent);
  const sortedBuffers = [...availableBuffers].sort((a, b) =>
    a.buffer_name.localeCompare(b.buffer_name)
  );

  const handleToggle = (bufferId) => {
    if (selectedBufferIds.includes(bufferId)) {
      onSelectionChange(selectedBufferIds.filter(id => id !== bufferId));
    } else {
      onSelectionChange([...selectedBufferIds, bufferId]);
    }
  };

  if (!solvent) {
    return (
      <div className="buffer-selector disabled">
        <h3>Buffer Selection</h3>
        <p className="hint">Select a solvent first</p>
      </div>
    );
  }

  if (sortedBuffers.length === 0) {
    return (
      <div className="buffer-selector empty">
        <h3>Buffer Selection</h3>
        <p className="hint">No buffers available for this solvent</p>
      </div>
    );
  }

  const handleSelectAll = () => onSelectionChange(sortedBuffers.map(b => b.buffer_id));
  const handleClearAll  = () => onSelectionChange([]);

  return (
    <div className="buffer-selector">
      <h3>Buffer Selection</h3>
      <div className="buffer-selector-hint">
        <span className="hint">Click to select buffers ({selectedBufferIds.length} selected)</span>
        <span className="buffer-selector-actions">
          <button className="buffer-action-btn" onClick={handleSelectAll} type="button">Select all</button>
          <button className="buffer-action-btn" onClick={handleClearAll} type="button" disabled={selectedBufferIds.length === 0}>Clear</button>
        </span>
      </div>
      <div className="buffer-grid">
        {sortedBuffers.map(buffer => (
          <BufferTile
            key={buffer.buffer_id}
            buffer={buffer}
            selected={selectedBufferIds.includes(buffer.buffer_id)}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  );
}

export default BufferSelector;
