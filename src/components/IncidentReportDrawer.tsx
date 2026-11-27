import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileWarning,
  WifiOff,
  X,
} from 'lucide-react';
import { sha256Hex } from '../lib/pactoAlgorithms';
import { createIncidentReport } from '../lib/pactoStore';
import type { PendingOfflineIncident } from '../lib/offlineCache';
import type {
  ActiveViewRole,
  ConvivenciaSession,
  IncidentCategory,
  IncidentReport,
  IncidentSeverity,
} from '../types/pacto';

interface Props {
  open: boolean;
  onClose: () => void;
  uid: string;
  actorRole: ActiveViewRole;
  sessions: ConvivenciaSession[];
  activeSession: ConvivenciaSession | null;
  myIncidents: IncidentReport[];
  pendingIncidents: PendingOfflineIncident[];
  lastAuditHash: string;
  isOnline: boolean;
  onQueueOfflineIncident: (item: PendingOfflineIncident) => Promise<void>;
}

export function IncidentReportDrawer({
  open,
  onClose,
  uid,
  actorRole,
  sessions,
  activeSession,
  myIncidents,
  pendingIncidents,
  lastAuditHash,
  isOnline,
  onQueueOfflineIncident,
}: Props) {
  const [selectedConvId, setSelectedConvId] = useState<string>(activeSession?.id ?? '');
  const [category, setCategory] = useState<IncidentCategory>('ACCESIBILIDAD_TECNICA');
  const [severity, setSeverity] = useState<IncidentSeverity>('MEDIA');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open) return null;

  const targetSession =
    sessions.find((s) => s.id === (selectedConvId || activeSession?.id)) ??
    activeSession ??
    sessions[0] ??
    null;

  const queueLocally = async (target: ConvivenciaSession) => {
    const cleanTitle = title.trim().slice(0, 120);
    const cleanDesc = description.trim().slice(0, 800);
    const evidenceHash = await sha256Hex(
      `${uid}|${target.id}|${target.folioFisico}|${category}|${cleanTitle}|${Date.now()}`
    );
    const rand = crypto.getRandomValues(new Uint32Array(2));
    const localId = `offline_inc_${Date.now()}_${rand[0].toString(36)}${rand[1].toString(36)}`;
    await onQueueOfflineIncident({
      localId,
      uid,
      actorRole,
      convivenciaId: target.id,
      folioFisico: target.folioFisico,
      cecofamSede: target.cecofamSede,
      category,
      severity,
      title: cleanTitle,
      description: cleanDesc,
      evidenceHash,
      prevAuditHash: lastAuditHash,
      queuedAtIso: new Date().toISOString(),
    });
    setTitle('');
    setDescription('');
    setFeedback(
      `Sin conexión: incidencia guardada en cola local (SHA-256 ${evidenceHash.slice(
        0,
        12
      )}…) sobre folio ${target.folioFisico}. Se enviará automáticamente al recuperar red.`
    );
  };

  const handleSubmit = async () => {
    if (!targetSession) return;
    if (title.trim().length < 4 || description.trim().length < 8) {
      setErrorMsg('Completa un título (mín. 4 caracteres) y descripción fáctica (mín. 8 caracteres).');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    setFeedback(null);
    try {
      if (!isOnline || !navigator.onLine) {
        await queueLocally(targetSession);
        return;
      }

      try {
        await createIncidentReport({
          uid,
          actorRole,
          convivenciaId: targetSession.id,
          folioFisico: targetSession.folioFisico,
          cecofamSede: targetSession.cecofamSede,
          category,
          severity,
          title,
          description,
          prevAuditHash: lastAuditHash,
        });
        setTitle('');
        setDescription('');
        setFeedback(
          `Incidencia sellada con hash SHA-256 sobre folio ${targetSession.folioFisico}. El Administrador del Protocolo revisará tu reporte.`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (
          !navigator.onLine ||
          msg.includes('offline') ||
          msg.includes('unavailable') ||
          msg.includes('network')
        ) {
          await queueLocally(targetSession);
        } else {
          setErrorMsg(err instanceof Error ? err.message : 'No se pudo enviar el reporte.');
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="incident-drawer-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-slate-900 shrink-0" />
            <div>
              <h2
                id="incident-drawer-title"
                className="font-display text-lg font-semibold text-slate-900"
              >
                Reportar Incidencia de Accesibilidad o Convivencia
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Perfil emisor: <span className="font-mono font-medium text-slate-700">{actorRole}</span> · Solo tus propios reportes son visibles en este perfil.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer"
            aria-label="Cerrar ventana de incidente"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!isOnline && (
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 flex items-start gap-2.5">
            <WifiOff className="w-4 h-4 shrink-0 mt-0.5 text-amber-800" />
            <span>
              <strong>Modo Sin Conexión:</strong> puedes redactar y sellar el incidente sobre
              cualquier expediente en caché. Se almacenará en IndexedDB y se sincronizará con
              Firestore en cuanto recuperes conectividad.
            </span>
          </div>
        )}

        {!targetSession ? (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center gap-3">
            <FileWarning className="w-5 h-5 text-slate-500 shrink-0" />
            <span>
              Necesitas contar con un Folio Físico en tu cuenta o caché local para vincular un reporte de incidencia.
            </span>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-600 font-medium mb-1">Folio Vinculado</label>
                <select
                  value={targetSession.id}
                  onChange={(e) => setSelectedConvId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-slate-900"
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.folioFisico} · {s.cecofamSede}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-600 font-medium mb-1">Categoría</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as IncidentCategory)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                >
                  <option value="ACCESIBILIDAD_TECNICA">Accesibilidad Técnica</option>
                  <option value="DESVIACION_GEOCERCA">Desviación Geocerca</option>
                  <option value="FALLO_BIOMETRICO_RAM">Fallo Biométrico RAM</option>
                  <option value="HOSTILIDAD_PROXY">Hostilidad en Proxy</option>
                  <option value="EMERGENCIA_C5">Emergencia C5</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-600 font-medium mb-1">Severidad</label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                >
                  <option value="BAJA">BAJA</option>
                  <option value="MEDIA">MEDIA</option>
                  <option value="ALTA">ALTA</option>
                  <option value="CRITICA">CRÍTICA</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">Título breve</label>
              <input
                type="text"
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej. Problema de contraste o audio en actividad MILE"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-medium mb-1">
                Descripción fáctica (sin datos personales o imágenes crudas del menor)
              </label>
              <textarea
                rows={3}
                maxLength={800}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe el incidente operativo o de accesibilidad observado..."
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              />
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800">
                {errorMsg}
              </div>
            )}

            {feedback && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{feedback}</span>
              </div>
            )}

            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              className="w-full min-h-[42px] py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-medium rounded-lg cursor-pointer"
            >
              {submitting
                ? 'Registrando con huella SHA-256...'
                : isOnline
                ? 'Enviar Reporte de Incidente'
                : 'Guardar Reporte Offline (Sincronizar al Reconectar)'}
            </button>
          </div>
        )}

        {/* Pending Offline Outbox */}
        {pendingIncidents.length > 0 && (
          <div className="border-t border-slate-200 pt-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-amber-900 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>Cola Local Offline (Pendiente de Sincronización)</span>
              </span>
              <span className="font-mono text-amber-800 tabular-nums">
                {pendingIncidents.length}
              </span>
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {pendingIncidents.map((item) => (
                <div
                  key={item.localId}
                  className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-amber-950">
                      Folio {item.folioFisico} · {item.category}
                    </span>
                    <span className="font-mono text-amber-900">PENDIENTE_SYNC</span>
                  </div>
                  <p className="font-medium text-amber-950">{item.title}</p>
                  <p className="font-mono text-[11px] text-amber-800 truncate">
                    SHA-256: {item.evidenceHash.slice(0, 20)}...
                  </p>
                  {item.lastError && (
                    <p className="text-[11px] text-red-800">{item.lastError}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reporter's Own Incidents Only */}
        <div className="border-t border-slate-200 pt-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-800">Mis Reportes Enviados</span>
            <span className="font-mono text-slate-500 tabular-nums">{myIncidents.length}</span>
          </div>
          {myIncidents.length === 0 ? (
            <p className="text-xs text-slate-500">
              No has enviado reportes de incidencia desde esta cuenta todavía.
            </p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {myIncidents.map((inc) => (
                <div
                  key={inc.id}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-slate-900">
                      Folio {inc.folioFisico} · {inc.category}
                    </span>
                    <span className="font-mono text-slate-700">{inc.status}</span>
                  </div>
                  <p className="font-medium text-slate-900">{inc.title}</p>
                  {inc.resolutionNote && (
                    <p className="text-slate-600">Dictamen S-ADMIN: {inc.resolutionNote}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
