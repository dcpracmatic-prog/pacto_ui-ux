import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from './firebase';
import { generateFolioFisico, generateKJuez, sha256Hex, sha512Hex } from './pactoAlgorithms';
import type {
  ActiveViewRole,
  AgeGroup,
  CecofamSede,
  ConvivenciaSession,
  EventoBitacora,
  IncidentCategory,
  IncidentReport,
  IncidentSeverity,
  IncidentStatus,
  LogAuditoriaWorm,
  MensajeProxy,
  NotariaCsgRecord,
  NotariaSourceType,
  ProtocolConfig,
  RbacRole,
  RmonCategory,
  RoleAssignment,
  UserProfile,
} from '../types/pacto';
import { CECOFAM_COORDS } from '../types/pacto';

function makeSafeId(prefix: string): string {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now()}_${rand[0].toString(36)}${rand[1].toString(36)}`;
}

export function sanitizeValidId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

export async function ensureUserProfile(user: User): Promise<UserProfile | null> {
  const path = `users/${user.uid}`;
  try {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }
    const payload = {
      uid: user.uid,
      email: (user.email || 'usuario@pacto.gob.mx').slice(0, 160),
      displayName: (user.displayName || 'Operador Institucional').slice(0, 120),
      activeViewRole: 'JUEZ' as ActiveViewRole,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, payload);
    const created = await getDoc(ref);
    return (created.data() as UserProfile) ?? null;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function updateActiveViewRole(uid: string, activeViewRole: ActiveViewRole): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      activeViewRole,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeConvivencias(
  uid: string,
  onData: (rows: ConvivenciaSession[]) => void,
  isPrivilegedReader = false
): Unsubscribe {
  const q = isPrivilegedReader
    ? query(collection(db, 'convivencias'), orderBy('updatedAt', 'desc'))
    : query(
        collection(db, 'convivencias'),
        where('ownerId', '==', uid),
        orderBy('updatedAt', 'desc')
      );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        ...(d.data() as Omit<ConvivenciaSession, 'id'>),
        id: d.id,
      }));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'convivencias')
  );
}

export function subscribeEventos(
  uid: string,
  convivenciaId: string,
  onData: (rows: EventoBitacora[]) => void,
  isPrivilegedReader = false
): Unsubscribe {
  const path = `convivencias/${convivenciaId}/eventos`;
  const q = isPrivilegedReader
    ? query(collection(db, 'convivencias', convivenciaId, 'eventos'), orderBy('createdAt', 'asc'))
    : query(
        collection(db, 'convivencias', convivenciaId, 'eventos'),
        where('ownerId', '==', uid),
        orderBy('createdAt', 'asc')
      );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        ...(d.data() as Omit<EventoBitacora, 'id'>),
        id: d.id,
      }));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeMensajes(
  uid: string,
  convivenciaId: string,
  onData: (rows: MensajeProxy[]) => void,
  isPrivilegedReader = false
): Unsubscribe {
  const path = `convivencias/${convivenciaId}/mensajes`;
  const q = isPrivilegedReader
    ? query(collection(db, 'convivencias', convivenciaId, 'mensajes'), orderBy('createdAt', 'asc'))
    : query(
        collection(db, 'convivencias', convivenciaId, 'mensajes'),
        where('ownerId', '==', uid),
        orderBy('createdAt', 'asc')
      );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        ...(d.data() as Omit<MensajeProxy, 'id'>),
        id: d.id,
      }));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export function subscribeAuditLogs(
  uid: string,
  onData: (rows: LogAuditoriaWorm[]) => void,
  isPrivilegedReader = false
): Unsubscribe {
  const q = isPrivilegedReader
    ? query(collection(db, 'logs_auditoria'), orderBy('createdAt', 'desc'))
    : query(
        collection(db, 'logs_auditoria'),
        where('ownerId', '==', uid),
        orderBy('createdAt', 'desc')
      );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        ...(d.data() as Omit<LogAuditoriaWorm, 'id'>),
        id: d.id,
      }));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'logs_auditoria')
  );
}

// --- RBAC Role Assignments (Admin-managed) ---

export function subscribeRoleAssignments(
  uid: string,
  isPrivilegedReader: boolean,
  onData: (rows: RoleAssignment[]) => void
): Unsubscribe {
  const q = isPrivilegedReader
    ? query(collection(db, 'role_assignments'), orderBy('updatedAt', 'desc'))
    : query(
        collection(db, 'role_assignments'),
        where('targetUid', '==', uid),
        orderBy('updatedAt', 'desc')
      );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        ...(d.data() as Omit<RoleAssignment, 'id'>),
        id: d.id,
      }));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'role_assignments')
  );
}

export async function assignUserRole(params: {
  adminUid: string;
  targetUid: string;
  targetEmail: string;
  role: RbacRole;
  cecofamSede: CecofamSede | 'TODAS';
  active: boolean;
  prevAuditHash: string;
}): Promise<void> {
  const safeTargetUid = sanitizeValidId(params.targetUid.trim());
  const safeEmail = params.targetEmail.trim().slice(0, 160);
  const path = `role_assignments/${safeTargetUid}`;
  try {
    const ref = doc(db, 'role_assignments', safeTargetUid);
    const existingSnap = await getDoc(ref);
    const batch = writeBatch(db);

    if (existingSnap.exists()) {
      batch.update(ref, {
        role: params.role,
        cecofamSede: params.cecofamSede,
        active: params.active,
        assignedByUid: params.adminUid,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(ref, {
        targetUid: safeTargetUid,
        targetEmail: safeEmail,
        role: params.role,
        cecofamSede: params.cecofamSede,
        active: params.active,
        assignedByUid: params.adminUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // Keep /auditors registry synced when assigning AUDITOR role
    const auditorRef = doc(db, 'auditors', safeTargetUid);
    const auditorSnap = await getDoc(auditorRef);
    if (params.role === 'AUDITOR') {
      if (auditorSnap.exists()) {
        batch.update(auditorRef, { active: params.active });
      } else {
        batch.set(auditorRef, {
          uid: safeTargetUid,
          email: safeEmail,
          active: params.active,
          grantedByUid: params.adminUid,
          createdAt: serverTimestamp(),
        });
      }
    } else if (auditorSnap.exists()) {
      batch.update(auditorRef, { active: false });
    }

    await batch.commit();

    await appendWormAuditLog({
      uid: params.adminUid,
      actorRole: 'ADMIN',
      folioFisico: '00000000',
      action: `RBAC_ASIGNACION_${params.role}`,
      justification: `S-ADMIN asignó rol ${params.role} (${params.active ? 'activo' : 'revocado'}) a ${safeEmail} en sede ${params.cecofamSede}.`,
      prevHash: params.prevAuditHash,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

// --- Protocol Configs (Admin-managed, Auditor & Reporter read-only) ---

export function subscribeProtocolConfigs(
  isPrivilegedReader: boolean,
  onData: (rows: ProtocolConfig[]) => void
): Unsubscribe {
  const q = isPrivilegedReader
    ? query(collection(db, 'protocol_configs'), orderBy('updatedAt', 'desc'))
    : query(
        collection(db, 'protocol_configs'),
        where('active', '==', true),
        orderBy('updatedAt', 'desc')
      );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        ...(d.data() as Omit<ProtocolConfig, 'id'>),
        id: d.id,
      }));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'protocol_configs')
  );
}

export async function saveProtocolConfig(params: {
  adminUid: string;
  configId?: string;
  version: string;
  cecofamSede: CecofamSede | 'GLOBAL';
  maxUavBudget: number;
  gpsLossThresholdSec: number;
  t5mWindowSec: number;
  fBlurRadiusPx: number;
  accessibilityMode: string;
  active: boolean;
  prevAuditHash: string;
}): Promise<string> {
  const id = params.configId ? sanitizeValidId(params.configId) : makeSafeId('cfg');
  const path = `protocol_configs/${id}`;
  const payload = {
    version: params.version.trim().slice(0, 32) || 'v1.4',
    cecofamSede: params.cecofamSede,
    maxUavBudget: Math.max(1, Math.min(32, Math.round(params.maxUavBudget))),
    gpsLossThresholdSec: Math.max(300, Math.min(3600, Math.round(params.gpsLossThresholdSec))),
    t5mWindowSec: Math.max(120, Math.min(900, Math.round(params.t5mWindowSec))),
    fBlurRadiusPx: Math.max(25, Math.min(80, Math.round(params.fBlurRadiusPx))),
    accessibilityMode:
      params.accessibilityMode.trim().slice(0, 120) ||
      'Lectura fácil · Contraste alto · Subtitulado TAV',
    active: params.active,
    updatedByUid: params.adminUid,
  };

  try {
    const ref = doc(db, 'protocol_configs', id);
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await appendWormAuditLog({
      uid: params.adminUid,
      actorRole: 'ADMIN',
      folioFisico: '00000000',
      action: 'ACTUALIZACION_REGLA_PROTOCOLO',
      justification: `Configuración ${payload.version} (${payload.cecofamSede}): MTAS=${payload.maxUavBudget} UAV, GPS>=${payload.gpsLossThresholdSec}s, F-BLUR=${payload.fBlurRadiusPx}px.`,
      prevHash: params.prevAuditHash,
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

// --- Incident Reports (Reporter create/own-read, Admin triage, Auditor read-only) ---

export function subscribeIncidents(
  uid: string,
  isPrivilegedReader: boolean,
  onData: (rows: IncidentReport[]) => void
): Unsubscribe {
  const q = isPrivilegedReader
    ? query(collection(db, 'incidentes'), orderBy('createdAt', 'desc'))
    : query(
        collection(db, 'incidentes'),
        where('reporterId', '==', uid),
        orderBy('createdAt', 'desc')
      );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        ...(d.data() as Omit<IncidentReport, 'id'>),
        id: d.id,
      }));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'incidentes')
  );
}

export async function createIncidentReport(params: {
  uid: string;
  actorRole: string;
  convivenciaId: string;
  folioFisico: string;
  cecofamSede: CecofamSede;
  category: IncidentCategory;
  severity: IncidentSeverity;
  title: string;
  description: string;
  prevAuditHash: string;
}): Promise<string> {
  const id = makeSafeId('inc');
  const path = `incidentes/${id}`;
  const cleanTitle = params.title.trim().slice(0, 120);
  const cleanDesc = params.description.trim().slice(0, 800);
  const evidenceHash = await sha256Hex(
    `${params.uid}|${params.convivenciaId}|${params.folioFisico}|${params.category}|${cleanTitle}|${Date.now()}`
  );
  try {
    await setDoc(doc(db, 'incidentes', id), {
      reporterId: params.uid,
      convivenciaId: params.convivenciaId,
      folioFisico: params.folioFisico,
      cecofamSede: params.cecofamSede,
      category: params.category,
      severity: params.severity,
      status: 'REPORTADO' as IncidentStatus,
      title: cleanTitle,
      description: cleanDesc,
      evidenceHash,
      resolutionNote: '',
      assignedAdminUid: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await appendWormAuditLog({
      uid: params.uid,
      actorRole: params.actorRole,
      folioFisico: params.folioFisico,
      action: `REPORTE_INCIDENTE_${params.category}`,
      justification: `Incidencia "${cleanTitle}" (${params.severity}) reportada sobre folio ${params.folioFisico}.`,
      prevHash: params.prevAuditHash,
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function triageIncidentByAdmin(params: {
  adminUid: string;
  incidenteId: string;
  folioFisico: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  resolutionNote: string;
  prevAuditHash: string;
}): Promise<void> {
  const path = `incidentes/${params.incidenteId}`;
  try {
    await updateDoc(doc(db, 'incidentes', params.incidenteId), {
      status: params.status,
      severity: params.severity,
      resolutionNote: params.resolutionNote.trim().slice(0, 500),
      assignedAdminUid: params.adminUid,
      updatedAt: serverTimestamp(),
    });

    await appendWormAuditLog({
      uid: params.adminUid,
      actorRole: 'ADMIN',
      folioFisico: params.folioFisico,
      action: `GESTION_INCIDENTE_${params.status}`,
      justification: `S-ADMIN actualizó incidente a ${params.status} (${params.severity}): ${params.resolutionNote.trim().slice(0, 140)}`,
      prevHash: params.prevAuditHash,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function appendWormAuditLog(params: {
  uid: string;
  actorRole: string;
  folioFisico: string;
  action: string;
  justification: string;
  prevHash: string;
}): Promise<string> {
  const logId = makeSafeId('worm');
  const currentHash = await sha512Hex(
    `${params.prevHash}|${params.folioFisico}|${params.action}|${params.actorRole}|${Date.now()}`
  );
  const path = `logs_auditoria/${logId}`;
  try {
    await setDoc(doc(db, 'logs_auditoria', logId), {
      ownerId: params.uid,
      actorRole: params.actorRole.slice(0, 40),
      folioFisico: params.folioFisico,
      action: params.action.slice(0, 120),
      justification: params.justification.slice(0, 300),
      prevHash: params.prevHash.slice(0, 128),
      currentHash,
      createdAt: serverTimestamp(),
    });
    return currentHash;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function appendEventoBitacora(params: {
  uid: string;
  convivenciaId: string;
  category: RmonCategory;
  eventType: string;
  summary: string;
}): Promise<void> {
  const eventoId = makeSafeId('evt');
  const hashSha3 = await sha256Hex(
    `${params.convivenciaId}|${params.category}|${params.eventType}|${params.summary}|${Date.now()}`
  );
  const path = `convivencias/${params.convivenciaId}/eventos/${eventoId}`;
  try {
    await setDoc(doc(db, 'convivencias', params.convivenciaId, 'eventos', eventoId), {
      ownerId: params.uid,
      category: params.category,
      eventType: params.eventType.slice(0, 80),
      summary: params.summary.slice(0, 600),
      hashSha3,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createConvivenciaFromScreening(params: {
  uid: string;
  cecofamSede: CecofamSede;
  ageGroup: AgeGroup;
  iArrScore: number;
  exclusionsClear: boolean;
  durationMinutes: number;
  minorClothingDesc: string;
  vehicleDesc: string;
  prevAuditHash: string;
}): Promise<{ id: string; folioFisico: string; kJuez: string }> {
  const id = makeSafeId('pacto');
  const folioFisico = generateFolioFisico();
  const kJuez = generateKJuez();
  const folioHash = await sha256Hex(`${folioFisico}|${id}|${params.cecofamSede}|${Date.now()}`);
  const coords = CECOFAM_COORDS[params.cecofamSede];

  const path = `convivencias/${id}`;
  try {
    await setDoc(doc(db, 'convivencias', id), {
      ownerId: params.uid,
      folioFisico,
      folioHash,
      kJuez,
      cecofamSede: params.cecofamSede,
      fsmState: 'STATE_0_INGESTA',
      semaphore: 'VERDE',
      uavCost: 0,
      ageGroup: params.ageGroup,
      iArrScore: Math.max(0, Math.min(100, params.iArrScore)),
      exclusionsClear: params.exclusionsClear,
      ccpSigned: false,
      tviVerified: false,
      tavVerified: false,
      t5mStartMs: 0,
      durationMinutes: Math.max(30, Math.min(720, Math.round(params.durationMinutes))),
      lat: coords.lat,
      lng: coords.lng,
      signalDbm: -74,
      batteryPct: 86,
      inShadowZone: false,
      rpaAlertActive: false,
      gpsLossSeconds: 0,
      chatAttempts: 0,
      pvBlaFailures: 0,
      prcActivated: false,
      minorClothingDesc: (params.minorClothingDesc.trim() || 'Sudadera azul marino, pantalón mezclilla, tenis blancos').slice(0, 240),
      vehicleDesc: (params.vehicleDesc.trim() || 'Sedán gris plata — uso particular').slice(0, 160),
      closingNote: '',
      sealHash: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await appendEventoBitacora({
      uid: params.uid,
      convivenciaId: id,
      category: 'MORADO',
      eventType: 'INGESTA_A_PACTO',
      summary: `Expediente admitido en ${params.cecofamSede}. Índice M-ARR: ${params.iArrScore.toFixed(1)} pts · Modulador M-RIPE: ${params.ageGroup}. Folio ${folioFisico} tokenizado.`,
    });

    await appendWormAuditLog({
      uid: params.uid,
      actorRole: 'JUEZ',
      folioFisico,
      action: 'CREACION_FOLIO_ESTADO_0',
      justification: `Cribado paramétrico A-PACTO favorable en sede ${params.cecofamSede}.`,
      prevHash: params.prevAuditHash,
    });

    return { id, folioFisico, kJuez };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateConvivenciaFields(
  convivenciaId: string,
  fields: Partial<Omit<ConvivenciaSession, 'id' | 'ownerId' | 'folioFisico' | 'folioHash' | 'kJuez' | 'createdAt'>>
): Promise<void> {
  const path = `convivencias/${convivenciaId}`;
  try {
    await updateDoc(doc(db, 'convivencias', convivenciaId), {
      ...fields,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function appendMensajeProxy(params: {
  uid: string;
  convivenciaId: string;
  senderRole: 'CUSTODIO' | 'CONVIVIENTE' | 'MONITORISTA';
  rawPreview: string;
  cleanContent: string;
  status: 'RECHAZADO_HOSTIL' | 'SANITIZADO_RETRANSMITIDO' | 'LOGISTICO_LIMPIO';
  hostileTokensCount: number;
}): Promise<void> {
  const mensajeId = makeSafeId('msg');
  const path = `convivencias/${params.convivenciaId}/mensajes/${mensajeId}`;
  try {
    await setDoc(doc(db, 'convivencias', params.convivenciaId, 'mensajes', mensajeId), {
      ownerId: params.uid,
      senderRole: params.senderRole,
      rawPreview: params.rawPreview.slice(0, 400),
      cleanContent: params.cleanContent.slice(0, 400),
      status: params.status,
      hostileTokensCount: params.hostileTokensCount,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeNotariasCsg(
  uid: string,
  convivenciaId: string,
  onData: (rows: NotariaCsgRecord[]) => void,
  isPrivilegedReader = false
): Unsubscribe {
  const path = `convivencias/${convivenciaId}/notarias`;
  const q = isPrivilegedReader
    ? query(collection(db, 'convivencias', convivenciaId, 'notarias'), orderBy('createdAt', 'desc'))
    : query(
        collection(db, 'convivencias', convivenciaId, 'notarias'),
        where('ownerId', '==', uid),
        orderBy('createdAt', 'desc')
      );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({
        ...(d.data() as Omit<NotariaCsgRecord, 'id'>),
        id: d.id,
      }));
      onData(items);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, path)
  );
}

export async function appendNotariaCsgRecord(params: {
  uid: string;
  convivenciaId: string;
  folioFisico: string;
  sourceType: NotariaSourceType;
  sourceRefId: string;
  sourceTitle: string;
  docUrl: string;
  eventoId: string;
  hashContenido: string;
  cuerpoHash: string;
  selloAnterior: string;
  firmantePub: string;
  notarioPub: string;
  firmaNotario: string;
  aceptado: boolean;
  csgTimestamp: number;
  actorRole: string;
  prevAuditHash: string;
}): Promise<string> {
  const notariaId = makeSafeId('csg');
  const path = `convivencias/${params.convivenciaId}/notarias/${notariaId}`;
  try {
    await setDoc(doc(db, 'convivencias', params.convivenciaId, 'notarias', notariaId), {
      ownerId: params.uid,
      folioFisico: params.folioFisico,
      sourceType: params.sourceType,
      sourceRefId: params.sourceRefId.slice(0, 200),
      sourceTitle: params.sourceTitle.slice(0, 180),
      docUrl: params.docUrl.slice(0, 400),
      eventoId: params.eventoId.slice(0, 128),
      hashContenido: params.hashContenido,
      cuerpoHash: params.cuerpoHash,
      selloAnterior: params.selloAnterior,
      firmantePub: params.firmantePub,
      notarioPub: params.notarioPub,
      firmaNotario: params.firmaNotario,
      aceptado: params.aceptado,
      csgTimestamp: Math.max(0, Math.round(params.csgTimestamp)),
      actorRole: params.actorRole.slice(0, 40),
      createdAt: serverTimestamp(),
    });

    await appendWormAuditLog({
      uid: params.uid,
      actorRole: params.actorRole,
      folioFisico: params.folioFisico,
      action: `NOTARIA_CSG_${params.sourceType}`,
      justification: `Sello CSG Ed25519+SHA3-256 (${params.aceptado ? 'ACEPTADO' : 'RECHAZADO'}) sobre "${params.sourceTitle.slice(0, 80)}". CuerpoHash=${params.cuerpoHash.slice(0, 16)}...`,
      prevHash: params.prevAuditHash,
    });

    return notariaId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}
