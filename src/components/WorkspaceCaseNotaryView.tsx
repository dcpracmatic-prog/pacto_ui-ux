import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Download,
  ExternalLink,
  FilePlus2,
  FileSearch,
  FileText,
  FolderOpen,
  ListTodo,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Stamp,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  CsgNotarySession,
  GENESIS_HASH,
  sha3_256Hex,
  verificarSelloCsg,
  type ReporteVerificacionCsg,
  type SelloCsg,
} from '../lib/csgNotary';
import {
  appendTextToGoogleDoc,
  createGoogleDoc,
  createTask,
  createTaskList,
  deleteTask,
  getGoogleDoc,
  listGoogleDocs,
  listTaskLists,
  listTasks,
  updateTask,
  WorkspaceApiError,
  type DriveDocSummary,
  type GoogleDocContent,
  type GoogleTaskItem,
  type GoogleTaskList,
} from '../lib/googleWorkspaceApi';
import { appendNotariaCsgRecord, subscribeNotariasCsg } from '../lib/pactoStore';
import {
  signInWithGoogleWorkspace,
  subscribeWorkspaceAccessToken,
} from '../lib/workspaceAuth';
import type { ConvivenciaSession, NotariaCsgRecord } from '../types/pacto';

interface PendingConfirmation {
  title: string;
  description: string;
  affectedItems: string[];
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}

interface Props {
  uid: string;
  actorRole: 'JUEZ' | 'MONITORISTA' | 'CUSTODIO' | 'CONVIVIENTE' | 'ADMIN' | 'AUDITOR';
  sessions: ConvivenciaSession[];
  selectedId: string | null;
  onSelectId: (id: string) => void;
  lastAuditHash: string;
  isPrivilegedReader: boolean;
  readOnly?: boolean;
}

const MATTER_TYPES = [
  'Visita de Convivencia Programada',
  'Entrega y Recepción CECOFAM',
  'Audiencia / Revisión Judicial',
  'Validación CCP / Onboarding',
  'Seguimiento Psicosocial / Triage',
] as const;

const DOC_TEMPLATES = [
  {
    key: 'ACTA_VISITA',
    label: 'Acta de Visita y Cumplimiento',
  },
  {
    key: 'CONVENIO_FECHAS',
    label: 'Calendario de Visitas y Acuerdos',
  },
  {
    key: 'INFORME_INCIDENCIA',
    label: 'Nota Técnica / Seguimiento del Caso',
  },
] as const;

function extractDateYmd(iso?: string): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function formatShortDate(iso?: string): string {
  if (!iso) return 'Sin fecha';
  const ymd = extractDateYmd(iso);
  return ymd || iso.slice(0, 10);
}

function recordToSelloCsg(rec: NotariaCsgRecord): SelloCsg {
  return {
    schema: 'csg-sello-v1',
    proyecto_id: `pacto-folio-${rec.folioFisico}`,
    evento_id: rec.eventoId,
    aceptado: rec.aceptado,
    razon: rec.aceptado ? '' : 'firma_invalida',
    timestamp: rec.csgTimestamp,
    hash_contenido: rec.hashContenido,
    firmante_pub: rec.firmantePub,
    sello_anterior: rec.selloAnterior,
    cuerpo_hash: rec.cuerpoHash,
    firma_notario: rec.firmaNotario,
    notario_pub: rec.notarioPub,
  };
}

export function WorkspaceCaseNotaryView({
  uid,
  actorRole,
  sessions,
  selectedId,
  onSelectId,
  lastAuditHash,
  isPrivilegedReader,
  readOnly = false,
}: Props) {
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null,
    [sessions, selectedId]
  );

  const [subView, setSubView] = useState<'tasks' | 'docs' | 'csg'>(
    readOnly ? 'csg' : 'tasks'
  );
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authConnecting, setAuthConnecting] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    tone: 'info' | 'error' | 'success';
    text: string;
  } | null>(null);

  // Explicit Confirmation Modal state (Mandatory before any Workspace mutation)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Google Tasks state
  const [taskLists, setTaskLists] = useState<GoogleTaskList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [tasks, setTasks] = useState<GoogleTaskItem[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [filterByFolio, setFilterByFolio] = useState(true);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskMatterType, setNewTaskMatterType] = useState<string>(MATTER_TYPES[0]);
  const [newTaskDue, setNewTaskDue] = useState(() => new Date().toISOString().slice(0, 10));
  const [newTaskNotes, setNewTaskNotes] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState('');
  const [editTaskDue, setEditTaskDue] = useState('');
  const [editTaskNotes, setEditTaskNotes] = useState('');

  // Google Docs + Drive state
  const [driveDocs, setDriveDocs] = useState<DriveDocSummary[]>([]);
  const [docSearch, setDocSearch] = useState('');
  const [docsLoading, setDocsLoading] = useState(false);
  const [openDoc, setOpenDoc] = useState<GoogleDocContent | null>(null);
  const [openDocLoading, setOpenDocLoading] = useState(false);
  const [newDocTemplate, setNewDocTemplate] =
    useState<(typeof DOC_TEMPLATES)[number]['key']>('ACTA_VISITA');
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocSummary, setNewDocSummary] = useState('');
  const [appendDocText, setAppendDocText] = useState('');

  // CSG Notaria state (dcpracmatic-prog/CSG.git)
  const notarioRef = useRef<CsgNotarySession>(new CsgNotarySession(GENESIS_HASH));
  const [, setNotarioTick] = useState(0);
  const [notariaRecords, setNotariaRecords] = useState<NotariaCsgRecord[]>([]);
  const [localFile, setLocalFile] = useState<{
    name: string;
    size: number;
    bytes: Uint8Array;
    sha3Hex: string;
  } | null>(null);
  const [lastIssuedSello, setLastIssuedSello] = useState<SelloCsg | null>(null);
  const [verificationReport, setVerificationReport] = useState<{
    label: string;
    report: ReporteVerificacionCsg;
  } | null>(null);
  const [verifyTargetRecord, setVerifyTargetRecord] = useState<NotariaCsgRecord | null>(null);
  const [verifyFileInputRef] = useState<{ current: HTMLInputElement | null }>({ current: null });
  const localUploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const unsub = subscribeWorkspaceAccessToken((tok) => {
      setAccessToken(tok);
      if (tok) setNeedsReauth(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!activeSession) {
      setNotariaRecords([]);
      return;
    }
    const unsub = subscribeNotariasCsg(
      uid,
      activeSession.id,
      (rows) => {
        setNotariaRecords(rows);
        if (rows[0]?.cuerpoHash) {
          notarioRef.current.setUltimoHash(rows[0].cuerpoHash);
        }
      },
      isPrivilegedReader
    );
    return () => unsub();
  }, [uid, activeSession?.id, isPrivilegedReader]);

  const handleWorkspaceError = useCallback((err: unknown, fallback: string) => {
    if (err instanceof WorkspaceApiError && err.requiresReauth) {
      setNeedsReauth(true);
      setStatusBanner({
        tone: 'error',
        text: 'Tu autorización temporal de Google Workspace expiró o falta consentimiento. Haz clic en "Conectar Google Workspace" para renovarla en memoria.',
      });
      return;
    }
    setStatusBanner({
      tone: 'error',
      text: err instanceof Error ? err.message : fallback,
    });
  }, []);

  const handleConnectWorkspace = async () => {
    setAuthConnecting(true);
    setStatusBanner(null);
    try {
      const res = await signInWithGoogleWorkspace({ forceConsent: true });
      if (!res.accessToken) {
        setStatusBanner({
          tone: 'error',
          text: 'Google no devolvió un token de acceso en esta ventana. Intenta nuevamente aceptando los permisos de Tasks y Docs.',
        });
      } else {
        setNeedsReauth(false);
        setStatusBanner({
          tone: 'success',
          text: 'Sesión de Google Tasks y Google Docs conectada en memoria RAM.',
        });
      }
    } catch (err) {
      setStatusBanner({
        tone: 'error',
        text: err instanceof Error ? err.message : 'No se pudo conectar Google Workspace.',
      });
    } finally {
      setAuthConnecting(false);
    }
  };

  const loadTasksData = useCallback(
    async (tok: string, preferredListId?: string) => {
      setTasksLoading(true);
      try {
        const lists = await listTaskLists(tok);
        setTaskLists(lists);
        const pactoList =
          lists.find((l) => l.title.toLowerCase().includes('pacto')) ?? lists[0] ?? null;
        const targetId =
          preferredListId && lists.some((l) => l.id === preferredListId)
            ? preferredListId
            : pactoList?.id ?? '';
        setSelectedListId(targetId);
        if (targetId) {
          const items = await listTasks(tok, targetId);
          setTasks(items);
        } else {
          setTasks([]);
        }
      } catch (err) {
        handleWorkspaceError(err, 'No se pudieron cargar las listas de Google Tasks.');
      } finally {
        setTasksLoading(false);
      }
    },
    [handleWorkspaceError]
  );

  const loadDocsData = useCallback(
    async (tok: string, search?: string) => {
      setDocsLoading(true);
      try {
        const files = await listGoogleDocs(tok, search);
        setDriveDocs(files);
      } catch (err) {
        handleWorkspaceError(err, 'No se pudieron listar los documentos de Google Docs.');
      } finally {
        setDocsLoading(false);
      }
    },
    [handleWorkspaceError]
  );

  useEffect(() => {
    if (!accessToken || readOnly) return;
    if (subView === 'tasks') {
      void loadTasksData(accessToken, selectedListId || undefined);
    } else if (subView === 'docs') {
      void loadDocsData(accessToken, docSearch);
    }
  }, [accessToken, subView, readOnly]);

  const executeConfirmedAction = async () => {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    try {
      await pendingConfirm.onConfirm();
      setPendingConfirm(null);
    } catch (err) {
      setPendingConfirm(null);
      handleWorkspaceError(err, 'Error ejecutando la operación en Google Workspace.');
    } finally {
      setConfirmBusy(false);
    }
  };

  const folioTag = activeSession ? `[Folio ${activeSession.folioFisico}]` : '';

  const visibleTasks = useMemo(() => {
    if (!filterByFolio || !activeSession) return tasks;
    return tasks.filter(
      (t) =>
        t.title.includes(activeSession.folioFisico) ||
        (t.notes ?? '').includes(activeSession.folioFisico)
    );
  }, [tasks, filterByFolio, activeSession]);

  // --- Google Tasks Handlers (Always gated via pendingConfirm) ---

  const requestCreatePactoTaskList = () => {
    if (!accessToken || readOnly) return;
    setPendingConfirm({
      title: 'Crear lista dedicada en Google Tasks',
      description:
        'Se creará una nueva lista de tareas en tu cuenta de Google para organizar visitas y asuntos del Protocolo PACTO.',
      affectedItems: ['Nueva lista: "PACTO · Visitas y Asuntos"'],
      confirmLabel: 'Crear lista en Google Tasks',
      onConfirm: async () => {
        const created = await createTaskList(accessToken, 'PACTO · Visitas y Asuntos');
        await loadTasksData(accessToken, created.id);
        setStatusBanner({
          tone: 'success',
          text: `Lista "${created.title}" creada en Google Tasks.`,
        });
      },
    });
  };

  const requestCreateTask = () => {
    if (!accessToken || !selectedListId || !activeSession || readOnly) return;
    const rawTitle = newTaskTitle.trim() || newTaskMatterType;
    const finalTitle = rawTitle.includes(activeSession.folioFisico)
      ? rawTitle
      : `${folioTag} ${rawTitle}`;
    const finalNotes = [
      `Expediente PACTO · Folio ${activeSession.folioFisico} · Sede ${activeSession.cecofamSede}`,
      `Asunto: ${newTaskMatterType}`,
      newTaskNotes.trim() ? `Detalle: ${newTaskNotes.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    setPendingConfirm({
      title: 'Programar fecha de visita o asunto en Google Tasks',
      description:
        'Se agregará una tarea vinculada a este expediente en tu lista seleccionada de Google Tasks.',
      affectedItems: [
        `Título: ${finalTitle}`,
        `Fecha programada: ${newTaskDue || 'Sin fecha'}`,
        `Lista destino ID: ${selectedListId}`,
      ],
      confirmLabel: 'Confirmar y crear tarea',
      onConfirm: async () => {
        await createTask(accessToken, selectedListId, {
          title: finalTitle,
          notes: finalNotes,
          dueDateYmd: newTaskDue,
        });
        setNewTaskTitle('');
        setNewTaskNotes('');
        await loadTasksData(accessToken, selectedListId);
        setStatusBanner({
          tone: 'success',
          text: `Fecha registrada en Google Tasks para el folio ${activeSession.folioFisico}.`,
        });
      },
    });
  };

  const requestToggleTaskStatus = (task: GoogleTaskItem) => {
    if (!accessToken || !selectedListId || readOnly) return;
    const nextStatus = task.status === 'completed' ? 'needsAction' : 'completed';
    setPendingConfirm({
      title:
        nextStatus === 'completed'
          ? 'Marcar visita/asunto como completado'
          : 'Reabrir visita/asunto en Google Tasks',
      description: 'Se actualizará el estado de esta tarea directamente en Google Tasks.',
      affectedItems: [
        `Tarea: ${task.title}`,
        `Estado actual: ${task.status === 'completed' ? 'Completada' : 'Pendiente'}`,
        `Nuevo estado: ${nextStatus === 'completed' ? 'Completada' : 'Pendiente'}`,
      ],
      confirmLabel:
        nextStatus === 'completed' ? 'Confirmar completado' : 'Confirmar reapertura',
      onConfirm: async () => {
        await updateTask(accessToken, selectedListId, task.id, { status: nextStatus });
        await loadTasksData(accessToken, selectedListId);
        setStatusBanner({
          tone: 'success',
          text: `Estado de "${task.title}" actualizado en Google Tasks.`,
        });
      },
    });
  };

  const requestSaveEditedTask = (task: GoogleTaskItem) => {
    if (!accessToken || !selectedListId || readOnly) return;
    setPendingConfirm({
      title: 'Actualizar fecha o detalle de tarea en Google Tasks',
      description: 'Se sobrescribirán el título, fecha límite y notas de la tarea seleccionada.',
      affectedItems: [
        `Título nuevo: ${editTaskTitle.trim() || task.title}`,
        `Fecha nueva: ${editTaskDue || 'Sin fecha'}`,
      ],
      confirmLabel: 'Guardar cambios en Google Tasks',
      onConfirm: async () => {
        await updateTask(accessToken, selectedListId, task.id, {
          title: editTaskTitle.trim() || task.title,
          dueDateYmd: editTaskDue,
          notes: editTaskNotes,
        });
        setEditingTaskId(null);
        await loadTasksData(accessToken, selectedListId);
        setStatusBanner({
          tone: 'success',
          text: 'Tarea actualizada correctamente en Google Tasks.',
        });
      },
    });
  };

  const requestDeleteTask = (task: GoogleTaskItem) => {
    if (!accessToken || !selectedListId || readOnly) return;
    setPendingConfirm({
      title: 'Eliminar tarea de Google Tasks',
      description:
        'Esta acción eliminará permanentemente la fecha/asunto de tu lista de Google Tasks y no se puede deshacer.',
      affectedItems: [
        `Tarea a eliminar: ${task.title}`,
        `Fecha: ${formatShortDate(task.due)}`,
      ],
      confirmLabel: 'Eliminar definitivamente',
      destructive: true,
      onConfirm: async () => {
        await deleteTask(accessToken, selectedListId, task.id);
        await loadTasksData(accessToken, selectedListId);
        setStatusBanner({
          tone: 'info',
          text: `Tarea "${task.title}" eliminada de Google Tasks.`,
        });
      },
    });
  };

  // --- Google Docs Handlers (Always gated via pendingConfirm) ---

  const handleOpenGoogleDoc = async (documentId: string) => {
    if (!accessToken) return;
    setOpenDocLoading(true);
    setStatusBanner(null);
    try {
      const docData = await getGoogleDoc(accessToken, documentId);
      setOpenDoc(docData);
    } catch (err) {
      handleWorkspaceError(err, 'No se pudo abrir el documento en Google Docs.');
    } finally {
      setOpenDocLoading(false);
    }
  };

  const requestCreateGoogleDoc = () => {
    if (!accessToken || !activeSession || readOnly) return;
    const tmplLabel =
      DOC_TEMPLATES.find((t) => t.key === newDocTemplate)?.label ?? 'Documento del Caso';
    const docTitle =
      newDocTitle.trim() ||
      `PACTO · ${tmplLabel} · Folio ${activeSession.folioFisico}`;
    const fechaHoy = new Date().toISOString().slice(0, 10);
    const bodyText = [
      `PROTOCOLO PACTO — ${tmplLabel.toUpperCase()}`,
      `Folio Físico: ${activeSession.folioFisico} | Sede CECOFAM: ${activeSession.cecofamSede}`,
      `Estado FSM: ${activeSession.fsmState} | Fecha de emisión: ${fechaHoy}`,
      `Operador emisor: ${actorRole}`,
      '',
      '1. OBJETO Y FECHAS DE VISITA / ASUNTO:',
      newDocSummary.trim() ||
        `Registro operativo y programación de seguimiento convivencial correspondiente al expediente ${activeSession.folioFisico}.`,
      '',
      '2. CONSTANCIA DE TRAZABILIDAD:',
      'Este documento es susceptible de sellado criptográfico SHA3-256 + Ed25519 mediante Notaría CSG.',
    ].join('\n');

    setPendingConfirm({
      title: 'Crear nuevo documento en Google Docs',
      description:
        'Se creará un documento en tu Google Drive / Docs con la estructura del expediente seleccionado.',
      affectedItems: [
        `Título: ${docTitle}`,
        `Expediente: Folio ${activeSession.folioFisico} (${activeSession.cecofamSede})`,
      ],
      confirmLabel: 'Confirmar y crear Google Doc',
      onConfirm: async () => {
        const created = await createGoogleDoc(accessToken, docTitle, bodyText);
        setNewDocTitle('');
        setNewDocSummary('');
        setOpenDoc(created);
        await loadDocsData(accessToken, docSearch);
        setStatusBanner({
          tone: 'success',
          text: `Documento "${created.title}" creado en Google Docs.`,
        });
      },
    });
  };

  const requestAppendToGoogleDoc = (textOverride?: string, customTitle?: string) => {
    if (!accessToken || !openDoc || readOnly) return;
    const text = (textOverride ?? appendDocText).trim();
    if (!text) return;

    setPendingConfirm({
      title: customTitle ?? 'Anexar contenido en Google Docs',
      description:
        'Se insertará el siguiente bloque de texto al final del documento abierto en Google Docs.',
      affectedItems: [
        `Documento: ${openDoc.title} (${openDoc.documentId})`,
        `Texto a anexar: ${text.slice(0, 160)}${text.length > 160 ? '...' : ''}`,
      ],
      confirmLabel: 'Confirmar inserción en Google Docs',
      onConfirm: async () => {
        const updated = await appendTextToGoogleDoc(accessToken, openDoc.documentId, text);
        setOpenDoc(updated);
        if (!textOverride) setAppendDocText('');
        setStatusBanner({
          tone: 'success',
          text: `Contenido anexado a "${updated.title}" en Google Docs.`,
        });
      },
    });
  };

  // --- CSG Notaría Handlers (dcpracmatic-prog/CSG.git) ---

  const handleNotarizeOpenDocCsg = async () => {
    if (!activeSession || !openDoc || readOnly) return;
    try {
      const canonicalDocPayload = JSON.stringify({
        documentId: openDoc.documentId,
        revisionId: openDoc.revisionId ?? 'latest',
        title: openDoc.title,
        folioFisico: activeSession.folioFisico,
        plainText: openDoc.plainText,
      });
      const { sello, verificacion } = await notarioRef.current.notarizarContenido({
        contentBytesOrText: canonicalDocPayload,
        proyectoId: `pacto-folio-${activeSession.folioFisico}`,
        tipo: 'archivo',
        metadatos: {
          fuente: 'google_docs',
          document_id: openDoc.documentId,
          actor: actorRole,
        },
      });
      setLastIssuedSello(sello);
      setVerificationReport({
        label: `Google Doc "${openDoc.title}"`,
        report: verificacion,
      });
      await appendNotariaCsgRecord({
        uid,
        convivenciaId: activeSession.id,
        folioFisico: activeSession.folioFisico,
        sourceType: 'GOOGLE_DOC',
        sourceRefId: openDoc.documentId,
        sourceTitle: openDoc.title,
        docUrl: openDoc.webViewLink,
        eventoId: sello.evento_id,
        hashContenido: sello.hash_contenido,
        cuerpoHash: sello.cuerpo_hash,
        selloAnterior: sello.sello_anterior,
        firmantePub: sello.firmante_pub,
        notarioPub: sello.notario_pub,
        firmaNotario: sello.firma_notario,
        aceptado: sello.aceptado,
        csgTimestamp: sello.timestamp,
        actorRole,
        prevAuditHash: lastAuditHash,
      });
      setNotarioTick((t) => t + 1);
      setStatusBanner({
        tone: 'success',
        text: `Google Doc "${openDoc.title}" notarizado con Sello CSG (SHA3-256 + Ed25519) y archivado en Firestore.`,
      });
    } catch (err) {
      setStatusBanner({
        tone: 'error',
        text: err instanceof Error ? err.message : 'No se pudo notarizar el Google Doc.',
      });
      setNotarioTick((t) => t + 1);
    }
  };

  const handleNotarizeTasksAgendaCsg = async () => {
    if (!activeSession || visibleTasks.length === 0 || readOnly) return;
    try {
      const agendaCanonical = JSON.stringify({
        folioFisico: activeSession.folioFisico,
        taskListId: selectedListId,
        tasks: visibleTasks.map((t) => ({
          id: t.id,
          title: t.title,
          due: t.due ?? '',
          status: t.status,
          notes: t.notes ?? '',
        })),
      });
      const { sello, verificacion } = await notarioRef.current.notarizarContenido({
        contentBytesOrText: agendaCanonical,
        proyectoId: `pacto-folio-${activeSession.folioFisico}`,
        tipo: 'transaccion',
        metadatos: {
          fuente: 'google_tasks',
          total_tareas: String(visibleTasks.length),
          actor: actorRole,
        },
      });
      setLastIssuedSello(sello);
      setVerificationReport({
        label: `Agenda Google Tasks (${visibleTasks.length} registros)`,
        report: verificacion,
      });
      await appendNotariaCsgRecord({
        uid,
        convivenciaId: activeSession.id,
        folioFisico: activeSession.folioFisico,
        sourceType: 'GOOGLE_TASK_ACTA',
        sourceRefId: selectedListId || `tasks-${activeSession.folioFisico}`,
        sourceTitle: `Agenda de Visitas (${visibleTasks.length} asuntos) · Folio ${activeSession.folioFisico}`,
        docUrl: 'https://tasks.google.com/',
        eventoId: sello.evento_id,
        hashContenido: sello.hash_contenido,
        cuerpoHash: sello.cuerpo_hash,
        selloAnterior: sello.sello_anterior,
        firmantePub: sello.firmante_pub,
        notarioPub: sello.notario_pub,
        firmaNotario: sello.firma_notario,
        aceptado: sello.aceptado,
        csgTimestamp: sello.timestamp,
        actorRole,
        prevAuditHash: lastAuditHash,
      });
      setNotarioTick((t) => t + 1);
      setStatusBanner({
        tone: 'success',
        text: `Agenda de ${visibleTasks.length} fechas/asuntos notarizada con Sello CSG.`,
      });
    } catch (err) {
      setStatusBanner({
        tone: 'error',
        text: err instanceof Error ? err.message : 'No se pudo notarizar la agenda.',
      });
      setNotarioTick((t) => t + 1);
    }
  };

  const handleSelectLocalFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const sha3Hex = sha3_256Hex(bytes);
    setLocalFile({
      name: file.name,
      size: file.size,
      bytes,
      sha3Hex,
    });
  };

  const handleNotarizeLocalFile = async () => {
    if (!activeSession || !localFile || readOnly) return;
    try {
      const { sello, verificacion } = await notarioRef.current.notarizarContenido({
        contentBytesOrText: localFile.bytes,
        proyectoId: `pacto-folio-${activeSession.folioFisico}`,
        tipo: 'archivo',
        metadatos: {
          nombre_archivo: localFile.name,
          bytes: String(localFile.size),
          actor: actorRole,
        },
      });
      setLastIssuedSello(sello);
      setVerificationReport({
        label: `Archivo local "${localFile.name}"`,
        report: verificacion,
      });
      await appendNotariaCsgRecord({
        uid,
        convivenciaId: activeSession.id,
        folioFisico: activeSession.folioFisico,
        sourceType: 'ARCHIVO_LOCAL',
        sourceRefId: localFile.name,
        sourceTitle: localFile.name,
        docUrl: '',
        eventoId: sello.evento_id,
        hashContenido: sello.hash_contenido,
        cuerpoHash: sello.cuerpo_hash,
        selloAnterior: sello.sello_anterior,
        firmantePub: sello.firmante_pub,
        notarioPub: sello.notario_pub,
        firmaNotario: sello.firma_notario,
        aceptado: sello.aceptado,
        csgTimestamp: sello.timestamp,
        actorRole,
        prevAuditHash: lastAuditHash,
      });
      setNotarioTick((t) => t + 1);
      setStatusBanner({
        tone: 'success',
        text: `Archivo "${localFile.name}" sellado criptográficamente con Notaría CSG.`,
      });
    } catch (err) {
      setStatusBanner({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Error al notarizar archivo local.',
      });
      setNotarioTick((t) => t + 1);
    }
  };

  const handleVerifyRecord = (rec: NotariaCsgRecord, fileBytes?: Uint8Array | null) => {
    const sello = recordToSelloCsg(rec);
    const report = verificarSelloCsg(sello, fileBytes ?? null, rec.selloAnterior);
    setVerificationReport({
      label: `${rec.sourceTitle} (${rec.eventoId})`,
      report,
    });
    if (fileBytes && report.checks.content_digest_match === false) {
      void notarioRef.current
        .registrarVerificacionFallida('hash_contenido_alterado', `${rec.eventoId}:${rec.hashContenido}`)
        .then(() => setNotarioTick((t) => t + 1));
    }
  };

  const handleSimulateForgedSealTest = async () => {
    if (!activeSession || readOnly) return;
    try {
      const { sello, verificacion } = await notarioRef.current.notarizarContenido({
        contentBytesOrText: `PRUEBA_ALTERACION_${Date.now()}`,
        proyectoId: `pacto-folio-${activeSession.folioFisico}`,
        tipo: 'archivo',
        simulateForgedSignature: true,
      });
      setLastIssuedSello(sello);
      setVerificationReport({
        label: 'Prueba de Firma Alterada (NotarioProtegido CSG)',
        report: verificacion,
      });
      setNotarioTick((t) => t + 1);
      setStatusBanner({
        tone: 'info',
        text: `Intento rechazado por CSG (${sello.razon}). Conatus incrementado a ${notarioRef.current
          .getEstadoProteccion()
          .conatus.toFixed(2)}× y huella cifrada en damage_log.`,
      });
    } catch (err) {
      setNotarioTick((t) => t + 1);
      setStatusBanner({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Ruptura estructural alcanzada.',
      });
    }
  };

  const handleResetNotario = () => {
    notarioRef.current.zeroizeAndDestroy();
    const latestHash = notariaRecords[0]?.cuerpoHash ?? GENESIS_HASH;
    notarioRef.current = new CsgNotarySession(latestHash);
    setNotarioTick((t) => t + 1);
    setStatusBanner({
      tone: 'info',
      text: 'Nueva instancia de NotarioProtegido CSG inicializada con claves Ed25519 frescas en RAM.',
    });
  };

  const downloadSelloJson = (sello: SelloCsg) => {
    const blob = new Blob([JSON.stringify(sello, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sello.evento_id}.csg.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const proteccion = notarioRef.current.getEstadoProteccion();

  if (!activeSession) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3">
        <Lock className="w-7 h-7 text-slate-400 mx-auto" />
        <h2 className="font-display text-base font-semibold text-slate-900">
          Selecciona o crea un expediente PACTO primero
        </h2>
        <p className="text-xs text-slate-600 max-w-md mx-auto">
          La agenda en Google Tasks, los documentos en Google Docs y la Notaría CSG se vinculan a
          un Folio Físico de 8 dígitos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Toolbar: Case Selector + Segmented Views + Workspace Auth Status */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Agenda, Expediente Documental y Notaría CSG</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-800 tabular-nums">
              Folio {activeSession.folioFisico}
            </span>
            <span aria-hidden="true">·</span>
            <span>{activeSession.cecofamSede}</span>
          </div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            {readOnly
              ? 'Verificación Notarial CSG (Solo Lectura)'
              : 'Gestión de Fechas (Google Tasks), Actas (Google Docs) y Notaría CSG'}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {sessions.length > 1 && (
            <select
              aria-label="Seleccionar expediente"
              value={activeSession.id}
              onChange={(e) => onSelectId(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 min-h-[38px]"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  Folio {s.folioFisico} · {s.cecofamSede}
                </option>
              ))}
            </select>
          )}

          {!readOnly && (
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setSubView('tasks')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                  subView === 'tasks'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ListTodo className="w-3.5 h-3.5" />
                <span>Google Tasks</span>
              </button>
              <button
                type="button"
                onClick={() => setSubView('docs')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                  subView === 'docs'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Google Docs</span>
              </button>
              <button
                type="button"
                onClick={() => setSubView('csg')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                  subView === 'csg'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Stamp className="w-3.5 h-3.5" />
                <span>Notaría CSG ({notariaRecords.length})</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {statusBanner && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs flex items-center justify-between gap-4 ${
            statusBanner.tone === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : statusBanner.tone === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : 'bg-slate-900 border-slate-900 text-white'
          }`}
        >
          <span>{statusBanner.text}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="underline shrink-0 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Workspace OAuth Prompt (when token is absent from memory after reload or expired) */}
      {!readOnly && (subView === 'tasks' || subView === 'docs') && (!accessToken || needsReauth) && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Conectar autorización de Google Tasks y Google Docs
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Por seguridad, los tokens de acceso de Google Workspace se conservan únicamente en la
              memoria RAM de esta pestaña y se limpian al recargar o cerrar sesión. Conéctate con
              tu cuenta Google para leer y administrar fechas y documentos del expediente.
            </p>
          </div>
          <button
            type="button"
            onClick={handleConnectWorkspace}
            disabled={authConnecting}
            className="min-h-[44px] py-2.5 px-4 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 border border-slate-300 text-xs font-medium rounded-lg transition-colors flex items-center gap-2.5 whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
          >
            <svg
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 48 48"
              className="w-4 h-4 shrink-0"
              aria-hidden="true"
            >
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            <span>
              {authConnecting ? 'Conectando...' : 'Conectar Google Tasks y Docs'}
            </span>
          </button>
        </div>
      )}

      {/* VIEW 1: GOOGLE TASKS — SCHEDULE VISIT DATES & CASE MATTERS */}
      {!readOnly && subView === 'tasks' && accessToken && !needsReauth && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Create Task / Schedule Visit */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-slate-800" />
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Programar Visita o Asunto
                </h3>
              </div>
              <button
                type="button"
                onClick={requestCreatePactoTaskList}
                className="text-xs font-medium text-slate-700 hover:text-slate-900 underline cursor-pointer"
              >
                + Lista PACTO
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 mb-1" htmlFor="tasks-list-select">
                  Lista en Google Tasks
                </label>
                <div className="flex gap-2">
                  <select
                    id="tasks-list-select"
                    value={selectedListId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedListId(nextId);
                      void loadTasksData(accessToken, nextId);
                    }}
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900"
                  >
                    {taskLists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.title}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void loadTasksData(accessToken, selectedListId)}
                    className="px-3 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer"
                    aria-label="Actualizar listas de Google Tasks"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-slate-700" />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-slate-600 mb-1" htmlFor="task-matter-type">
                  Categoría del Asunto / Visita
                </label>
                <select
                  id="task-matter-type"
                  value={newTaskMatterType}
                  onChange={(e) => setNewTaskMatterType(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900"
                >
                  {MATTER_TYPES.map((mt) => (
                    <option key={mt} value={mt}>
                      {mt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-600 mb-1" htmlFor="task-title-input">
                  Descripción breve (se prefija con {folioTag})
                </label>
                <input
                  id="task-title-input"
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Ej. Visita dominical Parque Naucalli · Entrega 10:00h"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1" htmlFor="task-due-input">
                  Fecha de Visita o Vencimiento
                </label>
                <input
                  id="task-due-input"
                  type="date"
                  value={newTaskDue}
                  onChange={(e) => setNewTaskDue(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono tabular-nums"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1" htmlFor="task-notes-input">
                  Notas / Acuerdos del Caso
                </label>
                <textarea
                  id="task-notes-input"
                  rows={3}
                  value={newTaskNotes}
                  onChange={(e) => setNewTaskNotes(e.target.value)}
                  placeholder="Punto autorizado, horarios de entrega/retorno o documentación pendiente..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <button
                type="button"
                disabled={!selectedListId}
                onClick={requestCreateTask}
                className="w-full min-h-[42px] px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-medium rounded-xl flex items-center justify-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Agendar en Google Tasks</span>
              </button>
            </div>
          </div>

          {/* Right: Case Tasks List */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Fechas y Asuntos en Google Tasks ({visibleTasks.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Toda modificación solicita confirmación previa antes de enviarse a Google Tasks.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFilterByFolio((v) => !v)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border whitespace-nowrap shrink-0 cursor-pointer ${
                    filterByFolio
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  {filterByFolio ? `Solo Folio ${activeSession.folioFisico}` : 'Todas las tareas'}
                </button>
                <button
                  type="button"
                  disabled={visibleTasks.length === 0}
                  onClick={handleNotarizeTasksAgendaCsg}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-slate-800 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Stamp className="w-3.5 h-3.5" />
                  <span>Notarizar Agenda CSG</span>
                </button>
              </div>
            </div>

            {tasksLoading ? (
              <div className="py-10 text-center text-xs text-slate-500">
                Sincronizando tareas desde Google Tasks...
              </div>
            ) : visibleTasks.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500 space-y-2 border border-dashed border-slate-200 rounded-xl">
                <p>
                  No hay fechas o asuntos registrados
                  {filterByFolio ? ` para el folio ${activeSession.folioFisico}` : ''}.
                </p>
                <p>Usa el formulario de la izquierda para agendar la primera visita.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[520px] overflow-y-auto">
                {visibleTasks.map((task) => {
                  const isEditing = editingTaskId === task.id;
                  const isCompleted = task.status === 'completed';
                  return (
                    <div
                      key={task.id}
                      className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                            <span>{formatShortDate(task.due)}</span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={
                                isCompleted ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'
                              }
                            >
                              {isCompleted ? 'Completada' : 'Pendiente'}
                            </span>
                          </div>
                          <p
                            className={`text-sm font-medium ${
                              isCompleted ? 'line-through text-slate-500' : 'text-slate-900'
                            }`}
                          >
                            {task.title}
                          </p>
                          {task.notes && !isEditing && (
                            <p className="text-xs text-slate-600 whitespace-pre-line leading-relaxed">
                              {task.notes}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => requestToggleTaskStatus(task)}
                            className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-800 whitespace-nowrap cursor-pointer"
                          >
                            {isCompleted ? 'Reabrir' : 'Completar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (isEditing) {
                                setEditingTaskId(null);
                              } else {
                                setEditingTaskId(task.id);
                                setEditTaskTitle(task.title);
                                setEditTaskDue(extractDateYmd(task.due));
                                setEditTaskNotes(task.notes ?? '');
                              }
                            }}
                            className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700 cursor-pointer"
                          >
                            {isEditing ? 'Cancelar' : 'Editar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDeleteTask(task)}
                            aria-label={`Eliminar tarea ${task.title}`}
                            className="p-1.5 bg-white border border-red-200 hover:bg-red-50 rounded-lg text-red-700 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {isEditing && (
                        <div className="pt-2 border-t border-slate-200 space-y-2 text-xs">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              type="text"
                              value={editTaskTitle}
                              onChange={(e) => setEditTaskTitle(e.target.value)}
                              className="sm:col-span-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
                            />
                            <input
                              type="date"
                              value={editTaskDue}
                              onChange={(e) => setEditTaskDue(e.target.value)}
                              className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono tabular-nums"
                            />
                          </div>
                          <textarea
                            rows={2}
                            value={editTaskNotes}
                            onChange={(e) => setEditTaskNotes(e.target.value)}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
                          />
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => requestSaveEditedTask(task)}
                              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg cursor-pointer"
                            >
                              Guardar cambios
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: GOOGLE DOCS + DRIVE — CASE DOCUMENTS & DIRECT CSG NOTARIZATION */}
      {!readOnly && subView === 'docs' && accessToken && !needsReauth && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Search / Browse Drive Docs + Create Case Doc */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-slate-800" />
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    Documentos en Google Drive
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => void loadDocsData(accessToken, docSearch)}
                  className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                  aria-label="Recargar documentos de Drive"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-slate-700" />
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={docSearch}
                  onChange={(e) => setDocSearch(e.target.value)}
                  placeholder="Buscar por nombre o folio..."
                  className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                />
                <button
                  type="button"
                  onClick={() => void loadDocsData(accessToken, docSearch)}
                  className="px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-xl cursor-pointer"
                >
                  Buscar
                </button>
              </div>

              {docsLoading ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  Consultando Google Docs en Drive...
                </p>
              ) : driveDocs.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">
                  No se encontraron documentos Google Docs con ese criterio.
                </p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {driveDocs.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => void handleOpenGoogleDoc(d.id)}
                      className={`w-full text-left p-3 rounded-xl border text-xs flex items-center justify-between gap-2 cursor-pointer ${
                        openDoc?.documentId === d.id
                          ? 'border-slate-900 bg-slate-50'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{d.name}</p>
                        <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                          Modificado: {formatShortDate(d.modifiedTime)}
                        </p>
                      </div>
                      <FileSearch className="w-4 h-4 text-slate-500 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3 text-xs">
              <div className="flex items-center gap-2">
                <FilePlus2 className="w-5 h-5 text-slate-800" />
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Crear Acta / Documento del Caso
                </h3>
              </div>

              <div>
                <label className="block text-slate-600 mb-1" htmlFor="doc-template-select">
                  Plantilla de Documento
                </label>
                <select
                  id="doc-template-select"
                  value={newDocTemplate}
                  onChange={(e) =>
                    setNewDocTemplate(e.target.value as (typeof DOC_TEMPLATES)[number]['key'])
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                >
                  {DOC_TEMPLATES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-600 mb-1" htmlFor="doc-title-input">
                  Título en Google Docs (opcional)
                </label>
                <input
                  id="doc-title-input"
                  type="text"
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  placeholder={`PACTO · Acta · Folio ${activeSession.folioFisico}`}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-slate-600 mb-1" htmlFor="doc-body-input">
                  Resumen de visita, fechas o acuerdo inicial
                </label>
                <textarea
                  id="doc-body-input"
                  rows={3}
                  value={newDocSummary}
                  onChange={(e) => setNewDocSummary(e.target.value)}
                  placeholder="Describe fechas acordadas, puntos de entrega o hechos verificados..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>

              <button
                type="button"
                onClick={requestCreateGoogleDoc}
                className="w-full min-h-[42px] px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-xl cursor-pointer"
              >
                Crear Documento en Google Docs
              </button>
            </div>
          </div>

          {/* Right: Open Doc Viewer + Append + CSG Seal */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
            {openDocLoading ? (
              <div className="py-12 text-center text-xs text-slate-500">
                Leyendo estructura del documento desde Google Docs API...
              </div>
            ) : !openDoc ? (
              <div className="py-12 text-center text-xs text-slate-500 space-y-2">
                <FileText className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="font-medium text-slate-700">Ningún documento seleccionado</p>
                <p>
                  Elige un documento de la lista de Google Drive o crea un acta nueva para leer su
                  contenido, anexar seguimientos o notarizarlo con CSG.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                  <div className="space-y-1 min-w-0">
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      {openDoc.title}
                    </h3>
                    <p className="text-[11px] font-mono text-slate-500 break-all">
                      ID: {openDoc.documentId} · Revisión: {openDoc.revisionId || 'actual'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <a
                      href={openDoc.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 text-xs font-medium border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-800 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Abrir en Docs</span>
                    </a>
                    <button
                      type="button"
                      onClick={handleNotarizeOpenDocCsg}
                      className="px-3.5 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <Stamp className="w-3.5 h-3.5" />
                      <span>Notarizar Doc con CSG</span>
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl max-h-64 overflow-y-auto">
                  <pre className="text-xs text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">
                    {openDoc.plainText || '(Documento sin texto)'}
                  </pre>
                </div>

                <div className="space-y-2.5 text-xs">
                  <label className="block font-medium text-slate-700" htmlFor="append-doc-textarea">
                    Anexar acta de seguimiento / fecha de visita al documento
                  </label>
                  <textarea
                    id="append-doc-textarea"
                    rows={3}
                    value={appendDocText}
                    onChange={(e) => setAppendDocText(e.target.value)}
                    placeholder="Ej. [2026-11-27] Constancia de entrega puntual en CECOFAM. Próxima visita confirmada."
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={!appendDocText.trim()}
                      onClick={() => requestAppendToGoogleDoc()}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white font-medium rounded-xl cursor-pointer"
                    >
                      Anexar Texto en Google Docs
                    </button>

                    {lastIssuedSello && lastIssuedSello.aceptado && (
                      <button
                        type="button"
                        onClick={() =>
                          requestAppendToGoogleDoc(
                            `\n--- SELLO NOTARIAL CSG (${lastIssuedSello.schema}) ---\nEvento: ${lastIssuedSello.evento_id}\nSHA3-256 Contenido: ${lastIssuedSello.hash_contenido}\nHash Cuerpo Sello: ${lastIssuedSello.cuerpo_hash}\nFirma Ed25519 Notario: ${lastIssuedSello.firma_notario.slice(0, 48)}...\nClave Pública Notario: ${lastIssuedSello.notario_pub}`,
                            'Estampar certificado CSG en Google Docs'
                          )
                        }
                        className="px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-800 font-medium rounded-xl cursor-pointer"
                      >
                        Estampar Último Sello CSG en Doc
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* VIEW 3: CSG NOTARÍA (dcpracmatic-prog/CSG.git) — ACTIVE FOR OPERATORS + READ-ONLY FOR AUDITOR */}
      {(subView === 'csg' || readOnly) && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: CSG NotarioProtegido Cryptographic Status & Local File Sealing */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-slate-900" />
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      NotarioProtegido CSG (Ed25519 + SHA3-256)
                    </h3>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={handleResetNotario}
                      className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reiniciar llaves</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2.5 text-xs">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="text-slate-500">Conatus</div>
                    <div className="font-mono text-base font-semibold text-slate-900 mt-0.5 tabular-nums">
                      {proteccion.conatus.toFixed(2)}×
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="text-slate-500">Fallos</div>
                    <div className="font-mono text-base font-semibold text-slate-900 mt-0.5 tabular-nums">
                      {proteccion.intentos_fallidos} / {notarioRef.current.politica.umbral_ruptura}
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="text-slate-500">Integridad</div>
                    <div
                      className={`font-mono text-xs font-semibold mt-1 ${
                        proteccion.estructura_rota ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {proteccion.estructura_rota ? 'ROTA' : 'Íntegra'}
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-mono text-slate-600 space-y-1 break-all">
                  <div>Notario Pub: {notarioRef.current.notarioPubHex.slice(0, 32)}...</div>
                  <div>Firmante Pub: {notarioRef.current.firmantePubHex.slice(0, 32)}...</div>
                  <div>Último Eslabón: {notarioRef.current.getUltimoHash().slice(0, 32)}...</div>
                </div>

                {!readOnly && (
                  <div className="space-y-3 pt-1 border-t border-slate-200">
                    <p className="text-xs font-medium text-slate-800">
                      Notarizar Archivo Relacionado del Caso (en RAM local)
                    </p>
                    <input
                      ref={localUploadRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleSelectLocalFile(f);
                      }}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => localUploadRef.current?.click()}
                        className="px-3.5 py-2 text-xs font-medium border border-slate-200 hover:bg-slate-50 rounded-xl flex items-center gap-1.5 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Seleccionar archivo local</span>
                      </button>
                      <button
                        type="button"
                        disabled={!localFile || proteccion.estructura_rota}
                        onClick={handleNotarizeLocalFile}
                        className="px-3.5 py-2 text-xs font-medium bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-xl flex items-center gap-1.5 cursor-pointer"
                      >
                        <Stamp className="w-3.5 h-3.5" />
                        <span>Sellar con CSG</span>
                      </button>
                    </div>

                    {localFile && (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                        <p className="font-medium text-slate-900 truncate">
                          {localFile.name} ({localFile.size.toLocaleString()} bytes)
                        </p>
                        <p className="font-mono text-[11px] text-slate-600 break-all">
                          SHA3-256: {localFile.sha3Hex}
                        </p>
                      </div>
                    )}

                    <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={proteccion.estructura_rota}
                        onClick={handleSimulateForgedSealTest}
                        className="text-xs text-amber-800 hover:text-amber-950 underline disabled:opacity-40 cursor-pointer"
                      >
                        Probar rechazo CSG (firma alterada / escalar conatus)
                      </button>
                    </div>
                  </div>
                )}

                {proteccion.damage_log.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 space-y-1.5">
                    <p className="text-xs font-semibold text-red-900">
                      Damage Log Cifrado AES-256-GCM ({proteccion.damage_log.length})
                    </p>
                    <div className="space-y-1 max-h-28 overflow-y-auto">
                      {proteccion.damage_log.map((dl) => (
                        <div
                          key={dl.attemptNo}
                          className="p-2 bg-red-50 border border-red-200 rounded-lg text-[11px] font-mono text-red-900"
                        >
                          #{dl.attemptNo} · {dl.razon} · IV={dl.ivHex.slice(0, 12)}... · CT=
                          {dl.encryptedHexPreview.slice(0, 16)}...
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Stored CSG Seals Chain & Independent Verifier */}
            <div className="lg:col-span-7 space-y-6">
              {verificationReport && (
                <div
                  className={`border rounded-2xl p-5 space-y-3 ${
                    verificationReport.report.todo_valido
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                      : 'bg-red-50 border-red-200 text-red-950'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {verificationReport.report.todo_valido ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 text-red-700" />
                      )}
                      <span>Verificación Independiente CSG · {verificationReport.label}</span>
                    </div>
                    <span className="font-mono text-xs font-semibold">
                      {verificationReport.report.todo_valido ? 'VÁLIDO' : 'INVÁLIDO'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                    <div>
                      Cuerpo íntegro:{' '}
                      {verificationReport.report.checks.cuerpo_no_alterado ? 'SÍ' : 'NO'}
                    </div>
                    <div>
                      Firma Ed25519:{' '}
                      {verificationReport.report.checks.firma_notario_valida ? 'SÍ' : 'NO'}
                    </div>
                    <div>
                      Encadenado:{' '}
                      {verificationReport.report.checks.encadenamiento_correcto === null
                        ? 'N/A'
                        : verificationReport.report.checks.encadenamiento_correcto
                        ? 'SÍ'
                        : 'NO'}
                    </div>
                    <div>
                      Digest archivo:{' '}
                      {verificationReport.report.checks.content_digest_match === null
                        ? 'Sin archivo'
                        : verificationReport.report.checks.content_digest_match
                        ? 'COINCIDE'
                        : 'ALTERADO'}
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      Cadena de Sellos Notariales CSG · Folio {activeSession.folioFisico}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Registros append-only en Firestore (/convivencias/{activeSession.id}/notarias).
                    </p>
                  </div>
                  <span className="font-mono text-xs text-slate-600 tabular-nums">
                    {notariaRecords.length} sellos
                  </span>
                </div>

                {/* Hidden file input used when verifying a local file against a stored CSG record */}
                <input
                  ref={(el) => {
                    verifyFileInputRef.current = el;
                  }}
                  type="file"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    const target = verifyTargetRecord;
                    e.target.value = '';
                    if (!f || !target) return;
                    const buf = await f.arrayBuffer();
                    handleVerifyRecord(target, new Uint8Array(buf));
                  }}
                />

                {notariaRecords.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                    Aún no hay sellos CSG emitidos para este expediente. Notariza un Google Doc, una
                    agenda de Google Tasks o un archivo local.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto">
                    {notariaRecords.map((rec) => (
                      <div
                        key={rec.id}
                        className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-slate-500 font-mono">
                            <span className="font-semibold text-slate-900">{rec.sourceType}</span>
                            <span aria-hidden="true">·</span>
                            <span>{rec.actorRole}</span>
                            <span aria-hidden="true">·</span>
                            <span className={rec.aceptado ? 'text-emerald-700' : 'text-red-700'}>
                              {rec.aceptado ? 'ACEPTADO' : 'RECHAZADO'}
                            </span>
                          </div>
                          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {new Date(rec.csgTimestamp * 1000).toISOString().slice(0, 19)}Z
                          </span>
                        </div>

                        <p className="text-sm font-medium text-slate-900">{rec.sourceTitle}</p>

                        <div className="font-mono text-[11px] text-slate-600 space-y-0.5 break-all">
                          <div>Evento: {rec.eventoId}</div>
                          <div>SHA3-256 Contenido: {rec.hashContenido}</div>
                          <div>Cuerpo Hash: {rec.cuerpoHash}</div>
                          <div>Anterior: {rec.selloAnterior.slice(0, 28)}...</div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleVerifyRecord(rec, null)}
                            className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg font-medium text-slate-800 cursor-pointer"
                          >
                            Verificar Firma Ed25519
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setVerifyTargetRecord(rec);
                              verifyFileInputRef.current?.click();
                            }}
                            className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg font-medium text-slate-800 cursor-pointer"
                          >
                            Cotejar Archivo Local
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadSelloJson(recordToSelloCsg(rec))}
                            className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg font-medium text-slate-800 flex items-center gap-1 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>.csg.json</span>
                          </button>
                          {rec.docUrl && (
                            <a
                              href={rec.docUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="px-3 py-1.5 text-slate-700 hover:text-slate-900 underline flex items-center gap-1"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Abrir fuente</span>
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MANDATORY CONFIRMATION DIALOG FOR MUTATING / DESTRUCTIVE GOOGLE WORKSPACE ACTIONS */}
      {pendingConfirm && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h3 className="font-display text-base font-semibold text-slate-900">
              {pendingConfirm.title}
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">{pendingConfirm.description}</p>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs text-slate-800">
              {pendingConfirm.affectedItems.map((item, idx) => (
                <p key={idx} className="break-words">
                  {item}
                </p>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => setPendingConfirm(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => void executeConfirmedAction()}
                className={`px-4 py-2 text-xs font-medium text-white rounded-xl cursor-pointer disabled:opacity-50 ${
                  pendingConfirm.destructive
                    ? 'bg-red-700 hover:bg-red-800'
                    : 'bg-slate-900 hover:bg-slate-800'
                }`}
              >
                {confirmBusy ? 'Ejecutando...' : pendingConfirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
