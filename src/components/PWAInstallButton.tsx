import { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="min-h-[36px] px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>Instalar App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[36px] px-3 py-1.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0" />
          <span>Instalar en iOS</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <h3
                  id="ios-install-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  Instalar PACTO en iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                  aria-label="Cerrar instrucciones"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-xs text-slate-700 space-y-2 leading-relaxed list-decimal pl-4">
                <li>
                  Toca el botón <strong>Compartir</strong> en la barra inferior de Safari.
                </li>
                <li>
                  Desplázate hacia abajo y selecciona <strong>Agregar a inicio</strong>.
                </li>
                <li>
                  Abre PACTO desde tu pantalla de inicio para consultar expedientes en caché y registrar incidentes sin conexión.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[40px] py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
