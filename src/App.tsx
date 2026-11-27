import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Camera,
  Eye,
  KeyRound,
  Lock,
  LogOut,
  Scale,
  Settings2,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import { auth, testFirestoreConnection } from './lib/firebase';
import {
  clearWorkspaceAccessToken,
  signOutGoogleWorkspace,
} from './lib/workspaceAuth';
import {
  createIncidentReport,
  ensureUserProfile,
  subscribeAuditLogs,
  subscribeConvivencias,
  subscribeIncidents,
  subscribeProtocolConfigs,
  subscribeRoleAssignments,
  updateActiveViewRole,
} from './lib/pactoStore';
import {
  enqueueOfflineIncident,
  listPendingOfflineIncidents,
  loadCachedIncidents,
  loadCachedMeta,
  loadCachedSessions,
  markPendingIncidentError,
  removePendingOfflineIncident,
  saveCachedIncidents,
  saveCachedMeta,
  saveCachedSessions,
  type PendingOfflineIncident,
} from './lib/offlineCache';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import type {
  ActiveViewRole,
  ConvivenciaSession,
  IncidentReport,
  LogAuditoriaWorm,
  ProtocolConfig,
  RbacRole,
  RoleAssignment,
} from './types/pacto';
import { PactoLogo } from './components/PactoLogo';
import { AuthGate } from './components/AuthGate';
import { FsmPortalView } from './components/FsmPortalView';
import { MonitoristaView } from './components/MonitoristaView';
import { JuezWorkspace } from './components/JuezWorkspace';
import { ArquitecturaView } from './components/ArquitecturaView';
import { EthicalFooter, HelpGlossaryButton } from './components/HelpGlossaryModal';
import { IncidentReportDrawer } from './components/IncidentReportDrawer';
import { FolioQrScannerModal } from './components/FolioQrScannerModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineStatusBanner } from './components/OfflineStatusBanner';

type InstitutionalProfile = 'JUEZ' | 'MONITORISTA' | 'AUDITOR' | 'ADMIN';

const PROFILE_META: Record<
  ActiveViewRole,
  { title: string; subtitle: string }
> = {
  CUSTODIO: {
    title: 'Terminal Custodio',
    subtitle: 'QR dinámico, T-5M sin rastreo y cierre simétrico S4',
  },
  CONVIVIENTE: {
    title: 'Espacio Conviviente',
    subtitle: 'Silencio Visual Activo, MILE/TAV, A-RPA y contexto F-BLUR',
  },
  JUEZ: {
    title: 'Panel Jurisdiccional (Juez)',
    subtitle: 'Cribado A-PACTO y Bóveda Judicial K-JUEZ',
  },
  MONITORISTA: {
    title: 'Consola CECOFAM (Monitorista)',
    subtitle: 'Supervisión por excepción MTAS-8 y compuerta PRC',
  },
  AUDITOR: {
    title: 'Auditoría Forense WORM',
    subtitle: 'Trazabilidad operativa estricta en modo solo lectura',
  },
  ADMIN: {
    title: 'Administración S-ADMIN',
    subtitle: 'Parametrización, padrón RBAC y atención de incidentes',
  },
};

const INSTITUTIONAL_INFO: Record<
  InstitutionalProfile,
  { label: string; badge: string; scopeDesc: string }
> = {
  JUEZ: {
    label: 'Juez Familiar',
    badge: 'Jurisdicción K-JUEZ',
    scopeDesc:
      'Acceso exclusivo a Cribado Paramétrico A-PACTO (Estado 0), Simulación Monte Carlo y desbloqueo de Archivo Ciego mediante llave K-JUEZ.',
  },
  MONITORISTA: {
    label: 'Monitorista CECOFAM',
    badge: 'Triage MTAS-8',
    scopeDesc:
      'Acceso exclusivo al tablero de excepciones MTAS-8, compuerta determinista PRC hacia C5 y supervisión del proxy de chat asimétrico.',
  },
  AUDITOR: {
    label: 'Auditor Forense',
    badge: 'Solo Lectura WORM',
    scopeDesc:
      'Acceso estrictamente de solo lectura a la bitácora inmutable WORM (SHA-512), consulta de incidentes, reglas y padrón RBAC. Sin permisos de escritura ni K-JUEZ.',
  },
  ADMIN: {
    label: 'Administrador (S-ADMIN)',
    badge: 'Ceguera Pericial',
    scopeDesc:
      'Gestión de /protocol_configs, asignación de roles /role_assignments y atención de /incidentes. Sin acceso para descifrar Archivo Ciego K-JUEZ.',
  },
};

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const [activeProfile, setActiveProfile] = useState<ActiveViewRole | null>(null);
  const [gateModalRole, setGateModalRole] = useState<InstitutionalProfile | null>(null);
  const [incidentDrawerOpen, setIncidentDrawerOpen] = useState(false);

  const [sessions, setSessions] = useState<ConvivenciaSession[]>([]);
  const [auditLogs, setAuditLogs] = useState<LogAuditoriaWorm[]>([]);
  const [protocolConfigs, setProtocolConfigs] = useState<ProtocolConfig[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Civilian Launcher Inputs
  const [custodioFolioInput, setCustodioFolioInput] = useState('');
  const [convivienteFolioInput, setConvivienteFolioInput] = useState('');
  const [custodioScannerOpen, setCustodioScannerOpen] = useState(false);
  const [launcherError, setLauncherError] = useState<string | null>(null);

  const isOnline = useOnlineStatus();
  const [cachedAtMs, setCachedAtMs] = useState(0);
  const [cachedRole, setCachedRole] = useState<RbacRole | null>(null);
  const [cachedAuditHash, setCachedAuditHash] = useState(
    '0000000000000000000000000000000000000000000000000000000000000000'
  );
  const [pendingIncidents, setPendingIncidents] = useState<PendingOfflineIncident[]>([]);
  const [syncingPending, setSyncingPending] = useState(false);
  const syncInFlightRef = useRef(false);

  const isBootstrapAdmin = Boolean(
    user?.emailVerified && user?.email === 'dcpracmatic@gmail.com'
  );

  const assignedRole: RbacRole | null = useMemo(() => {
    if (!user) return null;
    const match = roleAssignments.find((r) => r.targetUid === user.uid && r.active);
    return match?.role ?? cachedRole;
  }, [user, roleAssignments, cachedRole]);

  const canAccessJuez = isBootstrapAdmin || assignedRole === 'JUEZ';
  const canAccessMonitorista = isBootstrapAdmin || assignedRole === 'MONITORISTA';
  const canAccessAuditor = isBootstrapAdmin || assignedRole === 'AUDITOR';
  const canAccessAdmin = isBootstrapAdmin || assignedRole === 'ADMIN';

  const isPrivilegedSessionReader =
    canAccessJuez || canAccessMonitorista || canAccessAuditor || canAccessAdmin;
  const isGlobalAuditReader = canAccessAuditor || canAccessAdmin;

  useEffect(() => {
    if (navigator.onLine) {
      void testFirestoreConnection();
    }
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        if (navigator.onLine) {
          try {
            await ensureUserProfile(currentUser);
          } catch (err) {
            console.error('Error initializing profile:', err);
          }
        }
      } else {
        clearWorkspaceAccessToken();
        setActiveProfile(null);
        setGateModalRole(null);
        setSessions([]);
        setAuditLogs([]);
        setProtocolConfigs([]);
        setIncidents([]);
        setRoleAssignments([]);
        setCachedRole(null);
        setCachedAtMs(0);
        setPendingIncidents([]);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Hydrate offline IndexedDB snapshots immediately when authenticated
  useEffect(() => {
    if (!user) return;
    let active = true;
    void (async () => {
      const [cachedSess, cachedInc, meta, queued] = await Promise.all([
        loadCachedSessions(user.uid),
        loadCachedIncidents(user.uid),
        loadCachedMeta(user.uid),
        listPendingOfflineIncidents(user.uid),
      ]);
      if (!active) return;
      if (cachedSess && cachedSess.rows.length > 0) {
        setSessions((prev) => (prev.length > 0 ? prev : cachedSess.rows));
        setCachedAtMs(cachedSess.savedAtMs);
        setSelectedId((prev) => prev ?? cachedSess.rows[0]?.id ?? null);
        if (cachedSess.rows[0]?.folioFisico) {
          setCustodioFolioInput((prev) => prev || cachedSess.rows[0].folioFisico);
          setConvivienteFolioInput((prev) => prev || cachedSess.rows[0].folioFisico);
        }
      }
      if (cachedInc && cachedInc.rows.length > 0) {
        setIncidents((prev) => (prev.length > 0 ? prev : cachedInc.rows));
      }
      if (meta) {
        setCachedRole(meta.assignedRole);
        if (meta.lastAuditHash) setCachedAuditHash(meta.lastAuditHash);
      }
      setPendingIncidents(queued);
    })();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const unsubSessions = subscribeConvivencias(
      user.uid,
      (rows) => {
        if (rows.length > 0 || navigator.onLine) {
          setSessions(rows);
          void saveCachedSessions(user.uid, rows);
          setCachedAtMs(Date.now());
          setSelectedId((prev) => {
            if (prev && rows.some((r) => r.id === prev)) return prev;
            return rows[0]?.id ?? null;
          });
          if (rows[0]?.folioFisico) {
            setCustodioFolioInput((prev) => prev || rows[0].folioFisico);
            setConvivienteFolioInput((prev) => prev || rows[0].folioFisico);
          }
        }
      },
      isPrivilegedSessionReader
    );
    const unsubAudit = subscribeAuditLogs(user.uid, setAuditLogs, isGlobalAuditReader);
    const unsubConfigs = subscribeProtocolConfigs(isGlobalAuditReader, setProtocolConfigs);
    const unsubIncidents = subscribeIncidents(user.uid, isGlobalAuditReader, (rows) => {
      if (rows.length > 0 || navigator.onLine) {
        setIncidents(rows);
        void saveCachedIncidents(user.uid, rows);
      }
    });
    const unsubRoles = subscribeRoleAssignments(user.uid, isGlobalAuditReader, setRoleAssignments);
    return () => {
      unsubSessions();
      unsubAudit();
      unsubConfigs();
      unsubIncidents();
      unsubRoles();
    };
  }, [user, isPrivilegedSessionReader, isGlobalAuditReader]);

  const lastAuditHash = useMemo(() => {
    if (auditLogs.length > 0 && auditLogs[0].currentHash) {
      return auditLogs[0].currentHash;
    }
    return cachedAuditHash;
  }, [auditLogs, cachedAuditHash]);

  useEffect(() => {
    if (!user) return;
    void saveCachedMeta({
      uid: user.uid,
      lastAuditHash,
      assignedRole,
      savedAtMs: Date.now(),
    });
  }, [user, lastAuditHash, assignedRole]);

  const syncPendingIncidents = useCallback(async () => {
    if (!user || !navigator.onLine || syncInFlightRef.current) return;
    const queued = await listPendingOfflineIncidents(user.uid);
    setPendingIncidents(queued);
    if (queued.length === 0) return;

    syncInFlightRef.current = true;
    setSyncingPending(true);
    try {
      for (const item of queued) {
        if (!navigator.onLine) break;
        try {
          await createIncidentReport({
            uid: item.uid,
            actorRole: item.actorRole,
            convivenciaId: item.convivenciaId,
            folioFisico: item.folioFisico,
            cecofamSede: item.cecofamSede,
            category: item.category,
            severity: item.severity,
            title: item.title,
            description: item.description,
            prevAuditHash: lastAuditHash || item.prevAuditHash,
          });
          await removePendingOfflineIncident(item.localId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Error de sincronización';
          await markPendingIncidentError(item.localId, msg);
        }
      }
      const remaining = await listPendingOfflineIncidents(user.uid);
      setPendingIncidents(remaining);
    } finally {
      syncInFlightRef.current = false;
      setSyncingPending(false);
    }
  }, [lastAuditHash, user]);

  useEffect(() => {
    if (isOnline && user) {
      void syncPendingIncidents();
    }
  }, [isOnline, user, syncPendingIncidents]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const handleSwMessage = (event: MessageEvent) => {
      if (
        event.data &&
        typeof event.data === 'object' &&
        (event.data as { type?: string }).type === 'PACTO_SYNC_INCIDENTS'
      ) {
        void syncPendingIncidents();
      }
    };
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, [syncPendingIncidents]);

  const handleQueueOfflineIncident = useCallback(
    async (item: PendingOfflineIncident) => {
      await enqueueOfflineIncident(item);
      if (user) {
        const queued = await listPendingOfflineIncidents(user.uid);
        setPendingIncidents(queued);
      }
    },
    [user]
  );

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null,
    [sessions, selectedId]
  );

  const myIncidents = useMemo(
    () => (user ? incidents.filter((i) => i.reporterId === user.uid) : []),
    [incidents, user]
  );

  const hasInstitutionalPermission = (role: InstitutionalProfile): boolean => {
    if (role === 'JUEZ') return canAccessJuez;
    if (role === 'MONITORISTA') return canAccessMonitorista;
    if (role === 'AUDITOR') return canAccessAuditor;
    return canAccessAdmin;
  };

  const enterProfile = async (role: ActiveViewRole, sessionId?: string) => {
    if (!user) return;
    setLauncherError(null);
    if (sessionId) setSelectedId(sessionId);
    setActiveProfile(role);
    setGateModalRole(null);
    if (navigator.onLine) {
      void updateActiveViewRole(user.uid, role).catch(() => {});
    }
  };

  const handleEnterCivilianProfile = async (role: 'CUSTODIO' | 'CONVIVIENTE') => {
    setLauncherError(null);
    const rawFolio = (role === 'CUSTODIO' ? custodioFolioInput : convivienteFolioInput).trim();
    if (!/^[0-9]{8}$/.test(rawFolio)) {
      setLauncherError('Ingresa un Folio Físico válido de 8 dígitos numéricos para abrir este perfil.');
      return;
    }
    const matched = sessions.find((s) => s.folioFisico === rawFolio);
    if (!matched) {
      setLauncherError(
        `El folio ${rawFolio} no existe o no pertenece a tu cuenta. Un Juez Familiar debe admitir primero el expediente en Cribado A-PACTO.`
      );
      return;
    }
    await enterProfile(role, matched.id);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <PactoLogo className="w-8 h-8 text-slate-900 mx-auto" />
          <p className="text-xs font-medium text-slate-500">Inicializando entorno seguro PACTO...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  const effectiveRoleLabel = isBootstrapAdmin
    ? 'Administración Raíz (S-ADMIN)'
    : assignedRole
    ? `Rol asignado: ${assignedRole}`
    : 'Usuario de Campo (Custodio / Conviviente / Reportante)';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* APP TOP BAR */}
      {activeProfile === null ? (
        <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-4">
          {/* Left: Institutional Role Access Triggers */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {(
              [
                { role: 'JUEZ', label: 'Juez', icon: Scale, allowed: canAccessJuez },
                { role: 'MONITORISTA', label: 'Monitorista', icon: Activity, allowed: canAccessMonitorista },
                { role: 'AUDITOR', label: 'Auditor', icon: Eye, allowed: canAccessAuditor },
                { role: 'ADMIN', label: 'S-ADMIN', icon: Settings2, allowed: canAccessAdmin },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.role}
                  type="button"
                  onClick={() => setGateModalRole(item.role)}
                  className={`min-h-[36px] px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    item.allowed
                      ? 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
                      : 'border-slate-200 bg-slate-50 text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{item.label}</span>
                  {!item.allowed && <Lock className="w-3 h-3 shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Right: Install + Signed-in User + Sign Out */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <PWAInstallButton />
            <span className="hidden sm:inline text-xs text-slate-500 truncate max-w-[220px]">
              {user.email}
            </span>
            <button
              type="button"
              onClick={() => void signOutGoogleWorkspace()}
              className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Salir</span>
            </button>
          </div>
        </header>
      ) : (
        <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <PactoLogo className="w-6 h-6 text-slate-900 shrink-0" />
            <div className="min-w-0">
              <div className="font-display text-sm font-semibold text-slate-900 truncate">
                {PROFILE_META[activeProfile].title}
              </div>
              <div className="hidden sm:block text-[11px] text-slate-500 truncate">
                {PROFILE_META[activeProfile].subtitle}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => setActiveProfile(null)}
              className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Cambiar Perfil</span>
            </button>
            <button
              type="button"
              onClick={() => void signOutGoogleWorkspace()}
              className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              aria-label="Cerrar sesión Google"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </header>
      )}

      {/* MAIN WORKSPACE */}
      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 sm:py-8 max-w-7xl mx-auto w-full space-y-6">
        <OfflineStatusBanner
          isOnline={isOnline}
          cachedCount={sessions.length}
          cachedAtMs={cachedAtMs}
          pendingIncidentsCount={pendingIncidents.length}
          syncingPending={syncingPending}
          canReportIncidents={!(assignedRole === 'AUDITOR' && !isBootstrapAdmin)}
          onSyncNow={() => void syncPendingIncidents()}
          onOpenIncidentDrawer={() => setIncidentDrawerOpen(true)}
        />
        {activeProfile === null ? (
          /* APP HOME LAUNCHER */
          <div className="max-w-4xl mx-auto space-y-8 py-2 sm:py-4">
            {/* App Branding */}
            <div className="text-center space-y-3">
              <PactoLogo className="w-12 h-12 text-slate-900 mx-auto" />
              <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
                Protocolo PACTO
              </h1>
              <p className="text-sm text-slate-600 max-w-xl mx-auto leading-relaxed">
                Protocolo de Accesibilidad y Convivencia con Trazabilidad Operativa. Selecciona
                exclusivamente el perfil autorizado para tu función.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
                <span>{user.displayName || user.email}</span>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-slate-700">{effectiveRoleLabel}</span>
                <span aria-hidden="true">·</span>
                <HelpGlossaryButton topic="zk" label="¿Cómo protege mi privacidad?" />
              </div>
            </div>

            {launcherError && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900 text-center">
                {launcherError}
              </div>
            )}

            {/* Civilian App Cards: Custodio vs Conviviente */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
              {/* Perfil Custodio */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between space-y-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="w-5 h-5 text-slate-900" />
                      <h2 className="font-display text-lg font-semibold text-slate-900">
                        Perfil Custodio
                      </h2>
                    </div>
                    <HelpGlossaryButton topic="cie" />
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Exhibe el QR dinámico de entrega, controla la ventana de desacoplamiento T-5M sin
                    rastreo intrusivo, utiliza el proxy neutral de mensajes y valida el cierre S4.
                  </p>
                </div>

                <div className="space-y-3 pt-2">
                  <div>
                    <label
                      htmlFor="custodio-folio-input"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Folio del Expediente (8 dígitos)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="custodio-folio-input"
                        type="text"
                        maxLength={8}
                        value={custodioFolioInput}
                        onChange={(e) => setCustodioFolioInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="Ej. 74829103"
                        className="flex-1 min-w-0 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm text-slate-900 tracking-wider"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setLauncherError(null);
                          setCustodioScannerOpen(true);
                        }}
                        className="min-h-[42px] px-3.5 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                        title="Escanear QR del folio físico con cámara"
                      >
                        <Camera className="w-4 h-4" />
                        <span>Escanear QR</span>
                      </button>
                    </div>
                  </div>
                  {sessions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span>Folios en cuenta:</span>
                      {sessions.slice(0, 3).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setCustodioFolioInput(s.folioFisico)}
                          className="font-mono text-slate-800 underline hover:text-slate-900 cursor-pointer"
                        >
                          {s.folioFisico}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleEnterCivilianProfile('CUSTODIO')}
                    className="w-full min-h-[44px] py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl transition-colors cursor-pointer"
                  >
                    Entrar como Custodio
                  </button>
                </div>
              </div>

              {/* Perfil Conviviente */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between space-y-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <Users className="w-5 h-5 text-slate-900" />
                      <h2 className="font-display text-lg font-semibold text-slate-900">
                        Perfil Conviviente
                      </h2>
                    </div>
                    <HelpGlossaryButton topic="tvi" />
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Valida TVI en RAM, opera bajo Silencio Visual Activo con actividades MILE/TAV,
                    asistente de retorno A-RPA, contexto F-BLUR y cierre simétrico Triple Candado.
                  </p>
                </div>

                <div className="space-y-3 pt-2">
                  <div>
                    <label
                      htmlFor="conviviente-folio-input"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Folio del Expediente (8 dígitos)
                    </label>
                    <input
                      id="conviviente-folio-input"
                      type="text"
                      maxLength={8}
                      value={convivienteFolioInput}
                      onChange={(e) => setConvivienteFolioInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="Ej. 74829103"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm text-slate-900 tracking-wider"
                    />
                  </div>
                  {sessions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span>Folios en cuenta:</span>
                      {sessions.slice(0, 3).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setConvivienteFolioInput(s.folioFisico)}
                          className="font-mono text-slate-800 underline hover:text-slate-900 cursor-pointer"
                        >
                          {s.folioFisico}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleEnterCivilianProfile('CONVIVIENTE')}
                    className="w-full min-h-[44px] py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl transition-colors cursor-pointer"
                  >
                    Entrar como Conviviente
                  </button>
                </div>
              </div>
            </div>

            {/* Civilian Incident Reporting Shortcut + Active Session Info */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 text-xs text-slate-600">
                <UserCheck className="w-4 h-4 text-slate-800 shrink-0" />
                <span>
                  {sessions.length === 0
                    ? 'Aún no hay expedientes emitidos en tu cuenta. Si tienes rol Juez, ingresa arriba para iniciar un Cribado A-PACTO.'
                    : `Expedientes disponibles en tu sesión: ${sessions.length} · Mis reportes enviados: ${myIncidents.length}`}
                </span>
              </div>
              {!(assignedRole === 'AUDITOR' && !isBootstrapAdmin) && (
                <button
                  type="button"
                  onClick={() => setIncidentDrawerOpen(true)}
                  className="min-h-[38px] px-3.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Reportar Incidente ({myIncidents.length})</span>
                </button>
              )}
            </div>
          </div>
        ) : activeProfile === 'CUSTODIO' || activeProfile === 'CONVIVIENTE' ? (
          <FsmPortalView
            profileScope={activeProfile}
            uid={user.uid}
            sessions={sessions}
            selectedId={selectedId}
            onSelectId={setSelectedId}
            lastAuditHash={lastAuditHash}
            isPrivilegedReader={isPrivilegedSessionReader}
            onOpenIncidentDrawer={() => setIncidentDrawerOpen(true)}
            onExitProfile={() => setActiveProfile(null)}
          />
        ) : activeProfile === 'JUEZ' ? (
          <JuezWorkspace
            uid={user.uid}
            sessions={sessions}
            selectedId={selectedId}
            onSelectId={setSelectedId}
            lastAuditHash={lastAuditHash}
            isPrivilegedReader={isPrivilegedSessionReader}
            onOpenIncidentDrawer={() => setIncidentDrawerOpen(true)}
          />
        ) : activeProfile === 'MONITORISTA' ? (
          <MonitoristaView
            uid={user.uid}
            sessions={sessions}
            selectedId={selectedId}
            onSelectId={setSelectedId}
            lastAuditHash={lastAuditHash}
            isPrivilegedReader={isPrivilegedSessionReader}
            onOpenIncidentDrawer={() => setIncidentDrawerOpen(true)}
            onExitProfile={() => setActiveProfile(null)}
          />
        ) : (
          <ArquitecturaView
            workspaceMode={activeProfile === 'AUDITOR' ? 'AUDITOR' : 'ADMIN'}
            uid={user.uid}
            userEmail={user.email ?? 'operador@pacto.gob.mx'}
            canManageProtocol={canAccessAdmin}
            sessions={sessions}
            selectedId={selectedId}
            onSelectId={setSelectedId}
            auditLogs={auditLogs}
            protocolConfigs={protocolConfigs}
            incidents={incidents}
            roleAssignments={roleAssignments}
            lastAuditHash={lastAuditHash}
          />
        )}
      </main>

      <EthicalFooter />

      {/* INSTITUTIONAL RBAC GATE MODAL */}
      {gateModalRole && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <KeyRound className="w-5 h-5 text-slate-900 shrink-0" />
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    {INSTITUTIONAL_INFO[gateModalRole].label}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {INSTITUTIONAL_INFO[gateModalRole].badge}
                  </p>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed">
              {INSTITUTIONAL_INFO[gateModalRole].scopeDesc}
            </p>

            {hasInstitutionalPermission(gateModalRole) ? (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900">
                  Credencial verificada en Firebase Auth ({user.email}). Tienes autorización RBAC
                  para abrir este espacio aislado.
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setGateModalRole(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => enterProfile(gateModalRole)}
                    className="px-4 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-xl cursor-pointer"
                  >
                    Abrir Espacio {INSTITUTIONAL_INFO[gateModalRole].label}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900 space-y-1">
                  <div className="font-semibold">Acceso Denegado por Regla RBAC</div>
                  <p>
                    La cuenta <span className="font-mono">{user.email}</span> no cuenta con el rol{' '}
                    <span className="font-mono font-semibold">{gateModalRole}</span> activo en{' '}
                    <span className="font-mono">/role_assignments</span>. Solicita la asignación al
                    Administrador del Protocolo (S-ADMIN).
                  </p>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setGateModalRole(null)}
                    className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-xl cursor-pointer"
                  >
                    Entendido
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ROLE-SCOPED INCIDENT REPORTER MODAL */}
      <IncidentReportDrawer
        open={incidentDrawerOpen}
        onClose={() => setIncidentDrawerOpen(false)}
        uid={user.uid}
        actorRole={activeProfile ?? 'CUSTODIO'}
        sessions={sessions}
        activeSession={activeSession}
        myIncidents={myIncidents}
        pendingIncidents={pendingIncidents}
        lastAuditHash={lastAuditHash}
        isOnline={isOnline}
        onQueueOfflineIncident={handleQueueOfflineIncident}
      />

      {/* CUSTODIO RAPID FOLIO QR CAMERA SCANNER */}
      <FolioQrScannerModal
        open={custodioScannerOpen}
        onClose={() => setCustodioScannerOpen(false)}
        sessions={sessions}
        onSelectSession={(matched) => {
          setCustodioFolioInput(matched.folioFisico);
          void enterProfile('CUSTODIO', matched.id);
        }}
      />
    </div>
  );
}
