import { getCode128Modules } from '@/services/barcodeEngine';

export default function Code128BarcodeGraphic({ value }) {
  const modules = getCode128Modules(value);
  return (
    <svg
      className="challan-barcode"
      viewBox={`0 0 ${modules.length} 40`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Code 128 barcode ${value}`}
      shapeRendering="crispEdges"
    >
      {modules.map((isBar, index) => isBar && (
        <rect key={index} x={index} y={0} width={1} height={34} fill="#111827" />
      ))}
      <text x={modules.length / 2} y="39" textAnchor="middle" fontSize="5" fill="#111827">{value}</text>
    </svg>
  );
}
