import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  MessageSquareOff,
  Radio,
  Send,
  ShieldAlert,
  Siren,
  Stamp,
} from 'lucide-react';
import {
  analyzeAndSanitizeMessage,
  evaluatePrcConditions,
} from '../lib/pactoAlgorithms';
import {
  appendEventoBitacora,
  appendMensajeProxy,
  appendWormAuditLog,
  subscribeMensajes,
  updateConvivenciaFields,
} from '../lib/pactoStore';
import type { ConvivenciaSession, MensajeProxy, SemaphoreLevel } from '../types/pacto';
import { HelpGlossaryButton } from './HelpGlossaryModal';
import { WorkspaceCaseNotaryView } from './WorkspaceCaseNotaryView';

interface Props {
  uid: string;
  sessions: ConvivenciaSession[];
  selectedId: string | null;
  onSelectId: (id: string) => void;
  lastAuditHash: string;
  isPrivilegedReader: boolean;
  onOpenIncidentDrawer: () => void;
  onExitProfile: () => void;
}

const SEMAPHORE_UAV: Record<SemaphoreLevel, number> = {
  VERDE: 0,
  AMARILLO: 1,
  ROJO: 4,
  PRC: 8,
};

const SEMAPHORE_LABELS: Record<SemaphoreLevel, string> = {
  VERDE: 'Verde · Nominal (0 UAV)',
  AMARILLO: 'Amarillo · Triage Preventivo (1 UAV)',
  ROJO: 'Rojo · Riesgo Crítico (4 UAV)',
  PRC: 'PRC · Enlace C5 Activo (8 UAV)',
};

const SAMPLE_MESSAGES: { label: string; role: 'CUSTODIO' | 'CONVIVIENTE'; text: string }[] = [
  {
    label: 'Logístico limpio',
    role: 'CONVIVIENTE',
    text: 'Estoy en camino por tráfico ligero, llegando al punto de entrega en 10 minutos.',
  },
  {
    label: 'Carga mixta (sanitizable)',
    role: 'CUSTODIO',
    text: 'Por tu culpa hay retraso de 15 minutos en la salida del parque.',
  },
  {
    label: 'Hostil / litigioso (bloqueado)',
    role: 'CUSTODIO',
    text: 'Siempre llegas tarde y voy a hablar con mi abogado para meter demanda en el juzgado.',
  },
];

export function MonitoristaView({
  uid,
  sessions,
  selectedId,
  onSelectId,
  lastAuditHash,
  isPrivilegedReader,
  onOpenIncidentDrawer,
  onExitProfile,
}: Props) {
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null,
    [sessions, selectedId]
  );

  const [mensajes, setMensajes] = useState<MensajeProxy[]>([]);
  const [senderRole, setSenderRole] = useState<'CUSTODIO' | 'CONVIVIENTE'>('CONVIVIENTE');
  const [messageInput, setMessageInput] = useState('');
  const [proxyFeedback, setProxyFeedback] = useState<{
    status: MensajeProxy['status'];
    guidance: string;
    detected: string[];
  } | null>(null);
  const [monTab, setMonTab] = useState<'consola' | 'workspace'>('consola');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSession) {
      setMensajes([]);
      return;
    }
    const unsub = subscribeMensajes(uid, activeSession.id, setMensajes, isPrivilegedReader);
    return () => unsub();
  }, [uid, activeSession?.id, isPrivilegedReader]);

  // MTAS-8 capacity calculations across active (non-closed) sessions
  const activeNonClosed = useMemo(
    () => sessions.filter((s) => s.fsmState !== 'STATE_4_CLOSED'),
    [sessions]
  );

  const greenSilentCount = useMemo(
    () => activeNonClosed.filter((s) => s.semaphore === 'VERDE').length,
    [activeNonClosed]
  );

  const visibleExceptionSessions = useMemo(
    () => activeNonClosed.filter((s) => s.semaphore !== 'VERDE'),
    [activeNonClosed]
  );

  const totalUavUsed = useMemo(
    () => activeNonClosed.reduce((acc, s) => acc + (s.uavCost ?? 0), 0),
    [activeNonClosed]
  );

  const prcCheck = useMemo(
    () => (activeSession ? evaluatePrcConditions(activeSession) : null),
    [activeSession]
  );

  const isClosed = activeSession?.fsmState === 'STATE_4_CLOSED';

  const handleSetSemaphore = async (level: SemaphoreLevel) => {
    if (!activeSession || isClosed) return;
    setBusyAction(`sem_${level}`);
    setStatusNotice(null);
    try {
      const nextFsm =
        level === 'ROJO' || level === 'AMARILLO' || level === 'PRC'
          ? 'STATE_3_TRIAGE'
          : activeSession.fsmState === 'STATE_3_TRIAGE'
          ? 'STATE_2_ACTIVE'
          : activeSession.fsmState;
      await updateConvivenciaFields(activeSession.id, {
        semaphore: level,
        uavCost: SEMAPHORE_UAV[level],
        fsmState: nextFsm,
        prcActivated: level === 'PRC' ? true : false,
      });
      await appendEventoBitacora({
        uid,
        convivenciaId: activeSession.id,
        category: level === 'VERDE' ? 'AZUL_CLARO' : 'MORADO',
        eventType: `MTAS8_SEMAFORO_${level}`,
        summary: `Monitorista CECOFAM ajustó semáforo MTAS-8 a ${SEMAPHORE_LABELS[level]}.`,
      });
      await appendWormAuditLog({
        uid,
        actorRole: 'MONITORISTA',
        folioFisico: activeSession.folioFisico,
        action: `CAMBIO_SEMAFORO_${level}`,
        justification: `Reasignación de capacidad MTAS-8 (${SEMAPHORE_UAV[level]} UAV) en sede ${activeSession.cecofamSede}.`,
        prevHash: lastAuditHash,
      });
      setStatusNotice(`Semáforo MTAS-8 actualizado a ${level} (${SEMAPHORE_UAV[level]} UAV).`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSimulateTriageCondition = async (
    kind: 'GPS_900' | 'CHAT_3' | 'PV_BLA_2' | 'RESET_TRIAGE'
  ) => {
    if (!activeSession || isClosed) return;
    setBusyAction(kind);
    setStatusNotice(null);
    try {
      if (kind === 'GPS_900') {
        await updateConvivenciaFields(activeSession.id, {
          fsmState: 'STATE_3_TRIAGE',
          semaphore: activeSession.semaphore === 'VERDE' ? 'ROJO' : activeSession.semaphore,
          uavCost: activeSession.semaphore === 'VERDE' ? 4 : activeSession.uavCost,
          gpsLossSeconds: 920,
          inShadowZone: false,
        });
        await appendEventoBitacora({
          uid,
          convivenciaId: activeSession.id,
          category: 'AZUL_CLARO',
          eventType: 'PERDIDA_GPS_920S',
          summary:
            'Pérdida continua de enlace GPS ≥ 900s (920s) fuera de Zona de Sombra M-MTS registrada en triage.',
        });
        setStatusNotice('Condición C2 registrada: GPS ≥ 900s fuera de zona de sombra.');
      } else if (kind === 'CHAT_3') {
        const nextCount = Math.max(3, activeSession.chatAttempts + 1);
        await updateConvivenciaFields(activeSession.id, {
          fsmState: 'STATE_3_TRIAGE',
          semaphore: activeSession.semaphore === 'VERDE' ? 'AMARILLO' : activeSession.semaphore,
          uavCost: activeSession.semaphore === 'VERDE' ? 1 : activeSession.uavCost,
          chatAttempts: nextCount,
        });
        await appendEventoBitacora({
          uid,
          convivenciaId: activeSession.id,
          category: 'CREMA',
          eventType: 'SILENCIO_PROXY_REITERADO',
          summary: `Acumulación de ${nextCount} intentos sin respuesta en Proxy de Chat Asimétrico.`,
        });
        setStatusNotice(`Condición C3 registrada: ${nextCount} intentos en Proxy Asimétrico.`);
      } else if (kind === 'PV_BLA_2') {
        const nextFail = Math.max(2, activeSession.pvBlaFailures + 1);
        await updateConvivenciaFields(activeSession.id, {
          fsmState: 'STATE_3_TRIAGE',
          semaphore: activeSession.semaphore === 'VERDE' ? 'ROJO' : activeSession.semaphore,
          uavCost: activeSession.semaphore === 'VERDE' ? 4 : activeSession.uavCost,
          pvBlaFailures: nextFail,
        });
        await appendEventoBitacora({
          uid,
          convivenciaId: activeSession.id,
          category: 'MORADO',
          eventType: 'FALLO_PV_BLA_REITERADO',
          summary: `Registrados ${nextFail} fallos consecutivos de Prueba de Vida Aleatoria (PV-BLA) sin respuesta acústica/óptica.`,
        });
        setStatusNotice(`Condición C4 registrada: ${nextFail} fallos PV-BLA.`);
      } else if (kind === 'RESET_TRIAGE') {
        await updateConvivenciaFields(activeSession.id, {
          fsmState: 'STATE_2_ACTIVE',
          semaphore: 'VERDE',
          uavCost: 0,
          gpsLossSeconds: 0,
          chatAttempts: 0,
          pvBlaFailures: 0,
          prcActivated: false,
        });
        await appendEventoBitacora({
          uid,
          convivenciaId: activeSession.id,
          category: 'AZUL_CLARO',
          eventType: 'RETORNO_NOMINAL_VERDE',
          summary: 'Restablecimiento de señales nominales; expediente regresa a invisibilidad operativa (0 UAV).',
        });
        setStatusNotice('Contadores de triage restablecidos y sesión devuelta a Estado Verde (0 UAV).');
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleActivatePrc = async () => {
    if (!activeSession || !prcCheck?.allMet || isClosed) return;
    setBusyAction('PRC_ACTIVATE');
    setStatusNotice(null);
    try {
      await updateConvivenciaFields(activeSession.id, {
        fsmState: 'STATE_3_TRIAGE',
        semaphore: 'PRC',
        uavCost: 8,
        prcActivated: true,
      });
      await appendEventoBitacora({
        uid,
        convivenciaId: activeSession.id,
        category: 'AZUL_CLARO',
        eventType: 'ACTIVACION_MANUAL_PRC_C5',
        summary: `Protocolo de Reacción Crítica (PRC) activado manualmente por Monitorista CECOFAM tras concurrencia 4/4. Paquete disociado emitido a C5 para folio ${activeSession.folioFisico}.`,
      });
      await appendWormAuditLog({
        uid,
        actorRole: 'MONITORISTA',
        folioFisico: activeSession.folioFisico,
        action: 'ACTIVACION_PRC_ENLACE_C5',
        justification:
          'Concurrencia determinista 4/4 verificada (Triage, GPS ≥ 900s sin sombra, ≥ 3 silencios proxy, ≥ 2 fallos PV-BLA).',
        prevHash: lastAuditHash,
      });
      setStatusNotice('Protocolo de Reacción Crítica (PRC) activado con despacho disociado a C5.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendProxyMessage = async () => {
    if (!activeSession || !messageInput.trim() || isClosed) return;
    setBusyAction('SEND_MSG');
    try {
      const analysis = analyzeAndSanitizeMessage(messageInput);
      await appendMensajeProxy({
        uid,
        convivenciaId: activeSession.id,
        senderRole,
        rawPreview: messageInput.trim(),
        cleanContent: analysis.cleanContent,
        status: analysis.status,
        hostileTokensCount: analysis.hostileTokensCount,
      });

      if (analysis.status !== 'RECHAZADO_HOSTIL') {
        await appendEventoBitacora({
          uid,
          convivenciaId: activeSession.id,
          category: 'CREMA',
          eventType:
            analysis.status === 'SANITIZADO_RETRANSMITIDO'
              ? 'PROXY_MENSAJE_SANITIZADO'
              : 'PROXY_MENSAJE_LOGISTICO',
          summary: `Mensaje de ${senderRole} procesado por Proxy Asimétrico (${analysis.status}): "${analysis.cleanContent}"`,
        });
      }

      setProxyFeedback({
        status: analysis.status,
        guidance: analysis.guidanceMessage,
        detected: analysis.detectedCategories,
      });
      setMessageInput('');
    } finally {
      setBusyAction(null);
    }
  };

  const monTabsBar = (
    <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200">
        <button
          type="button"
          onClick={() => setMonTab('consola')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
            monTab === 'consola'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Consola MTAS-8 y PRC</span>
        </button>
        <button
          type="button"
          onClick={() => setMonTab('workspace')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
            monTab === 'workspace'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Stamp className="w-3.5 h-3.5" />
          <span>Agenda, Docs y Notaría CSG</span>
        </button>
      </div>
      <span className="text-xs text-slate-500">
        Supervisión de visitas, fechas en Google Tasks y sellado CSG
      </span>
    </div>
  );

  if (monTab === 'workspace') {
    return (
      <div className="space-y-6">
        {monTabsBar}
        <WorkspaceCaseNotaryView
          uid={uid}
          actorRole="MONITORISTA"
          sessions={sessions}
          selectedId={selectedId}
          onSelectId={onSelectId}
          lastAuditHash={lastAuditHash}
          isPrivilegedReader={isPrivilegedReader}
        />
      </div>
    );
  }

  if (!activeSession) {
    return (
      <div className="space-y-6">
        {monTabsBar}
        <div className="max-w-lg mx-auto bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-4">
          <Activity className="w-8 h-8 text-slate-400 mx-auto" />
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Consola CECOFAM sin expedientes activos
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Los folios ingresan únicamente tras aprobación judicial en Cribado A-PACTO. Cuando exista
            un expediente activo aparecerá aquí para triage MTAS-8.
          </p>
          <button
            type="button"
            onClick={onExitProfile}
            className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            Volver al Selector de Perfil
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {monTabsBar}
      {/* Header + Folio selector */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Supervisión por Excepción · Modelo de Triage MTAS-8
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <h1 className="font-display text-xl font-semibold text-slate-900">
              Consola Monitorista CECOFAM ({activeSession.cecofamSede})
            </h1>
            <HelpGlossaryButton topic="mtas8" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-medium text-slate-600" htmlFor="mon-folio-select">
            Expediente:
          </label>
          <select
            id="mon-folio-select"
            value={activeSession.id}
            onChange={(e) => onSelectId(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                Folio {s.folioFisico} · {s.semaphore} ({s.uavCost} UAV)
              </option>
            ))}
          </select>
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

      {statusNotice && (
        <div className="bg-slate-900 text-white text-xs px-4 py-3 rounded-lg flex items-center justify-between gap-4">
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="text-slate-300 hover:text-white cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Top row: MTAS-8 Capacity Meter & Privacy Aggregation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Presupuesto Cognitivo MTAS-8
            </h2>
            <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
              {totalUavUsed} / 8 UAV
            </span>
          </div>
          <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                totalUavUsed >= 8
                  ? 'bg-red-700'
                  : totalUavUsed >= 4
                  ? 'bg-amber-600'
                  : 'bg-slate-900'
              }`}
              style={{ width: `${Math.min(100, (totalUavUsed / 8) * 100)}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <EyeOff className="w-3.5 h-3.5" />
                <span>Silencio Visual Activo</span>
              </div>
              <p className="font-mono text-xl font-semibold text-slate-900 mt-1 tabular-nums">
                {greenSilentCount}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Expedientes en Verde · 0 UAV · Invisibles al monitorista
              </p>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Excepciones en Consola</span>
              </div>
              <p className="font-mono text-xl font-semibold text-slate-900 mt-1 tabular-nums">
                {visibleExceptionSessions.length}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Amarillo (1 UAV) · Rojo (4 UAV) · PRC (8 UAV)
              </p>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3 space-y-2">
            <p className="text-xs font-medium text-slate-600">
              Cola de Excepciones Activas (sin sesiones nominales Verde)
            </p>
            {visibleExceptionSessions.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                Cero desviaciones en campo. Todos los expedientes activos operan en background silencioso.
              </p>
            ) : (
              <div className="space-y-2 max-h-44 overflow-y-auto">
                {visibleExceptionSessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onSelectId(s.id)}
                    className={`w-full text-left p-2.5 rounded-lg border text-xs flex items-center justify-between cursor-pointer ${
                      s.id === activeSession.id
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span className="font-mono font-medium text-slate-900">
                      Folio {s.folioFisico} · {s.cecofamSede}
                    </span>
                    <span className="font-mono font-semibold text-slate-700">
                      {s.semaphore} · {s.uavCost} UAV
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Selected Folio Triage & 4-Condition Deterministic PRC */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Despacho y Compuerta Determinista PRC · Folio {activeSession.folioFisico}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Estado actual: <span className="font-mono text-slate-800">{activeSession.fsmState}</span> ·{' '}
                Semáforo: <span className="font-mono text-slate-800">{activeSession.semaphore}</span>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {(['VERDE', 'AMARILLO', 'ROJO'] as SemaphoreLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  disabled={isClosed || busyAction !== null}
                  onClick={() => handleSetSemaphore(lvl)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer disabled:opacity-50 ${
                    activeSession.semaphore === lvl
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {lvl} ({SEMAPHORE_UAV[lvl]} UAV)
                </button>
              ))}
            </div>
          </div>

          {/* 4-Condition Gate */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-start gap-2.5">
              {prcCheck?.c1TriageState ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <AlertOctagon className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-xs font-semibold text-slate-900">1. Estado S3 Triage Activo</p>
                <p className="text-xs text-slate-600 mt-0.5 font-mono">{activeSession.fsmState}</p>
              </div>
            </div>

            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-start gap-2.5">
              {prcCheck?.c2GpsLoss900s ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <AlertOctagon className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-xs font-semibold text-slate-900">
                  2. Pérdida GPS ≥ 900s sin Sombra
                </p>
                <p className="text-xs text-slate-600 mt-0.5 font-mono">
                  {activeSession.gpsLossSeconds}s · Sombra: {activeSession.inShadowZone ? 'Sí' : 'No'}
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-start gap-2.5">
              {prcCheck?.c3ChatSilence3 ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <AlertOctagon className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-xs font-semibold text-slate-900">
                  3. Silencio Proxy Chat ≥ 3 intentos
                </p>
                <p className="text-xs text-slate-600 mt-0.5 font-mono">
                  {activeSession.chatAttempts} / 3 intentos
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-start gap-2.5">
              {prcCheck?.c4PvBlaFail2 ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              ) : (
                <AlertOctagon className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-xs font-semibold text-slate-900">4. Fallos PV-BLA ≥ 2</p>
                <p className="text-xs text-slate-600 mt-0.5 font-mono">
                  {activeSession.pvBlaFailures} / 2 fallos
                </p>
              </div>
            </div>
          </div>

          {/* Triage Simulation Controls */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={isClosed || busyAction !== null}
              onClick={() => handleSimulateTriageCondition('GPS_900')}
              className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
            >
              Simular GPS ≥ 900s (sin sombra)
            </button>
            <button
              type="button"
              disabled={isClosed || busyAction !== null}
              onClick={() => handleSimulateTriageCondition('CHAT_3')}
              className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
            >
              Registrar +1 silencio proxy
            </button>
            <button
              type="button"
              disabled={isClosed || busyAction !== null}
              onClick={() => handleSimulateTriageCondition('PV_BLA_2')}
              className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
            >
              Registrar fallo PV-BLA
            </button>
            <button
              type="button"
              disabled={isClosed || busyAction !== null}
              onClick={() => handleSimulateTriageCondition('RESET_TRIAGE')}
              className="px-3 py-1.5 text-xs bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer disabled:opacity-50"
            >
              Restablecer nominal
            </button>
          </div>

          {/* Manual PRC Activation + C5 Dissociated Output */}
          <div className="border-t border-slate-200 pt-4 flex flex-wrap items-center justify-between gap-4">
            <p className="text-xs text-slate-600 max-w-md">
              La activación del Protocolo de Reacción Crítica (PRC) nunca es automática: requiere
              decisión manual humana del Monitorista tras cumplirse las 4 condiciones deterministas.
            </p>
            <button
              type="button"
              disabled={isClosed || !prcCheck?.allMet || activeSession.prcActivated || busyAction !== null}
              onClick={handleActivatePrc}
              className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-2 cursor-pointer disabled:opacity-40 ${
                prcCheck?.allMet && !activeSession.prcActivated
                  ? 'bg-red-700 hover:bg-red-800 text-white'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              <Siren className="w-4 h-4" />
              <span>
                {activeSession.prcActivated
                  ? 'PRC Activado · C5 Enlazado'
                  : 'Activar PRC Manual (Enlace C5)'}
              </span>
            </button>
          </div>

          {activeSession.prcActivated && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-red-900">
                <Radio className="w-4 h-4" />
                <span>Paquete de Disociación de Metadatos Emitido a C5 (Cero Identidad Nominal)</span>
              </div>
              <pre className="text-xs font-mono text-red-950 bg-white/80 p-3 rounded border border-red-200 overflow-x-auto">
                {JSON.stringify(
                  {
                    folio_hash: activeSession.folioHash.slice(0, 24) + '...',
                    sede_origen: activeSession.cecofamSede,
                    ultima_coordenada: { lat: activeSession.lat, lng: activeSession.lng },
                    vestimenta_menor: activeSession.minorClothingDesc,
                    vehiculo_referencia: activeSession.vehicleDesc,
                    nota_privacidad: 'SIN NOMBRES · SIN BIOMETRÍA · SOLO DESPACHO TÁCTICO',
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Asymmetric Chat Proxy */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Proxy de Chat Asimétrico (Aislamiento Comunicacional)
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Analizador lexicográfico de hostilidad: bloquea mensajes de ataque o litigio y
              retransmite únicamente datos logísticos neutrales ($E_&#123;clean&#125;$).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {SAMPLE_MESSAGES.map((sample) => (
              <button
                key={sample.label}
                type="button"
                onClick={() => {
                  setSenderRole(sample.role);
                  setMessageInput(sample.text);
                }}
                className="px-2.5 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg cursor-pointer"
              >
                Probar: {sample.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-3">
            <div className="flex gap-2">
              {(['CONVIVIENTE', 'CUSTODIO'] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setSenderRole(role)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                    senderRole === role
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  Emisor: {role}
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              value={messageInput}
              disabled={isClosed}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder="Escribe un aviso logístico (ej. tráfico, retraso en minutos, punto de entrega)..."
              className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
            />
            <button
              type="button"
              disabled={isClosed || !messageInput.trim() || busyAction === 'SEND_MSG'}
              onClick={handleSendProxyMessage}
              className="w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Procesar por Proxy Lexicográfico</span>
            </button>

            {proxyFeedback && (
              <div
                className={`p-3 rounded-lg border text-xs space-y-1 ${
                  proxyFeedback.status === 'RECHAZADO_HOSTIL'
                    ? 'bg-red-50 border-red-200 text-red-900'
                    : proxyFeedback.status === 'SANITIZADO_RETRANSMITIDO'
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}
              >
                <p className="font-semibold">{proxyFeedback.status}</p>
                <p>{proxyFeedback.guidance}</p>
                {proxyFeedback.detected.length > 0 && (
                  <p className="font-mono text-[11px]">
                    Patrones filtrados: {proxyFeedback.detected.join(' · ')}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="lg:col-span-7 border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-3 max-h-80 overflow-y-auto">
            <p className="text-xs font-semibold text-slate-700">
              Flujo de Salida E_clean e Historial de Filtrado ({mensajes.length})
            </p>
            {mensajes.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                <MessageSquareOff className="w-5 h-5 text-slate-400 mx-auto mb-2" />
                Sin mensajes procesados en este expediente todavía.
              </div>
            ) : (
              <div className="space-y-2.5">
                {mensajes.map((m) => (
                  <div
                    key={m.id}
                    className="p-3 bg-white border border-slate-200 rounded-lg space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                      <span>{m.senderRole}</span>
                      <span
                        className={
                          m.status === 'RECHAZADO_HOSTIL'
                            ? 'text-red-700 font-semibold'
                            : m.status === 'SANITIZADO_RETRANSMITIDO'
                            ? 'text-amber-700 font-semibold'
                            : 'text-emerald-700 font-semibold'
                        }
                      >
                        {m.status} · tokens hostiles: {m.hostileTokensCount}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 line-through">
                      {m.status !== 'LOGISTICO_LIMPIO' ? `Entrada bruta: ${m.rawPreview}` : ''}
                    </p>
                    <p className="text-sm text-slate-900">
                      {m.status === 'RECHAZADO_HOSTIL'
                        ? '[Bloqueado en origen: no retransmitido al receptor]'
                        : m.cleanContent}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
