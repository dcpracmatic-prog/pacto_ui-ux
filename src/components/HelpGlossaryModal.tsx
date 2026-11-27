import { useState } from 'react';
import { HelpCircle, ShieldCheck, X } from 'lucide-react';

export type HelpTopicKey = 'tvi' | 'fblur' | 'zk' | 'arpa' | 'cie' | 'worm' | 'mtas8';

export const HELP_TOPICS: Record<
  HelpTopicKey,
  { title: string; summary: string; principle: string }
> = {
  tvi: {
    title: 'TVI — Testigo de Verificación Inmediata (RAM)',
    summary:
      'Extrae vectores geométricos temporales del rostro o voz únicamente en la memoria volátil (RAM) del dispositivo para validar la identidad del adulto sin tomar ni guardar fotografías o grabaciones.',
    principle: 'Cero biometría persistente · Los vectores se destruyen en milisegundos tras emitir el booleano.',
  },
  fblur: {
    title: 'F-BLUR — Degradación Óptica Destructiva (r = 36 px)',
    summary:
      'Antes de que cualquier imagen contextual salga del teléfono, se aplica un desenfoque gaussiano destructivo de 36 px y cifrado AES-256-GCM. Permite confirmar el tipo de entorno (parque, sala pública) haciendo imposible reconocer rostros o placas.',
    principle: 'Privacidad por diseño · Ninguna fotografía nítida toca el servidor ni la nube.',
  },
  zk: {
    title: 'Zero-Knowledge y Silencio Visual Activo',
    summary:
      'Durante el tránsito normal (Semáforo Verde, 0 UAV), ni el monitorista CECOFAM ni el otro progenitor observan mapas en tiempo real. La interfaz del conviviente permanece calma para proteger al menor.',
    principle: 'El menor ocupa el centro · Supervisión estrictamente por excepción.',
  },
  arpa: {
    title: 'A-RPA — Alerta de Retorno Empático Asistido',
    summary:
      'Calcula T_restante ≤ ETA_tráfico + Δt_resguardo para sugerir al conviviente el momento oportuno de regreso con un aviso amable y sin lenguaje punitivo.',
    principle: 'Prevención logística · Evita retrasos involuntarios y conflictos en el punto de entrega.',
  },
  cie: {
    title: 'Triple Candado T-GMC y Archivo Ciego (K-JUEZ)',
    summary:
      'El cierre de la sesión requiere concurrencia física (< 15 m), término temporal y validación simétrica. Al cerrar (S4), los datos locales se borran (Data Wipe) y el paquete solo puede descifrarse por el Juez con su llave K-JUEZ.',
    principle: 'Ceguera Pericial · Ni TI ni administradores leen el Archivo Ciego.',
  },
  worm: {
    title: 'Bitácora WORM y Cadena Merkle SHA-512',
    summary:
      'Cada evento administrativo, cambio de regla, asignación de rol o incidente genera un bloque encadenado criptográficamente (Write-Once-Read-Many) que el Auditor puede verificar sin posibilidad de alteración o borrado.',
    principle: 'Trazabilidad operativa inmutable · Segregación estricta de lectura para Auditoría.',
  },
  mtas8: {
    title: 'MTAS-8 — Presupuesto Cognitivo de Supervisión',
    summary:
      'Limita la carga del monitorista CECOFAM a un máximo de 8 Unidades de Atención Visual (UAV): Verde = 0 UAV (invisible), Amarillo = 1 UAV, Rojo = 4 UAV, PRC = 8 UAV con compuerta determinista de 4 condiciones.',
    principle: 'Atención humana enfocada donde existe una anomalía real verificable.',
  },
};

export function HelpGlossaryButton({
  topic,
  label,
}: {
  topic: HelpTopicKey;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const info = HELP_TOPICS[topic];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
        title={info.title}
        aria-label={`Explicación: ${info.title}`}
      >
        <HelpCircle className="w-4 h-4 shrink-0" />
        {label && <span>{label}</span>}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="glossary-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-slate-900 shrink-0" />
                <h3
                  id="glossary-modal-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  {info.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
                aria-label="Cerrar glosario"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">{info.summary}</p>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800">
              {info.principle}
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function EthicalFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white/80 py-3 px-4 text-center">
      <p className="text-xs text-slate-500">
        PACTO: Un compromiso donde el menor ocupa el centro.
      </p>
    </footer>
  );
}
