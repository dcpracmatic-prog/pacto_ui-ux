import { Timestamp } from 'firebase/firestore';

export type ActiveViewRole = 'JUEZ' | 'MONITORISTA' | 'CUSTODIO' | 'CONVIVIENTE' | 'AUDITOR' | 'ADMIN';

export type RbacRole = 'REPORTERO' | 'MONITORISTA' | 'JUEZ' | 'AUDITOR' | 'ADMIN';

export type CecofamSede = 'Ecatepec' | 'Toluca' | 'Nicolás Romero' | 'Ixtapaluca';

export type FsmState =
  | 'STATE_0_INGESTA'
  | 'STATE_1_ONBOARDING'
  | 'STATE_1_TIMEOUT'
  | 'STATE_2_ACTIVE'
  | 'STATE_3_TRIAGE'
  | 'STATE_4_CLOSED';

export type SemaphoreLevel = 'VERDE' | 'AMARILLO' | 'ROJO' | 'PRC';

export type AgeGroup = 'PRIMERA_INFANCIA' | 'ESCOLAR' | 'ADOLESCENTE';

export type RmonCategory = 'MORADO' | 'AZUL_CLARO' | 'CREMA';

export type IncidentCategory =
  | 'ACCESIBILIDAD_TECNICA'
  | 'DESVIACION_GEOCERCA'
  | 'FALLO_BIOMETRICO_RAM'
  | 'HOSTILIDAD_PROXY'
  | 'EMERGENCIA_C5';

export type IncidentSeverity = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';

export type IncidentStatus = 'REPORTADO' | 'EN_REVISION' | 'RESUELTO' | 'CERRADO_AUDITADO';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  activeViewRole: ActiveViewRole;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RoleAssignment {
  id: string;
  targetUid: string;
  targetEmail: string;
  role: RbacRole;
  cecofamSede: CecofamSede | 'TODAS';
  active: boolean;
  assignedByUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProtocolConfig {
  id: string;
  version: string;
  cecofamSede: CecofamSede | 'GLOBAL';
  maxUavBudget: number;
  gpsLossThresholdSec: number;
  t5mWindowSec: number;
  fBlurRadiusPx: number;
  accessibilityMode: string;
  active: boolean;
  updatedByUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface IncidentReport {
  id: string;
  reporterId: string;
  convivenciaId: string;
  folioFisico: string;
  cecofamSede: CecofamSede;
  category: IncidentCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string;
  evidenceHash: string;
  resolutionNote: string;
  assignedAdminUid: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ConvivenciaSession {
  id: string;
  ownerId: string;
  folioFisico: string;
  folioHash: string;
  kJuez: string;
  cecofamSede: CecofamSede;
  fsmState: FsmState;
  semaphore: SemaphoreLevel;
  uavCost: number;
  ageGroup: AgeGroup;
  iArrScore: number;
  exclusionsClear: boolean;
  ccpSigned: boolean;
  tviVerified: boolean;
  tavVerified: boolean;
  t5mStartMs: number;
  durationMinutes: number;
  lat: number;
  lng: number;
  signalDbm: number;
  batteryPct: number;
  inShadowZone: boolean;
  rpaAlertActive: boolean;
  gpsLossSeconds: number;
  chatAttempts: number;
  pvBlaFailures: number;
  prcActivated: boolean;
  minorClothingDesc: string;
  vehicleDesc: string;
  closingNote: string;
  sealHash: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface EventoBitacora {
  id: string;
  ownerId: string;
  category: RmonCategory;
  eventType: string;
  summary: string;
  hashSha3: string;
  createdAt: Timestamp;
}

export interface MensajeProxy {
  id: string;
  ownerId: string;
  senderRole: 'CUSTODIO' | 'CONVIVIENTE' | 'MONITORISTA';
  rawPreview: string;
  cleanContent: string;
  status: 'RECHAZADO_HOSTIL' | 'SANITIZADO_RETRANSMITIDO' | 'LOGISTICO_LIMPIO';
  hostileTokensCount: number;
  createdAt: Timestamp;
}

export interface LogAuditoriaWorm {
  id: string;
  ownerId: string;
  actorRole: string;
  folioFisico: string;
  action: string;
  justification: string;
  prevHash: string;
  currentHash: string;
  createdAt: Timestamp;
}

export type NotariaSourceType = 'GOOGLE_DOC' | 'GOOGLE_TASK_ACTA' | 'ARCHIVO_LOCAL';

export interface NotariaCsgRecord {
  id: string;
  ownerId: string;
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
  createdAt: Timestamp;
}

export const CECOFAM_COORDS: Record<CecofamSede, { lat: number; lng: number; label: string }> = {
  Ecatepec: { lat: 19.6012, lng: -99.0507, label: 'CECOFAM Ecatepec' },
  Toluca: { lat: 19.2826, lng: -99.6557, label: 'CECOFAM Toluca' },
  'Nicolás Romero': { lat: 19.6227, lng: -99.3134, label: 'CECOFAM Nicolás Romero' },
  Ixtapaluca: { lat: 19.3186, lng: -98.8822, label: 'CECOFAM Ixtapaluca' },
};

export const AGE_GROUP_THRESHOLDS: Record<AgeGroup, { label: string; minArr: number; range: string }> = {
  PRIMERA_INFANCIA: { label: 'Primera Infancia', minArr: 85, range: '0 a 3 años' },
  ESCOLAR: { label: 'Edad Escolar', minArr: 60, range: '4 a 11 años' },
  ADOLESCENTE: { label: 'Adolescencia', minArr: 45, range: '12+ años' },
};
