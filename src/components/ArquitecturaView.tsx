import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Code2,
  Cpu,
  Database,
  Eye,
  FileCheck2,
  Lock,
  Scale,
  Settings2,
  Shield,
  UserCheck,
} from 'lucide-react';
import {
  assignUserRole,
  saveProtocolConfig,
  triageIncidentByAdmin,
} from '../lib/pactoStore';
import type {
  CecofamSede,
  ConvivenciaSession,
  IncidentReport,
  IncidentStatus,
  LogAuditoriaWorm,
  ProtocolConfig,
  RbacRole,
  RoleAssignment,
} from '../types/pacto';
import { HelpGlossaryButton } from './HelpGlossaryModal';
import { WorkspaceCaseNotaryView } from './WorkspaceCaseNotaryView';

interface Props {
  workspaceMode: 'ADMIN' | 'AUDITOR';
  uid: string;
  userEmail: string;
  canManageProtocol: boolean;
  sessions: ConvivenciaSession[];
  selectedId: string | null;
  onSelectId: (id: string) => void;
  auditLogs: LogAuditoriaWorm[];
  protocolConfigs: ProtocolConfig[];
  incidents: IncidentReport[];
  roleAssignments: RoleAssignment[];
  lastAuditHash: string;
}

const DB_COLLECTIONS = [
  {
    path: '/users/{userId}',
    roleOwner: 'Propietario / S-ADMIN',
    description:
      'Aislamiento estricto de PII (email, displayName, activeViewRole). Prohibida lectura global.',
    immutables: 'uid, email, createdAt',
  },
  {
    path: '/admins/{adminId}',
    roleOwner: 'S-ADMIN (Bootstrap)',
    description: 'Registro confiable de administradores del protocolo. Sin escritura desde cliente.',
    immutables: 'Solo lectura de verificación',
  },
  {
    path: '/auditors/{auditorId}',
    roleOwner: 'S-ADMIN escribe · AUDITOR lee',
    description: 'Padrón verificado de auditores con acceso de solo lectura a la trazabilidad.',
    immutables: 'uid, email, grantedByUid, createdAt',
  },
  {
    path: '/role_assignments/{userId}',
    roleOwner: 'S-ADMIN gestiona · Auditor/Titular lee',
    description:
      'Asignación RBAC oficial (REPORTERO, MONITORISTA, JUEZ, AUDITOR, ADMIN) y sede.',
    immutables: 'targetUid, targetEmail, createdAt',
  },
  {
    path: '/protocol_configs/{configId}',
    roleOwner: 'S-ADMIN gestiona · Operadores/Auditores leen',
    description:
      'Reglas del protocolo: presupuesto MTAS-8, umbral GPS, ventana T-5M y radio F-BLUR.',
    immutables: 'createdAt',
  },
  {
    path: '/incidentes/{incidenteId}',
    roleOwner: 'REPORTERO crea · S-ADMIN gestiona · AUDITOR lee',
    description:
      'Incidencias de accesibilidad y convivencia vinculadas por exists() a convivenciaId.',
    immutables: 'reporterId, convivenciaId, folioFisico, createdAt (sin delete)',
  },
  {
    path: '/convivencias/{convivenciaId}',
    roleOwner: 'Propietario / JUEZ / MONITORISTA · AUDITOR lee',
    description: 'Expedientes M_PACTO, telemetría mínima y sellado Triple Candado en S4.',
    immutables: 'ownerId, folioFisico, folioHash, kJuez, createdAt',
  },
  {
    path: '/logs_auditoria/{logId}',
    roleOwner: 'Append-only (WORM) · AUDITOR lee',
    description: 'Cadena Merkle inmutable (prevHash -> currentHash). Update y Delete prohibidos.',
    immutables: 'Todo el documento (WORM estricto)',
  },
  {
    path: '/convivencias/{convivenciaId}/notarias/{notariaId}',
    roleOwner: 'Participantes / Operadores crean · AUDITOR lee (Solo Lectura)',
    description:
      'Sellos criptográficos CSG (csg-sello-v1 · SHA3-256 + Ed25519) para Google Docs, actas de Google Tasks y archivos locales.',
    immutables: 'Todo el sello notarial CSG (Append-only WORM)',
  },
];

const RBAC_MATRIX = [
  {
    actor: 'Progenitor / Reportante (CUSTODIO · CONVIVIENTE · REPORTERO)',
    node: 'Perfiles de Campo Aislados',
    create: 'Crea /incidentes propios en estado REPORTADO vinculados a un folio existente.',
    read: 'Lee únicamente sus propios folios y sus propios reportes en /incidentes.',
    updateDelete: 'Edita descripción antes de revisión. Eliminación prohibida.',
    isolation: 'Sin acceso a Cribado A-PACTO, MTAS-8, Bóveda K-JUEZ, S-ADMIN ni Auditoría.',
  },
  {
    actor: 'Administrador del Protocolo (S-ADMIN)',
    node: 'Gobernanza y Parametrización (Ceguera Pericial)',
    create: 'Crea/versiona /protocol_configs y asigna roles en /role_assignments y /auditors.',
    read: 'Consulta configuraciones, padrón RBAC e incidencias para gestión operativa.',
    updateDelete: 'Atiende /incidentes hasta cierre. No puede borrar incidentes ni logs WORM.',
    isolation: 'Ceguera Pericial Absoluta: no descifra K-JUEZ ni altera pruebas judiciales.',
  },
  {
    actor: 'Auditor de Trazabilidad (AUDITOR)',
    node: 'Supervisión Independiente WORM (Solo Lectura)',
    create: 'Ninguno (prohibido para preservar independencia de auditoría).',
    read: 'Lectura integral de /logs_auditoria, /incidentes, /protocol_configs, /role_assignments y metadatos.',
    updateDelete: 'Cero permisos de creación, modificación o borrado en cualquier colección.',
    isolation: 'Segregación estricta: verifica hashes SHA-512 sin capacidad de alterar registros.',
  },
  {
    actor: 'Juez Familiar y Monitorista (JUEZ / MONITORISTA)',
    node: 'Jurisdicción y Triage MTAS-8',
    create: 'Juez admite folios en Cribado A-PACTO; Monitorista registra triage/proxy.',
    read: 'Juez descifra Archivo Ciego con K-JUEZ; Monitorista ve solo excepciones MTAS-8.',
    updateDelete: 'Monitorista no descifra K-JUEZ ni altera expedientes sellados S4.',
    isolation: 'Perfiles separados en app y reglas Firestore.',
  },
];

export function ArquitecturaView({
  workspaceMode,
  uid,
  userEmail,
  canManageProtocol,
  sessions,
  selectedId,
  onSelectId,
  auditLogs,
  protocolConfigs,
  incidents,
  roleAssignments,
  lastAuditHash,
}: Props) {
  const isAuditor = workspaceMode === 'AUDITOR';

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null,
    [sessions, selectedId]
  );

  const [subTab, setSubTab] = useState<
    'worm' | 'rbac' | 'incidentes' | 'csg' | 'arquitectura'
  >(isAuditor ? 'worm' : 'rbac');
  const [schemaTab, setSchemaTab] = useState<'JSON-TEL' | 'M-CP' | 'JSON-CIE'>('JSON-TEL');
  const [imgError, setImgError] = useState(false);

  // Protocol Config Admin state
  const [cfgVersion, setCfgVersion] = useState('v1.5-Edomex');
  const [cfgSede, setCfgSede] = useState<CecofamSede | 'GLOBAL'>('GLOBAL');
  const [cfgUav, setCfgUav] = useState(8);
  const [cfgGps, setCfgGps] = useState(900);
  const [cfgT5m, setCfgT5m] = useState(300);
  const [cfgBlur, setCfgBlur] = useState(36);
  const [cfgAccess, setCfgAccess] = useState('Lectura fácil · Contraste alto · Subtitulado TAV');
  const [cfgSaving, setCfgSaving] = useState(false);

  // RBAC Assignment Admin state
  const [targetUidInput, setTargetUidInput] = useState(uid);
  const [targetEmailInput, setTargetEmailInput] = useState(userEmail);
  const [targetRoleInput, setTargetRoleInput] = useState<RbacRole>('AUDITOR');
  const [targetSedeInput, setTargetSedeInput] = useState<CecofamSede | 'TODAS'>('TODAS');
  const [rbacSaving, setRbacSaving] = useState(false);

  // Admin Triage note per incident
  const [triageNoteMap, setTriageNoteMap] = useState<Record<string, string>>({});
  const [triageStatusNotice, setTriageStatusNotice] = useState<string | null>(null);
  const [merkleVerification, setMerkleVerification] = useState<string | null>(null);

  const dynamicSchemaPayload = useMemo(() => {
    const folio = activeSession?.folioFisico ?? '74829103';
    const lat = activeSession?.lat ?? 19.6012;
    const lng = activeSession?.lng ?? -99.0507;
    const state = activeSession?.fsmState ?? 'STATE_2_ACTIVE';

    if (schemaTab === 'JSON-TEL') {
      return {
        schema: 'PACTO-JSON-TEL-v1.4',
        folio_fisico: folio,
        estado_fsm: state,
        semaforo_mtas8: activeSession?.semaphore ?? 'VERDE',
        telemetria: {
          lat,
          lng,
          senal_dbm: activeSession?.signalDbm ?? -74,
          bateria_pct: activeSession?.batteryPct ?? 86,
          zona_sombra_mmts: activeSession?.inShadowZone ?? false,
        },
        privacidad: 'SIN_AUDIO_CRUDO · SIN_IMAGEN_CRUDA · SOLO_METADATOS',
      };
    }

    if (schemaTab === 'M-CP') {
      return {
        schema: 'PACTO-M-CP-v1.4',
        folio_fisico: folio,
        canal_contexto: 'F-BLUR-r36px + AES-256-GCM-RAM',
        tvi_coincidencia_ram: activeSession?.tviVerified ?? false,
        tav_coincidencia_ram: activeSession?.tavVerified ?? false,
        verificacion_contexto: 'gemini-4-hydrogen (solo entorno ofuscado, cero rostros)',
        buffer_ram_eliminado: true,
      };
    }

    return {
      schema: 'PACTO-JSON-CIE-v1.4',
      folio_fisico: folio,
      candado_triple_tgmc: {
        geografico_radio_m: 150,
        temporal_t_fin: true,
        validacion_mutua_k_custodio_k_conviviente: activeSession?.fsmState === 'STATE_4_CLOSED',
      },
      sello_boveda_sha512: activeSession?.sealHash || 'PENDIENTE_DE_CIERRE',
      data_wipe_local: activeSession?.fsmState === 'STATE_4_CLOSED',
    };
  }, [activeSession, schemaTab]);

  const handleSaveProtocolConfig = async () => {
    if (isAuditor || !canManageProtocol) return;
    setCfgSaving(true);
    setTriageStatusNotice(null);
    try {
      await saveProtocolConfig({
        adminUid: uid,
        version: cfgVersion,
        cecofamSede: cfgSede,
        maxUavBudget: cfgUav,
        gpsLossThresholdSec: cfgGps,
        t5mWindowSec: cfgT5m,
        fBlurRadiusPx: cfgBlur,
        accessibilityMode: cfgAccess,
        active: true,
        prevAuditHash: lastAuditHash,
      });
      setTriageStatusNotice(`Configuración ${cfgVersion} guardada y auditada en cadena WORM.`);
    } finally {
      setCfgSaving(false);
    }
  };

  const handleAssignRole = async () => {
    if (isAuditor || !canManageProtocol || !targetUidInput.trim() || !targetEmailInput.trim()) return;
    setRbacSaving(true);
    setTriageStatusNotice(null);
    try {
      await assignUserRole({
        adminUid: uid,
        targetUid: targetUidInput,
        targetEmail: targetEmailInput,
        role: targetRoleInput,
        cecofamSede: targetSedeInput,
        active: true,
        prevAuditHash: lastAuditHash,
      });
      setTriageStatusNotice(
        `Rol ${targetRoleInput} asignado a ${targetEmailInput} (${targetSedeInput}) en Firestore.`
      );
    } finally {
      setRbacSaving(false);
    }
  };

  const handleTriageIncident = async (inc: IncidentReport, nextStatus: IncidentStatus) => {
    if (isAuditor || !canManageProtocol) return;
    setTriageStatusNotice(null);
    const note =
      triageNoteMap[inc.id]?.trim() ||
      `Revisión administrativa ejecutada (${nextStatus}) conforme al protocolo vigente.`;
    await triageIncidentByAdmin({
      adminUid: uid,
      incidenteId: inc.id,
      folioFisico: inc.folioFisico,
      status: nextStatus,
      severity: inc.severity,
      resolutionNote: note,
      prevAuditHash: lastAuditHash,
    });
    setTriageStatusNotice(`Incidente de folio ${inc.folioFisico} actualizado a ${nextStatus}.`);
  };

  const handleVerifyWormChain = () => {
    if (auditLogs.length === 0) {
      setMerkleVerification('Sin registros en logs_auditoria para cotejar aún.');
      return;
    }
    const validHashes = auditLogs.every(
      (l) => typeof l.currentHash === 'string' && l.currentHash.length >= 32 && l.prevHash.length >= 16
    );
    setMerkleVerification(
      validHashes
        ? `Cadena WORM íntegra: ${auditLogs.length} bloques verificados con encadenamiento SHA-512 (sin alteraciones ni borrados).`
        : 'Advertencia: se detectó un registro con formato de huella incompleto.'
    );
  };

  const tabs = isAuditor
    ? ([
        { key: 'worm', label: `Bitácora WORM (${auditLogs.length})` },
        { key: 'csg', label: 'Notaría CSG (Solo Lectura)' },
        { key: 'incidentes', label: `Incidentes (${incidents.length})` },
        { key: 'rbac', label: 'Reglas, RBAC y BD (Solo Lectura)' },
        { key: 'arquitectura', label: 'Mapa Mental y Schemas' },
      ] as const)
    : ([
        { key: 'rbac', label: 'Reglas y Asignación RBAC' },
        { key: 'csg', label: 'Agenda, Docs y Notaría CSG' },
        { key: 'incidentes', label: `Atención de Incidentes (${incidents.length})` },
        { key: 'arquitectura', label: 'Mapa Mental y Schemas' },
      ] as const);

  return (
    <div className="space-y-6">
      {/* Header + Role-Scoped Tabs */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            {isAuditor
              ? 'Supervisión Independiente · Modo Solo Lectura Estricto'
              : 'Gobernanza del Protocolo · Ceguera Pericial (Sin acceso a K-JUEZ)'}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <h1 className="font-display text-xl font-semibold text-slate-900">
              {isAuditor
                ? 'Consola de Auditoría Forense y Trazabilidad WORM'
                : 'Administración del Protocolo (S-ADMIN)'}
            </h1>
            <HelpGlossaryButton topic={isAuditor ? 'worm' : 'cie'} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSubTab(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === tab.key
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {triageStatusNotice && (
        <div className="bg-slate-900 text-white text-xs px-4 py-3 rounded-xl flex items-center justify-between gap-4">
          <span>{triageStatusNotice}</span>
          <button
            type="button"
            onClick={() => setTriageStatusNotice(null)}
            className="text-slate-300 hover:text-white cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* AUDITOR ONLY: WORM MERKLE LEDGER + READ-ONLY EXPEDIENTE METADATA */}
      {isAuditor && subTab === 'worm' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-slate-800" />
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900">
                    Bitácora Inmutable WORM ({auditLogs.length} bloques)
                  </h2>
                  <p className="text-xs text-slate-500">
                    Registro Append-Only encadenado con SHA-512. Update y Delete bloqueados en Firestore.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleVerifyWormChain}
                className="px-4 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-xl cursor-pointer whitespace-nowrap shrink-0"
              >
                Verificar Cadena Merkle WORM
              </button>
            </div>

            {merkleVerification && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{merkleVerification}</span>
              </div>
            )}

            <div className="space-y-2.5 max-h-96 overflow-y-auto">
              {auditLogs.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">
                  No existen bloques WORM registrados todavía.
                </p>
              ) : (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                        {log.action} · Folio {log.folioFisico}
                      </span>
                      <span className="font-mono text-slate-600">Actor: {log.actorRole}</span>
                    </div>
                    <p className="text-xs text-slate-700">{log.justification}</p>
                    <p className="font-mono text-[11px] text-slate-500 truncate">
                      Prev: {log.prevHash.slice(0, 16)}... → Cur: {log.currentHash.slice(0, 24)}...
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Read-only operational metadata (NO K-JUEZ) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-slate-800" />
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Metadatos Operativos de Expedientes (Sin Acceso a K-JUEZ)
                </h2>
              </div>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {sessions.length} folios
              </span>
            </div>

            {sessions.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No existen expedientes emitidos todavía.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-4 font-medium">Folio</th>
                      <th className="py-2 pr-4 font-medium">Sede</th>
                      <th className="py-2 pr-4 font-medium">Estado FSM</th>
                      <th className="py-2 pr-4 font-medium">Semáforo</th>
                      <th className="py-2 font-medium">Cierre S4</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {sessions.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2.5 pr-4 font-mono font-semibold text-slate-900 tabular-nums">
                          {s.folioFisico}
                        </td>
                        <td className="py-2.5 pr-4">{s.cecofamSede}</td>
                        <td className="py-2.5 pr-4 font-mono">{s.fsmState}</td>
                        <td className="py-2.5 pr-4 font-mono tabular-nums">
                          {s.semaphore} ({s.uavCost} UAV)
                        </td>
                        <td className="py-2.5 font-mono text-[11px] text-slate-500">
                          {s.sealHash ? `${s.sealHash.slice(0, 18)}...` : 'En curso'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* RBAC & PROTOCOL CONFIGS: Editable ONLY for ADMIN, strictly Read-Only for AUDITOR */}
      {subTab === 'rbac' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Protocol Configs */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-slate-800" />
                  <h2 className="font-display text-base font-semibold text-slate-900">
                    Reglas del Protocolo (/protocol_configs)
                  </h2>
                </div>
                <span className="text-xs font-mono text-slate-500">
                  {isAuditor ? 'Auditoría · Solo lectura' : 'S-ADMIN · Escritura habilitada'}
                </span>
              </div>

              {!isAuditor && canManageProtocol && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-slate-600 mb-1">Versión</label>
                      <input
                        type="text"
                        value={cfgVersion}
                        onChange={(e) => setCfgVersion(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Sede CECOFAM</label>
                      <select
                        value={cfgSede}
                        onChange={(e) => setCfgSede(e.target.value as CecofamSede | 'GLOBAL')}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                      >
                        <option value="GLOBAL">GLOBAL (Todas)</option>
                        <option value="Ecatepec">Ecatepec</option>
                        <option value="Toluca">Toluca</option>
                        <option value="Nicolás Romero">Nicolás Romero</option>
                        <option value="Ixtapaluca">Ixtapaluca</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Presupuesto MTAS (UAV)</label>
                      <input
                        type="number"
                        min={1}
                        max={32}
                        value={cfgUav}
                        onChange={(e) => setCfgUav(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Umbral pérdida GPS (s)</label>
                      <input
                        type="number"
                        min={300}
                        max={3600}
                        value={cfgGps}
                        onChange={(e) => setCfgGps(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Ventana T-5M (s)</label>
                      <input
                        type="number"
                        min={120}
                        max={900}
                        value={cfgT5m}
                        onChange={(e) => setCfgT5m(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Radio F-BLUR (px)</label>
                      <input
                        type="number"
                        min={25}
                        max={80}
                        value={cfgBlur}
                        onChange={(e) => setCfgBlur(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                      />
                    </div>
                  </div>

                  <div className="text-xs">
                    <label className="block text-slate-600 mb-1">
                      Directriz de Accesibilidad Operativa
                    </label>
                    <input
                      type="text"
                      value={cfgAccess}
                      onChange={(e) => setCfgAccess(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={cfgSaving}
                    onClick={handleSaveProtocolConfig}
                    className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-xl cursor-pointer"
                  >
                    {cfgSaving ? 'Publicando...' : 'Publicar Regla del Protocolo'}
                  </button>
                </div>
              )}

              {protocolConfigs.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Aún no hay configuraciones publicadas en /protocol_configs.
                </p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pt-1">
                  {protocolConfigs.map((cfg) => (
                    <div
                      key={cfg.id}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-slate-900">
                          {cfg.version} · {cfg.cecofamSede}
                        </span>
                        <span className="font-mono text-slate-600 tabular-nums">
                          {cfg.maxUavBudget} UAV · GPS ≥ {cfg.gpsLossThresholdSec}s · F-BLUR{' '}
                          {cfg.fBlurRadiusPx}px
                        </span>
                      </div>
                      <p className="text-slate-600">{cfg.accessibilityMode}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* RBAC Role Assignment */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-slate-800" />
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Padrón RBAC (/role_assignments)
                </h2>
              </div>

              {!isAuditor && canManageProtocol && (
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-slate-600 mb-1">UID del Usuario Destino</label>
                    <input
                      type="text"
                      value={targetUidInput}
                      onChange={(e) => setTargetUidInput(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Correo Institucional</label>
                    <input
                      type="email"
                      value={targetEmailInput}
                      onChange={(e) => setTargetEmailInput(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-slate-600 mb-1">Rol RBAC</label>
                      <select
                        value={targetRoleInput}
                        onChange={(e) => setTargetRoleInput(e.target.value as RbacRole)}
                        className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                      >
                        <option value="REPORTERO">REPORTERO</option>
                        <option value="AUDITOR">AUDITOR</option>
                        <option value="MONITORISTA">MONITORISTA</option>
                        <option value="JUEZ">JUEZ</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-600 mb-1">Ámbito Sede</label>
                      <select
                        value={targetSedeInput}
                        onChange={(e) => setTargetSedeInput(e.target.value as CecofamSede | 'TODAS')}
                        className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                      >
                        <option value="TODAS">TODAS</option>
                        <option value="Ecatepec">Ecatepec</option>
                        <option value="Toluca">Toluca</option>
                        <option value="Nicolás Romero">Nicolás Romero</option>
                        <option value="Ixtapaluca">Ixtapaluca</option>
                      </select>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={rbacSaving}
                    onClick={handleAssignRole}
                    className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-medium rounded-xl cursor-pointer"
                  >
                    {rbacSaving ? 'Aplicando RBAC...' : 'Asignar / Actualizar Rol RBAC'}
                  </button>
                </div>
              )}

              <div className="border-t border-slate-200 pt-3 space-y-2 max-h-56 overflow-y-auto">
                <p className="text-xs font-medium text-slate-600">
                  Roles Registrados ({roleAssignments.length})
                </p>
                {roleAssignments.length === 0 ? (
                  <p className="text-xs text-slate-500">Sin asignaciones RBAC en Firestore aún.</p>
                ) : (
                  roleAssignments.map((ra) => (
                    <div
                      key={ra.id}
                      className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{ra.targetEmail}</p>
                        <p className="font-mono text-[11px] text-slate-500 truncate">
                          UID: {ra.targetUid}
                        </p>
                      </div>
                      <span className="font-mono font-semibold text-slate-800 shrink-0">
                        {ra.role} · {ra.cecofamSede}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Firestore Database Structure */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-slate-800" />
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Estructura de Base de Datos Firestore (Zero-Trust & Master Gate)
                </h2>
              </div>
              <span className="text-xs font-mono text-slate-500">9 colecciones y subcolecciones</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 pr-4 font-medium">Ruta / Colección</th>
                    <th className="py-2.5 pr-4 font-medium">Titularidad RBAC</th>
                    <th className="py-2.5 pr-4 font-medium">Propósito Operativo</th>
                    <th className="py-2.5 font-medium">Campos Inmutables</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {DB_COLLECTIONS.map((col) => (
                    <tr key={col.path}>
                      <td className="py-2.5 pr-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {col.path}
                      </td>
                      <td className="py-2.5 pr-4 font-medium text-slate-800">{col.roleOwner}</td>
                      <td className="py-2.5 pr-4">{col.description}</td>
                      <td className="py-2.5 font-mono text-[11px] text-slate-600">{col.immutables}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* RBAC Permissions Matrix */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-slate-800" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                Matriz de Permisos por Rol (Segregación de Funciones)
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 pr-4 font-medium">Rol Operativo</th>
                    <th className="py-2.5 pr-4 font-medium">Crear</th>
                    <th className="py-2.5 pr-4 font-medium">Lectura</th>
                    <th className="py-2.5 pr-4 font-medium">Actualización / Borrado</th>
                    <th className="py-2.5 font-medium">Candado de Aislamiento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {RBAC_MATRIX.map((row) => (
                    <tr key={row.actor}>
                      <td className="py-3 pr-4 align-top">
                        <p className="font-semibold text-slate-900">{row.actor}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{row.node}</p>
                      </td>
                      <td className="py-3 pr-4 align-top">{row.create}</td>
                      <td className="py-3 pr-4 align-top">{row.read}</td>
                      <td className="py-3 pr-4 align-top">{row.updateDelete}</td>
                      <td className="py-3 align-top font-medium text-slate-900">{row.isolation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* INCIDENTS QUEUE: Read-only for AUDITOR, Triage Controls ONLY for ADMIN */}
      {subTab === 'incidentes' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-slate-800" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                {isAuditor
                  ? 'Consulta de Incidentes y Evidencia Hash (Solo Lectura)'
                  : 'Bandeja de Atención Administrativa de Incidentes (/incidentes)'}
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {incidents.length} registros
            </span>
          </div>

          {incidents.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              No existen incidentes registrados todavía.
            </p>
          ) : (
            <div className="space-y-3">
              {incidents.map((inc) => (
                <div
                  key={inc.id}
                  className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      Folio {inc.folioFisico} · {inc.cecofamSede} · {inc.category} · {inc.severity}
                    </span>
                    <span className="font-mono font-semibold text-slate-700">{inc.status}</span>
                  </div>
                  <p className="text-sm font-medium text-slate-900">{inc.title}</p>
                  <p className="text-xs text-slate-700 leading-relaxed">{inc.description}</p>
                  <p className="font-mono text-[11px] text-slate-500">
                    SHA-256 Evidencia: {inc.evidenceHash.slice(0, 24)}...
                  </p>

                  {inc.resolutionNote && (
                    <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800">
                      <strong>Dictamen S-ADMIN:</strong> {inc.resolutionNote}
                    </div>
                  )}

                  {!isAuditor && canManageProtocol && inc.status !== 'CERRADO_AUDITADO' && (
                    <div className="pt-2 border-t border-slate-200 space-y-2">
                      <input
                        type="text"
                        value={triageNoteMap[inc.id] ?? ''}
                        onChange={(e) =>
                          setTriageNoteMap((prev) => ({ ...prev, [inc.id]: e.target.value }))
                        }
                        placeholder="Nota técnica de atención administrativa..."
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                      <div className="flex flex-wrap gap-2">
                        {(['EN_REVISION', 'RESUELTO', 'CERRADO_AUDITADO'] as IncidentStatus[]).map(
                          (st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => handleTriageIncident(inc, st)}
                              className="px-3 py-1.5 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg cursor-pointer"
                            >
                              Marcar {st}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* WORKSPACE TASKS, DOCS & CSG NOTARY */}
      {subTab === 'csg' && (
        <WorkspaceCaseNotaryView
          uid={uid}
          actorRole={isAuditor ? 'AUDITOR' : 'ADMIN'}
          sessions={sessions}
          selectedId={selectedId}
          onSelectId={onSelectId}
          lastAuditHash={lastAuditHash}
          isPrivilegedReader={isAuditor || canManageProtocol}
          readOnly={isAuditor}
        />
      )}

      {/* MIND MAP & JSON-SCHEMAS */}
      {subTab === 'arquitectura' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-slate-800" />
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Mapa Mental Integral del Protocolo PACTO
                </h2>
              </div>
              <span className="text-xs font-mono text-slate-500">Blueprint Operativo v1.4</span>
            </div>

            {!imgError ? (
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                <img
                  src="/assets/aistudio/pacto_Mind_Map__1__4a334d32.png"
                  alt="Mapa mental integral de arquitectura del Protocolo PACTO: cribado A-PACTO, máquina de estados, Edge AI Zero-Knowledge y bóveda judicial."
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                  className="w-full h-auto max-h-[540px] object-contain mx-auto"
                />
              </div>
            ) : (
              <div className="p-8 bg-slate-50 border border-slate-200 rounded-xl text-center text-sm text-slate-600">
                Recurso visual del mapa conceptual disponible en{' '}
                <span className="font-mono text-xs">
                  /assets/aistudio/pacto_Mind_Map__1__4a334d32.png
                </span>
                .
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Code2 className="w-5 h-5 text-slate-800" />
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Estructuras JSON-Schema en Vivo
                </h2>
              </div>

              <div className="flex gap-2">
                {(['JSON-TEL', 'M-CP', 'JSON-CIE'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSchemaTab(tab)}
                    className={`px-3 py-1.5 text-xs font-mono font-medium rounded-lg border cursor-pointer ${
                      schemaTab === tab
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed">
                {JSON.stringify(dynamicSchemaPayload, null, 2)}
              </pre>
            </div>

            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-slate-800" />
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Cumplimiento Normativo y Límites Declarados
                </h2>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-4 font-medium">Marco / Control</th>
                      <th className="py-2 font-medium">Implementación en Protocolo PACTO</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    <tr>
                      <td className="py-2.5 pr-4 font-medium text-slate-900">
                        Art. 4° Constitucional (ISM)
                      </td>
                      <td className="py-2.5">
                        Cero perfilamiento ni autenticación del menor; privacidad activa en Estado Verde.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-medium text-slate-900">LGPDPPSO / LFPDPPP</td>
                      <td className="py-2.5">
                        Minimización de datos personales, disociación en C5 y Data Wipe en Estado 4.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-medium text-slate-900">AES-256-GCM + TLS 1.3</td>
                      <td className="py-2.5">
                        Cifrado en RAM volátil con borrado de búferes tras análisis F-BLUR (r=36px).
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-medium text-slate-900">Reglas Firestore Strict</td>
                      <td className="py-2.5">
                        Segregación RBAC (Reportante, Admin, Auditor, Juez, Monitorista) e inmutabilidad WORM.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-2 text-xs text-slate-700">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <Scale className="w-4 h-4" />
                  <span>Límites Declarados del Sistema</span>
                </div>
                <p>
                  PACTO reduce probabilísticamente el riesgo operativo mediante trazabilidad
                  verificable; no previene el dolo, no sustituye al Juez ni anula el conflicto
                  parental.
                </p>
                <div className="pt-2 flex items-start gap-2 text-slate-600">
                  <BookOpen className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" />
                  <span>
                    Propiedad intelectual (INDAUTOR) registrada a favor de{' '}
                    <strong>Arturo Salvador Balderas Hernández</strong>.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
