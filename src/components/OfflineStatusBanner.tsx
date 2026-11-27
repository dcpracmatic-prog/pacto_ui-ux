import { AlertTriangle, CloudUpload, RefreshCw, WifiOff } from 'lucide-react';

interface Props {
  isOnline: boolean;
  cachedCount: number;
  cachedAtMs: number;
  pendingIncidentsCount: number;
  syncingPending: boolean;
  canReportIncidents: boolean;
  onSyncNow: () => void;
  onOpenIncidentDrawer: () => void;
}

export function OfflineStatusBanner({
  isOnline,
  cachedCount,
  cachedAtMs,
  pendingIncidentsCount,
  syncingPending,
  canReportIncidents,
  onSyncNow,
  onOpenIncidentDrawer,
}: Props) {
  if (isOnline && pendingIncidentsCount === 0) {
    return null;
  }

  const cachedTimeLabel =
    cachedAtMs > 0
      ? new Date(cachedAtMs).toLocaleTimeString('es-MX', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-2xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs ${
        !isOnline
          ? 'bg-amber-50 border-amber-200 text-amber-950'
          : 'bg-slate-900 border-slate-800 text-white'
      }`}
    >
      <div className="flex items-start sm:items-center gap-2.5 min-w-0">
        {!isOnline ? (
          <WifiOff className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0 text-amber-800" />
        ) : (
          <CloudUpload className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0 text-emerald-400" />
        )}
        <div className="space-y-0.5 min-w-0">
          <div className="font-semibold">
            {!isOnline
              ? 'Modo sin conexión · Visualización de expedientes en caché local'
              : `Conexión restablecida · ${pendingIncidentsCount} ${
                  pendingIncidentsCount === 1
                    ? 'incidente pendiente de envío'
                    : 'incidentes pendientes de envío'
                }`}
          </div>
          <div
            className={`flex flex-wrap items-center gap-2 tabular-nums ${
              !isOnline ? 'text-amber-900' : 'text-slate-300'
            }`}
          >
            <span>{cachedCount} expedientes disponibles offline</span>
            {cachedTimeLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span>Última copia {cachedTimeLabel}</span>
              </>
            )}
            {pendingIncidentsCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{pendingIncidentsCount} en cola local (IndexedDB)</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {!isOnline && canReportIncidents && (
          <button
            type="button"
            onClick={onOpenIncidentDrawer}
            className="min-h-[36px] px-3 py-1.5 bg-amber-900 hover:bg-amber-950 text-white font-medium rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Crear Incidente Offline</span>
          </button>
        )}

        {isOnline && pendingIncidentsCount > 0 && (
          <button
            type="button"
            disabled={syncingPending}
            onClick={onSyncNow}
            className="min-h-[36px] px-3.5 py-1.5 bg-white hover:bg-slate-100 disabled:opacity-60 text-slate-900 font-medium rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingPending ? 'animate-spin' : ''}`} />
            <span>{syncingPending ? 'Sincronizando...' : 'Sincronizar ahora'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
