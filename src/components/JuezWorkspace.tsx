import { useState } from 'react';
import { AlertTriangle, ClipboardCheck, Lock, Stamp } from 'lucide-react';
import { CribadoMonteCarloView } from './CribadoMonteCarloView';
import { BovedaJudicialView } from './BovedaJudicialView';
import { HelpGlossaryButton } from './HelpGlossaryModal';
import { WorkspaceCaseNotaryView } from './WorkspaceCaseNotaryView';
import type { ConvivenciaSession } from '../types/pacto';

interface Props {
  uid: string;
  sessions: ConvivenciaSession[];
  selectedId: string | null;
  onSelectId: (id: string) => void;
  lastAuditHash: string;
  isPrivilegedReader: boolean;
  onOpenIncidentDrawer: () => void;
}

export function JuezWorkspace({
  uid,
  sessions,
  selectedId,
  onSelectId,
  lastAuditHash,
  isPrivilegedReader,
  onOpenIncidentDrawer,
}: Props) {
  const [juezTab, setJuezTab] = useState<'cribado' | 'boveda' | 'workspace'>('cribado');

  return (
    <div className="space-y-6">
      {/* Segmented Judge App Mode Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setJuezTab('cribado')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
              juezTab === 'cribado'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>Cribado A-PACTO (Estado 0)</span>
          </button>
          <button
            type="button"
            onClick={() => setJuezTab('boveda')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
              juezTab === 'boveda'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Lock className="w-4 h-4" />
            <span>Bóveda Judicial J-PACTO (K-JUEZ)</span>
          </button>
          <button
            type="button"
            onClick={() => setJuezTab('workspace')}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
              juezTab === 'workspace'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Stamp className="w-4 h-4" />
            <span>Agenda, Docs y Notaría CSG</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <HelpGlossaryButton topic="cie" label="Sobre K-JUEZ" />
          <button
            type="button"
            onClick={onOpenIncidentDrawer}
            className="px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Reportar Incidencia</span>
          </button>
        </div>
      </div>

      {juezTab === 'cribado' ? (
        <CribadoMonteCarloView
          uid={uid}
          lastAuditHash={lastAuditHash}
          onCaseCreated={(convivenciaId) => {
            onSelectId(convivenciaId);
          }}
        />
      ) : juezTab === 'boveda' ? (
        <BovedaJudicialView
          uid={uid}
          sessions={sessions}
          selectedId={selectedId}
          onSelectId={onSelectId}
          lastAuditHash={lastAuditHash}
          isPrivilegedReader={isPrivilegedReader}
          onGoToCribado={() => setJuezTab('cribado')}
        />
      ) : (
        <WorkspaceCaseNotaryView
          uid={uid}
          actorRole="JUEZ"
          sessions={sessions}
          selectedId={selectedId}
          onSelectId={onSelectId}
          lastAuditHash={lastAuditHash}
          isPrivilegedReader={isPrivilegedReader}
        />
      )}
    </div>
  );
}
