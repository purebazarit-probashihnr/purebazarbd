import { getBarcodeModules } from '@/services/barcodeEngine';

export default function BarcodeGraphic({ value }) {
  const modules = getBarcodeModules(value);
  const guard = modules.length === 95 || modules.length === 67;
  return (
    <svg
      className="barcode-graphic"
      viewBox={`0 0 ${modules.length} 52`}
      role="img"
      aria-label={`Barcode ${value}`}
      shapeRendering="crispEdges"
    >
      {modules.map((isBar, index) => isBar && (
        <rect
          key={index}
          x={index}
          y={0}
          width={1}
          height={guard && (index < 3 || (modules.length === 95 && index >= 45 && index < 50) || index >= modules.length - 3) ? 43 : 38}
          fill="#111827"
        />
      ))}
      <text x={modules.length / 2} y="51" textAnchor="middle" fontSize={modules.length > 130 ? '5' : '7'} fill="#111827">{value}</text>
    </svg>
  );
}
