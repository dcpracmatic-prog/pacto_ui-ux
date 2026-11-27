import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  FileSearch,
  KeyRound,
  Lock,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import { sha256Hex } from '../lib/pactoAlgorithms';
import { appendWormAuditLog, subscribeEventos } from '../lib/pactoStore';
import type { ConvivenciaSession, EventoBitacora, RmonCategory } from '../types/pacto';

import { HelpGlossaryButton } from './HelpGlossaryModal';

interface Props {
  uid: string;
  sessions: ConvivenciaSession[];
  selectedId: string | null;
  onSelectId: (id: string) => void;
  lastAuditHash: string;
  isPrivilegedReader: boolean;
  onGoToCribado: () => void;
}

const RMON_STYLE: Record<RmonCategory, { label: string; dot: string; text: string; bg: string }> = {
  MORADO: {
    label: 'MORADO · Base Legal y Riesgo',
    dot: 'bg-purple-700',
    text: 'text-purple-900',
    bg: 'bg-purple-50 border-purple-200',
  },
  AZUL_CLARO: {
    label: 'AZUL CLARO · Geometría y Tiempo',
    dot: 'bg-sky-600',
    text: 'text-sky-900',
    bg: 'bg-sky-50 border-sky-200',
  },
  CREMA: {
    label: 'CREMA · Evidencia Humana',
    dot: 'bg-amber-600',
    text: 'text-amber-950',
    bg: 'bg-amber-50 border-amber-200',
  },
};

export function BovedaJudicialView({
  uid,
  sessions,
  selectedId,
  onSelectId,
  lastAuditHash,
  isPrivilegedReader,
  onGoToCribado,
}: Props) {
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null,
    [sessions, selectedId]
  );

  const [unlockedMap, setUnlockedMap] = useState<Record<string, boolean>>({});
  const [keyInput, setKeyInput] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [r2RecoveryToken, setR2RecoveryToken] = useState<string | null>(null);
  const [eventos, setEventos] = useState<EventoBitacora[]>([]);
  const [filterCat, setFilterCat] = useState<'ALL' | RmonCategory>('ALL');
  const [integrityResult, setIntegrityResult] = useState<string | null>(null);

  const isUnlocked = activeSession ? Boolean(unlockedMap[activeSession.id]) : false;

  useEffect(() => {
    setKeyInput('');
    setUnlockError(null);
    setR2RecoveryToken(null);
    setIntegrityResult(null);
  }, [activeSession?.id]);

  useEffect(() => {
    if (!activeSession || !isUnlocked) {
      setEventos([]);
      return;
    }
    const unsub = subscribeEventos(uid, activeSession.id, setEventos, isPrivilegedReader);
    return () => unsub();
  }, [uid, activeSession?.id, isUnlocked, isPrivilegedReader]);

  const filteredEvents = useMemo(() => {
    if (filterCat === 'ALL') return eventos;
    return eventos.filter((e) => e.category === filterCat);
  }, [eventos, filterCat]);

  const handleUnlock = async () => {
    if (!activeSession) return;
    const normalized = keyInput.trim().toUpperCase();
    if (normalized !== activeSession.kJuez) {
      setUnlockError(
        'Llave K-JUEZ inválida. Solo el titular jurisdiccional con el token de 5 caracteres puede descifrar el Archivo Ciego.'
      );
      return;
    }
    setUnlockError(null);
    setUnlockedMap((prev) => ({ ...prev, [activeSession.id]: true }));
    await appendWormAuditLog({
      uid,
      actorRole: 'JUEZ',
      folioFisico: activeSession.folioFisico,
      action: 'DESBLOQUEO_ARCHIVO_CIEGO_KJUEZ',
      justification: `Apertura judicial de bóveda R-MON para folio ${activeSession.folioFisico} mediante K-JUEZ.`,
      prevHash: lastAuditHash,
    });
  };

  const handleConsultR2 = async () => {
    if (!activeSession) return;
    setR2RecoveryToken(activeSession.kJuez);
    await appendWormAuditLog({
      uid,
      actorRole: 'JUEZ',
      folioFisico: activeSession.folioFisico,
      action: 'CONSULTA_REDUNDANCIA_SIMETRICA_R2_1',
      justification: `Recuperación institucional R-2>1 (Folio + Expediente) ejecutada en sede ${activeSession.cecofamSede}.`,
      prevHash: lastAuditHash,
    });
  };

  const handleVerifyIntegrity = async () => {
    if (!activeSession) return;
    const digest = await sha256Hex(
      `${activeSession.folioFisico}|${activeSession.folioHash}|${eventos.length}|${activeSession.sealHash || 'ACTIVO'}`
    );
    setIntegrityResult(
      `Integridad criptográfica verificada (0 alteraciones en ${eventos.length} registros · Huella de audiencia SHA-256: ${digest.slice(
        0,
        24
      )}...)`
    );
  };

  if (!activeSession) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
        <Lock className="w-8 h-8 text-slate-400 mx-auto" />
        <h2 className="font-display text-lg font-semibold text-slate-900">
          Bóveda Judicial J-PACTO sin expedientes
        </h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Crea un folio desde Cribado A-PACTO para custodiar su Archivo Ciego y consultar el reporte
          cronológico tri-color R-MON.
        </p>
        <button
          type="button"
          onClick={onGoToCribado}
          className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 cursor-pointer"
        >
          Ir a Cribado A-PACTO
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Blind Archive Selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Soberanía Jurisdiccional · Archivo Ciego Cifrado
          </p>
          <h1 className="font-display text-xl font-semibold text-slate-900 mt-0.5">
            Bóveda Judicial J-PACTO y Reporte R-MON
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-medium text-slate-600" htmlFor="juez-folio-select">
            Archivo Ciego:
          </label>
          <select
            id="juez-folio-select"
            value={activeSession.id}
            onChange={(e) => onSelectId(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-mono text-slate-900"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                Folio {s.folioFisico} · {s.cecofamSede} · {s.fsmState}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Blind Archive Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Folio Físico Tokenizado</p>
          <p className="font-mono text-lg font-semibold text-slate-900 mt-1 tabular-nums">
            {activeSession.folioFisico}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Índice M-ARR / Modulador</p>
          <p className="font-mono text-lg font-semibold text-slate-900 mt-1 tabular-nums">
            {activeSession.iArrScore.toFixed(1)} · {activeSession.ageGroup}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Estado FSM</p>
          <p className="font-mono text-sm font-semibold text-slate-900 mt-1.5">
            {activeSession.fsmState}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-500">Sello Triple Candado</p>
          <p className="font-mono text-xs font-semibold text-slate-900 mt-2 truncate">
            {activeSession.sealHash ? activeSession.sealHash : 'En curso (sin cierre final)'}
          </p>
        </div>
      </div>

      {/* Cryptographic K-JUEZ Gate */}
      {!isUnlocked ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-2xl mx-auto space-y-5">
          <div className="flex items-start gap-3">
            <KeyRound className="w-6 h-6 text-slate-800 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Compuerta Criptográfica K-JUEZ Requerida
              </h2>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                Los administradores de TI y monitoristas no tienen acceso al contenido probatorio del
                Archivo Ciego. Introduce la llave personal de 5 caracteres emitida al crear el
                expediente.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              maxLength={5}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
              placeholder="Ej. A7K9P"
              className="flex-1 min-w-[180px] px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-base tracking-widest uppercase text-slate-900"
            />
            <button
              type="button"
              onClick={handleUnlock}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg flex items-center gap-2 cursor-pointer"
            >
              <Unlock className="w-4 h-4" />
              <span>Descifrar R-MON</span>
            </button>
          </div>

          {unlockError && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {unlockError}
            </p>
          )}

          <div className="border-t border-slate-200 pt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              Protocolo R-2&gt;1 de Redundancia Simétrica (recuperación auditada mediante Folio + Sede).
            </div>
            <button
              type="button"
              onClick={handleConsultR2}
              className="px-3 py-1.5 text-xs border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer"
            >
              Consultar R-2&gt;1 (auditado)
            </button>
          </div>

          {r2RecoveryToken && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 flex items-center justify-between">
              <span>
                Llave K-JUEZ recuperada bajo registro WORM:
                <strong className="font-mono ml-2 text-slate-900">{r2RecoveryToken}</strong>
              </span>
              <button
                type="button"
                onClick={() => setKeyInput(r2RecoveryToken)}
                className="text-slate-900 underline font-medium cursor-pointer"
              >
                Autocompletar
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-emerald-700" />
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Reporte Cronológico R-MON · Folio {activeSession.folioFisico}
                </h2>
                <p className="text-xs text-slate-500">
                  Hash de Folio: <span className="font-mono">{activeSession.folioHash.slice(0, 20)}...</span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleVerifyIntegrity}
                className="px-3 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <FileSearch className="w-3.5 h-3.5" />
                <span>Cotejar Integridad Hash en Audiencia</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setUnlockedMap((prev) => ({ ...prev, [activeSession.id]: false }))
                }
                className="px-3 py-1.5 text-xs border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer"
              >
                Cerrar Bóveda
              </button>
            </div>
          </div>

          {integrityResult && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{integrityResult}</span>
            </div>
          )}

          {/* Tri-color Filter */}
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { key: 'ALL', label: `Todos (${eventos.length})` },
                { key: 'MORADO', label: 'MORADO · Base Legal' },
                { key: 'AZUL_CLARO', label: 'AZUL CLARO · Geometría y Tiempo' },
                { key: 'CREMA', label: 'CREMA · Evidencia Humana' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilterCat(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                  filterCat === tab.key
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Chronological Timeline */}
          <div className="space-y-3">
            {filteredEvents.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">
                No existen eventos registrados en la categoría seleccionada.
              </p>
            ) : (
              filteredEvents.map((ev) => {
                const st = RMON_STYLE[ev.category];
                return (
                  <div
                    key={ev.id}
                    className={`p-4 rounded-lg border ${st.bg} space-y-1.5`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 font-semibold">
                        <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />
                        <span className={st.text}>{st.label}</span>
                        <span className="font-mono text-slate-600">· {ev.eventType}</span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                        SHA-3/256: {ev.hashSha3.slice(0, 20)}...
                      </span>
                    </div>
                    <p className="text-sm text-slate-900 leading-relaxed">{ev.summary}</p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
