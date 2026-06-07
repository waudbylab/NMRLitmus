import { Molecule } from 'openchemlib';

export function SmilesDiagram({ smiles, width = 180, height = 130 }) {
  if (!smiles) return null;

  let svg = null;
  try {
    const mol = Molecule.fromSmiles(smiles);
    mol.inventCoordinates();
    svg = mol.toSVG(width, height, null, { suppressChiralText: true });
  } catch (_) {
    return null;
  }

  return (
    <div
      style={{ display: 'block', width, height }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default SmilesDiagram;
