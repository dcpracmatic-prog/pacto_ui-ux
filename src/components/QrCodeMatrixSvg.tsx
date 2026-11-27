import { useMemo } from 'react';
import QRCode from 'qrcode';

interface QrCodeMatrixSvgProps {
  value: string;
  className?: string;
  ariaLabel?: string;
}

export function QrCodeMatrixSvg({
  value,
  className = 'w-36 h-36',
  ariaLabel = 'Código QR de folio físico PACTO',
}: QrCodeMatrixSvgProps) {
  const matrix = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const data = qr.modules.data;
    const rects: { x: number; y: number }[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[y * size + x]) {
          rects.push({ x, y });
        }
      }
    }
    return { size, rects };
  }, [value]);

  const margin = 2;
  const viewBoxSize = matrix.size + margin * 2;

  return (
    <svg
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      role="img"
      aria-label={ariaLabel}
      shapeRendering="crispEdges"
      className={`${className} bg-white p-1.5 border border-slate-200 rounded-xl shrink-0`}
    >
      <rect width={viewBoxSize} height={viewBoxSize} fill="#FFFFFF" />
      {matrix.rects.map((cell) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          x={cell.x + margin}
          y={cell.y + margin}
          width={1}
          height={1}
          fill="#0F172A"
        />
      ))}
    </svg>
  );
}
