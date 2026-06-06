import { useEffect, useRef } from 'react';
import SmilesDrawer from 'smiles-drawer';

export function SmilesDiagram({ smiles, width = 180, height = 130 }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!smiles || !svgRef.current) return;
    const drawer = new SmilesDrawer.SvgDrawer({ width, height, padding: 12, bondThickness: 0.7 });
    SmilesDrawer.parse(smiles, (tree) => {
      try {
        svgRef.current.innerHTML = '';
        drawer.draw(tree, svgRef.current, 'light');
      } catch (_) {}
    });
  }, [smiles, width, height]);

  if (!smiles) return null;
  return <svg ref={svgRef} width={width} height={height} style={{ display: 'block' }} />;
}

export default SmilesDiagram;
