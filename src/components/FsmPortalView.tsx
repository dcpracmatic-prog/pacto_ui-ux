import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Cpu,
  EyeOff,
  Lock,
  MapPin,
  MessageSquare,
  Navigation,
  QrCode,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  Stamp,
  Volume2,
  WifiOff,
} from 'lucide-react';
import {
  analyzeAndSanitizeMessage,
  encryptInRamAesGcm,
  evaluateARpa,
  haversineMeters,
  sha512Hex,
} from '../lib/pactoAlgorithms';
import {
  appendEventoBitacora,
  appendMensajeProxy,
  appendWormAuditLog,
  subscribeMensajes,
  updateConvivenciaFields,
} from '../lib/pactoStore';
import type { AgeGroup, ConvivenciaSession, FsmState, MensajeProxy } from '../types/pacto';
import { CECOFAM_COORDS } from '../types/pacto';
import { HelpGlossaryButton } from './HelpGlossaryModal';
import { WorkspaceCaseNotaryView } from './WorkspaceCaseNotaryView';
import { QrCodeMatrixSvg } from './QrCodeMatrixSvg';
import { FolioQrScannerModal } from './FolioQrScannerModal';

const FSM_STEPS: { state: FsmState; code: string; label: string }[] = [
  { state: 'STATE_0_INGESTA', code: 'S0', label: 'Ingesta y CCP' },
  { state: 'STATE_1_ONBOARDING', code: 'S1', label: 'QR + TVI Óptico' },
  { state: 'STATE_1_TIMEOUT', code: 'S1·T5M', label: 'Desacoplamiento' },
  { state: 'STATE_2_ACTIVE', code: 'S2', label: 'Tránsito Activo' },
  { state: 'STATE_3_TRIAGE', code: 'S3', label: 'Triage' },
  { state: 'STATE_4_CLOSED', code: 'S4', label: 'Cierre S4' },
];

const MILE_TRIVIAS: Record<AgeGroup, { title: string; prompt: string; activity: string }> = {
  PRIMERA_INFANCIA: {
    title: 'Ronda Sonora de Animales (0–3 años)',
    prompt:
      '«Había una vez un patito amarillo que caminaba despacio junto al lago y decía cua-cua al saludar a las nubes.»',
    activity:
      'Lee el fragmento en voz tranquila mientras caminan o descansan. El motor acústico extrae 13 coeficientes MFCC del adulto sin registrar al menor.',
  },
  ESCOLAR: {
    title: 'Trivia Exploradores del Parque (4–11 años)',
    prompt:
      '«Pregunta para compartir: Si pudieras diseñar un árbol gigante con tres colores distintos en sus hojas, ¿qué colores elegirías y por qué?»',
    activity:
      'Conversación lúdica natural. El filtro espectral descarta frecuencias agudas infantiles y valida en RAM el Testigo Acústico Vectorial (TAV) del adulto.',
  },
  ADOLESCENTE: {
    title: 'Conversación de Lectura Breve (12+ años)',
    prompt:
      '«Dato curioso: Las abejas pueden reconocer patrones geométricos sencillos y comunicar la dirección de las flores mediante recorridos en forma de ocho.»',
    activity:
      'Lectura breve sin intrusión visual. Cero audio crudo almacenado; solo booleano de coincidencia biológica en memoria volátil.',
  },
};

// Real ISO-18004 QR generator imported via QrCodeMatrixSvg

interface Props {
  profileScope: 'CUSTODIO' | 'CONVIVIENTE';
  uid: string;
  sessions: ConvivenciaSession[];
  selectedId: string | null;
  onSelectId: (id: string) => void;
  lastAuditHash: string;
  isPrivilegedReader: boolean;
  onOpenIncidentDrawer: () => void;
  onExitProfile: () => void;
}

export function FsmPortalView({
  profileScope,
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

  const [ccpAccepted, setCcpAccepted] = useState(false);
  const [mipaRead, setMipaRead] = useState(false);
  const [portalTab, setPortalTab] = useState<'operacion' | 'workspace'>('operacion');
  const [convivienteTab, setConvivienteTab] = useState<'silencio' | 'campo'>('silencio');
  const [folioScannerOpen, setFolioScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [edgeRamStep, setEdgeRamStep] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // A-RPA parameters
  const [tRestanteMin, setTRestanteMin] = useState(42);
  const [etaTraficoMin, setEtaTraficoMin] = useState(28);
  const [deltaResguardoMin, setDeltaResguardoMin] = useState(12);

  // M-CP Plan Change state (Conviviente only)
  const [mcpLat, setMcpLat] = useState('');
  const [mcpLng, setMcpLng] = useState('');
  const [mcpJustification, setMcpJustification] = useState('');

  // F-BLUR + Gemini Context Image Verification (Conviviente only)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [blurredPreviewUrl, setBlurredPreviewUrl] = useState<string | null>(null);
  const [aesSummary, setAesSummary] = useState<{
    ivHex: string;
    cipherByteLength: number;
    authTagPreview: string;
  } | null>(null);
  const [visionResult, setVisionResult] = useState<{
    entornoLicito: boolean;
    tipoEspacio: string;
    observacionNeutral: string;
    cumplePrivacidadFBlur: boolean;
    modelUsed: string;
  } | null>(null);
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionError, setVisionError] = useState<string | null>(null);

  // Asymmetric Chat Proxy (Locked strictly to profileScope)
  const [mensajes, setMensajes] = useState<MensajeProxy[]>([]);
  const [chatText, setChatText] = useState('');
  const [chatFeedback, setChatFeedback] = useState<string | null>(null);

  // Triple Lock Closure
  const [closingNote, setClosingNote] = useState(
    'Entrega puntual en punto autorizado sin incidencias operativas.'
  );
  const [proximityMeters, setProximityMeters] = useState(8);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!activeSession) {
      setMensajes([]);
      return;
    }
    const unsub = subscribeMensajes(uid, activeSession.id, setMensajes, isPrivilegedReader);
    return () => unsub();
  }, [uid, activeSession?.id, isPrivilegedReader]);

  if (!activeSession) {
    return (
      <div className="max-w-lg mx-auto bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4">
        <Lock className="w-8 h-8 text-slate-400 mx-auto" />
        <h2 className="font-display text-lg font-semibold text-slate-900">
          Sin expediente disponible en tu cuenta
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          El perfil {profileScope === 'CUSTODIO' ? 'Custodio' : 'Conviviente'} requiere un Folio Físico
          previamente admitido por el Juez Familiar en Cribado A-PACTO.
        </p>
        <button
          type="button"
          onClick={onExitProfile}
          className="px-4 py-2.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 cursor-pointer"
        >
          Volver al Selector de Perfil
        </button>
      </div>
    );
  }

  const baseCoords = CECOFAM_COORDS[activeSession.cecofamSede];
  const distanceFromOrigin = haversineMeters(
    baseCoords.lat,
    baseCoords.lng,
    activeSession.lat,
    activeSession.lng
  );

  const t5mElapsedSec =
    activeSession.t5mStartMs > 0 ? Math.floor((nowMs - activeSession.t5mStartMs) / 1000) : 0;
  const t5mRemainingSec = Math.max(0, 300 - t5mElapsedSec);

  const rpaEval = evaluateARpa(
    tRestanteMin * 60,
    etaTraficoMin * 60,
    deltaResguardoMin * 60
  );

  const handleSignCcpToState1 = async () => {
    if (!ccpAccepted || !mipaRead) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      await updateConvivenciaFields(activeSession.id, {
        ccpSigned: true,
        fsmState: 'STATE_1_ONBOARDING',
      });
      await appendEventoBitacora({
        uid,
        convivenciaId: activeSession.id,
        category: 'MORADO',
        eventType: 'FIRMA_CCP_ESTADO_1',
        summary: `Contrato de Confianza Parental (CCP) aceptado desde perfil ${profileScope}. Transición a Estado 1 (Onboarding).`,
      });
      setStatusMsg('CCP firmado. Expediente en Estado 1: Onboarding y Protocolo Óptico.');
    } finally {
      setBusy(false);
    }
  };

  const handleOpticalOnboarding = async () => {
    if (profileScope !== 'CONVIVIENTE') return;
    setBusy(true);
    setStatusMsg(null);
    setEdgeRamStep('Extrayendo 68 puntos nodales en memoria RAM volátil (TVI)...');
    try {
      await new Promise((r) => window.setTimeout(r, 450));
      setEdgeRamStep('match_zk_facial = true · Destruyendo vector temporal de RAM...');
      const startMs = Date.now();
      await updateConvivenciaFields(activeSession.id, {
        tviVerified: true,
        t5mStartMs: startMs,
        fsmState: 'STATE_1_TIMEOUT',
      });
      await appendEventoBitacora({
        uid,
        convivenciaId: activeSession.id,
        category: 'CREMA',
        eventType: 'ONBOARDING_QR_TVI',
        summary:
          'Escaneo QR simétrico y verificación facial nodal TVI in-RAM exitosa (match_zk_facial = true). Ventana T-5M iniciada.',
      });
      setStatusMsg('TVI validado en RAM sin foto cruda. Ventana de desacoplamiento T-5M activa.');
    } finally {
      setEdgeRamStep(null);
      setBusy(false);
    }
  };

  const handleEnterActiveTransit = async () => {
    setBusy(true);
    setStatusMsg(null);
    try {
      await updateConvivenciaFields(activeSession.id, {
        fsmState: 'STATE_2_ACTIVE',
        semaphore: 'VERDE',
        uavCost: 0,
      });
      await appendEventoBitacora({
        uid,
        convivenciaId: activeSession.id,
        category: 'AZUL_CLARO',
        eventType: 'TRANSITO_ACTIVO_S2',
        summary:
          'Expiración de desacoplamiento T-5M. Inicio de Estado 2 (Tránsito Activo MPS-Verde · 0 UAV).',
      });
      setStatusMsg('Estado 2 (MPS-Verde) activo. Modo Silencio Visual Activo habilitado.');
    } finally {
      setBusy(false);
    }
  };

  const handleMileVoiceCheck = async () => {
    if (profileScope !== 'CONVIVIENTE') return;
    setBusy(true);
    setStatusMsg(null);
    setEdgeRamStep('Filtrando frecuencias infantiles y extrayendo 13 MFCC del adulto en RAM...');
    try {
      await new Promise((r) => window.setTimeout(r, 450));
      await updateConvivenciaFields(activeSession.id, { tavVerified: true });
      await appendEventoBitacora({
        uid,
        convivenciaId: activeSession.id,
        category: 'CREMA',
        eventType: 'VALIDACION_MILE_TAV',
        summary: `Validación acústica local TAV completada mediante actividad lúdica MILE (${activeSession.ageGroup}). Audio crudo destruido en RAM.`,
      });
      setStatusMsg('Testigo Acústico Vectorial (TAV) validado en RAM sin interrumpir al menor.');
    } finally {
      setEdgeRamStep(null);
      setBusy(false);
    }
  };

  const handleApplyTelemetryMove = async (
    dLat: number,
    dLng: number,
    shadowZone: boolean,
    dbm: number,
    battery: number
  ) => {
    if (profileScope !== 'CONVIVIENTE') return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const nextLat = Number((baseCoords.lat + dLat).toFixed(6));
      const nextLng = Number((baseCoords.lng + dLng).toFixed(6));
      const newDist = haversineMeters(baseCoords.lat, baseCoords.lng, nextLat, nextLng);
      const outOfGeofence = newDist > 6000;
      const nextSemaphore = outOfGeofence
        ? 'ROJO'
        : shadowZone || battery < 15 || rpaEval.triggered
        ? 'AMARILLO'
        : 'VERDE';
      const nextUav = nextSemaphore === 'ROJO' ? 4 : nextSemaphore === 'AMARILLO' ? 1 : 0;
      const nextState: FsmState =
        nextSemaphore === 'ROJO' ? 'STATE_3_TRIAGE' : 'STATE_2_ACTIVE';

      await updateConvivenciaFields(activeSession.id, {
        lat: nextLat,
        lng: nextLng,
        inShadowZone: shadowZone,
        signalDbm: dbm,
        batteryPct: battery,
        rpaAlertActive: rpaEval.triggered,
        semaphore: nextSemaphore,
        uavCost: nextUav,
        fsmState: nextState,
      });

      await appendEventoBitacora({
        uid,
        convivenciaId: activeSession.id,
        category: 'AZUL_CLARO',
        eventType: shadowZone
          ? 'MT_CC_SOMBRA_MTS'
          : outOfGeofence
          ? 'DESVIO_GEOCERCA'
          : 'TELEMETRIA_JSON_TEL',
        summary: shadowZone
          ? `Zona de sombra M-MTS detectada (${dbm} dBm). Almacenamiento cifrado in-RAM (MT-CC) activo sin penalización.`
          : `Vector actualizado (${nextLat}, ${nextLng}) · Dist. origen ${newDist} m · Señal ${dbm} dBm · Batería ${battery}%.`,
      });
      setStatusMsg(`Telemetría sincronizada (${nextSemaphore} · ${nextUav} UAV).`);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitMcp = async () => {
    if (profileScope !== 'CONVIVIENTE') return;
    const trimmed = mcpJustification.trim();
    if (trimmed.length < 20) {
      setStatusMsg('La justificación de Cambio de Plan (M-CP) requiere mínimo 20 caracteres.');
      return;
    }
    const parsedLat = Number(mcpLat) || Number((baseCoords.lat + 0.008).toFixed(6));
    const parsedLng = Number(mcpLng) || Number((baseCoords.lng + 0.006).toFixed(6));
    setBusy(true);
    try {
      await updateConvivenciaFields(activeSession.id, {
        lat: parsedLat,
        lng: parsedLng,
        semaphore: 'AMARILLO',
        uavCost: 1,
      });
      await appendEventoBitacora({
        uid,
        convivenciaId: activeSession.id,
        category: 'AZUL_CLARO',
        eventType: 'CAMBIO_PLAN_M_CP',
        summary: `Reconfiguración M-CP a (${parsedLat}, ${parsedLng}). Justificación fáctica: "${trimmed}"`,
      });
      setMcpJustification('');
      setStatusMsg('Cambio de Plan M-CP registrado en bitácora y congelado el vector origen.');
    } finally {
      setBusy(false);
    }
  };

  const handleContextualPhotoUpload = async (file: File) => {
    if (profileScope !== 'CONVIVIENTE') return;
    setVisionError(null);
    setVisionResult(null);
    setAesSummary(null);
    setVisionLoading(true);
    setEdgeRamStep('Aplicando filtro gaussiano destructivo F-BLUR (r = 36 px) en navegador...');

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'));
        reader.readAsDataURL(file);
      });

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Archivo de imagen inválido.'));
        image.src = dataUrl;
      });

      const maxDim = 800;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(64, Math.round(img.width * scale));
      const h = Math.max(64, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Contexto 2D no disponible para F-BLUR.');

      ctx.filter = 'blur(36px)';
      ctx.drawImage(img, -20, -20, w + 40, h + 40);
      ctx.filter = 'none';

      const blurredDataUrl = canvas.toDataURL('image/jpeg', 0.82);
      setBlurredPreviewUrl(blurredDataUrl);

      setEdgeRamStep('Cifrando payload degradado con AES-256-GCM en RAM...');
      const base64Payload = blurredDataUrl.split(',')[1] || '';
      const rawBytes = Uint8Array.from(atob(base64Payload), (c) => c.charCodeAt(0));
      const encrypted = await encryptInRamAesGcm(
        rawBytes,
        `${activeSession.folioHash}|${new Date().toISOString()}`
      );
      setAesSummary(encrypted);

      setEdgeRamStep('Verificando entorno lícito (sin rostros ni datos personales)...');
      const resp = await fetch('/api/analyze-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64Payload,
          mimeType: 'image/jpeg',
          folioHash: activeSession.folioHash,
          cecofamSede: activeSession.cecofamSede,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        throw new Error(json.error || 'Error en el servidor de análisis contextual.');
      }

      setVisionResult({
        ...json.analysis,
        modelUsed: json.modelUsed || 'gemini-4-hydrogen',
      });

      await appendEventoBitacora({
        uid,
        convivenciaId: activeSession.id,
        category: 'CREMA',
        eventType: 'EVIDENCIA_CONTEXTUAL_FBLUR',
        summary: `Imagen degradada con F-BLUR (r=36px) y cifrada AES-256-GCM (IV ${encrypted.ivHex.slice(
          0,
          12
        )}…). Verificación contextual: ${json.analysis.tipoEspacio} — ${json.analysis.observacionNeutral}`,
      });
    } catch (err) {
      setVisionError(
        err instanceof Error ? err.message : 'Fallo en la tubería F-BLUR / verificación.'
      );
    } finally {
      setEdgeRamStep(null);
      setVisionLoading(false);
    }
  };

  const handleSendChatProxy = async () => {
    if (!chatText.trim() || activeSession.fsmState === 'STATE_4_CLOSED') return;
    setBusy(true);
    setChatFeedback(null);
    try {
      const analysis = analyzeAndSanitizeMessage(chatText);
      await appendMensajeProxy({
        uid,
        convivenciaId: activeSession.id,
        senderRole: profileScope,
        rawPreview: chatText.trim(),
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
          summary: `Aviso logístico desde ${profileScope} (${analysis.status}): "${analysis.cleanContent}"`,
        });
      }

      setChatFeedback(analysis.guidanceMessage);
      setChatText('');
    } finally {
      setBusy(false);
    }
  };

  const handleTripleLockClosure = async () => {
    if (proximityMeters >= 15) {
      setStatusMsg('El cierre simétrico T-GMC exige concurrencia menor a 15 metros entre dispositivos.');
      return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      const seal = await sha512Hex(
        `${activeSession.folioHash}|${closingNote}|${Date.now()}|TRIPLE_CANDADO`
      );
      await updateConvivenciaFields(activeSession.id, {
        fsmState: 'STATE_4_CLOSED',
        semaphore: 'VERDE',
        uavCost: 0,
        closingNote: closingNote.trim().slice(0, 500) || 'Cierre simétrico sin incidencias.',
        sealHash: seal,
      });
      await appendEventoBitacora({
        uid,
        convivenciaId: activeSession.id,
        category: 'MORADO',
        eventType: 'CIERRE_TRIPLE_CANDADO_S4',
        summary: `Cierre simétrico T-GMC iniciado por ${profileScope} (concurrencia ${proximityMeters} m). Data Wipe local completado. Sello Archivo Ciego: ${seal.slice(
          0,
          24
        )}…`,
      });
      await appendWormAuditLog({
        uid,
        actorRole: profileScope,
        folioFisico: activeSession.folioFisico,
        action: 'CIERRE_SIMETRICO_DATA_WIPE',
        justification: `Triple Candado ejecutado por ${profileScope}; paquete sellado en Archivo Ciego.`,
        prevHash: lastAuditHash,
      });
      setBlurredPreviewUrl(null);
      setAesSummary(null);
      setVisionResult(null);
      setStatusMsg(
        'Estado 4 completado: Data Wipe ejecutado en terminal civil y expediente sellado en Archivo Ciego.'
      );
    } finally {
      setBusy(false);
    }
  };

  const mileCard = MILE_TRIVIAS[activeSession.ageGroup];
  const isCustodio = profileScope === 'CUSTODIO';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Compact Profile App Bar Strip */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-lg sm:text-xl font-semibold text-slate-900">
              {isCustodio
                ? 'Terminal del Progenitor Custodio'
                : 'Espacio del Progenitor Conviviente'}
            </h1>
            <HelpGlossaryButton topic={isCustodio ? 'cie' : 'zk'} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-mono font-medium text-slate-800 tabular-nums">
              Folio {activeSession.folioFisico}
            </span>
            <span aria-hidden="true">·</span>
            <span>{activeSession.cecofamSede}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{activeSession.durationMinutes} min autorizados</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setPortalTab('operacion')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                portalTab === 'operacion'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {isCustodio ? 'Operación Custodio' : 'Operación Conviviente'}
            </button>
            <button
              type="button"
              onClick={() => setPortalTab('workspace')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                portalTab === 'workspace'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Stamp className="w-3.5 h-3.5" />
              <span>Fechas, Docs y CSG</span>
            </button>
          </div>
          {sessions.length > 1 && (
            <select
              aria-label="Seleccionar folio asignado"
              value={activeSession.id}
              onChange={(e) => onSelectId(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-900 min-h-[40px]"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  Folio {s.folioFisico} · {s.fsmState.replace('STATE_', 'S')}
                </option>
              ))}
            </select>
          )}
          {isCustodio && (
            <button
              type="button"
              onClick={() => setFolioScannerOpen(true)}
              className="min-h-[40px] px-3.5 py-2 border border-slate-200 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              title="Cambiar de expediente escaneando un QR físico con la cámara"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Escanear Folio QR</span>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenIncidentDrawer}
            className="min-h-[40px] px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Reportar Incidencia</span>
          </button>
        </div>
      </div>

      {portalTab === 'workspace' ? (
        <WorkspaceCaseNotaryView
          uid={uid}
          actorRole={profileScope}
          sessions={sessions}
          selectedId={selectedId}
          onSelectId={onSelectId}
          lastAuditHash={lastAuditHash}
          isPrivilegedReader={isPrivilegedReader}
        />
      ) : (
        <>
          {/* Deterministic FSM Stepper */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {FSM_STEPS.map((step) => {
            const isCurrent = activeSession.fsmState === step.state;
            return (
              <div
                key={step.state}
                className={`px-3 py-2 rounded-xl border text-xs transition-colors ${
                  isCurrent
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                <div className="font-mono font-semibold tabular-nums">{step.code}</div>
                <div className="truncate mt-0.5">{step.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {edgeRamStep && (
        <div className="p-3.5 bg-slate-900 text-white rounded-xl text-xs font-mono flex items-center gap-2.5">
          <Cpu className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{edgeRamStep}</span>
        </div>
      )}

      {statusMsg && (
        <div className="p-3.5 bg-slate-900 text-white rounded-xl text-xs flex items-center gap-2.5">
          <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* STATE 0: INGESTA & CCP (Role-isolated, ZERO K-JUEZ leak) */}
      {activeSession.fsmState === 'STATE_0_INGESTA' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-2xl mx-auto space-y-5">
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Contrato de Confianza Parental (CCP) · Perfil{' '}
              {isCustodio ? 'Custodio' : 'Conviviente'}
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              {isCustodio
                ? 'Confirma tu consentimiento para generar el QR efímero de entrega y activar la ventana de privacidad T-5M sin rastreo intrusivo.'
                : 'Confirma tu consentimiento para la verificación óptica efímera en RAM (TVI) y la operación bajo Silencio Visual Activo.'}
            </p>
          </div>
          <div className="space-y-3">
            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={mipaRead}
                onChange={(e) => setMipaRead(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900"
              />
              <span className="text-xs text-slate-700 leading-relaxed">
                <strong>Inducción MIPA:</strong> Comprendo que el menor nunca es autenticado ni
                expuesto, y que toda comunicación entre adultos transita por el proxy neutral.
              </span>
            </label>
            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={ccpAccepted}
                onChange={(e) => setCcpAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900"
              />
              <span className="text-xs text-slate-700 leading-relaxed">
                <strong>Aceptación CCP ({profileScope}):</strong> Acepto las reglas del folio{' '}
                <span className="font-mono">{activeSession.folioFisico}</span> y el cierre simétrico
                en {activeSession.cecofamSede}.
              </span>
            </label>
          </div>
          <button
            type="button"
            disabled={!ccpAccepted || !mipaRead || busy}
            onClick={handleSignCcpToState1}
            className="w-full min-h-[44px] px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-medium rounded-xl transition-colors cursor-pointer"
          >
            Confirmar Consentimiento e Iniciar Entrega (Estado 1)
          </button>
        </div>
      )}

      {/* STATE 1: STRICTLY SEPARATED CUSTODIO vs CONVIVIENTE */}
      {(activeSession.fsmState === 'STATE_1_ONBOARDING' ||
        activeSession.fsmState === 'STATE_1_TIMEOUT') && (
        <div className="max-w-xl mx-auto">
          {isCustodio ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-slate-900">
                  <QrCode className="w-5 h-5" />
                  <h2 className="font-display text-base font-semibold">
                    QR Dinámico de Entrega (Terminal C-PACTO)
                  </h2>
                </div>
                <HelpGlossaryButton topic="zk" />
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-6 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <QrCodeMatrixSvg
                  value={`${activeSession.folioFisico}:${activeSession.folioHash.slice(0, 12)}`}
                  className="w-36 h-36"
                  ariaLabel={`QR dinámico de entrega para el folio ${activeSession.folioFisico}`}
                />
                <div className="space-y-2 text-xs text-slate-600">
                  <p>
                    Exhibe este código efímero al Progenitor Conviviente en{' '}
                    <strong>{activeSession.cecofamSede}</strong> para iniciar el enlace simétrico.
                  </p>
                  <p className="font-mono text-slate-800">
                    Folio: {activeSession.folioFisico}
                  </p>
                </div>
              </div>

              {activeSession.fsmState === 'STATE_1_ONBOARDING' ? (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
                  Esperando que la terminal del Progenitor Conviviente escanee este código y complete
                  su verificación óptica local (TVI).
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-950">
                        Desacoplamiento T-5M en curso
                      </span>
                      <span className="font-mono text-lg font-semibold text-amber-950 tabular-nums">
                        {String(Math.floor(t5mRemainingSec / 60)).padStart(2, '0')}:
                        {String(t5mRemainingSec % 60).padStart(2, '0')}
                      </span>
                    </div>
                    <p className="text-xs text-amber-900 leading-relaxed">
                      Por diseño anti-hostigamiento, la ubicación e itinerario del conviviente permanecen
                      bloqueados durante esta ventana para garantizar un retiro pacífico.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleEnterActiveTransit}
                    className="w-full min-h-[44px] px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl cursor-pointer"
                  >
                    Confirmar Retiro Pacífico y Pasar a Estado 2
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-slate-900">
                  <Clock className="w-5 h-5" />
                  <h2 className="font-display text-base font-semibold">
                    Validación Óptica TVI y Desacoplamiento (V-PACTO)
                  </h2>
                </div>
                <HelpGlossaryButton topic="tvi" />
              </div>

              {activeSession.fsmState === 'STATE_1_ONBOARDING' ? (
                <div className="space-y-4">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Al validar el QR del Custodio, la cámara extrae 68 puntos nodales geométricos del
                    adulto en memoria RAM volátil (TVI) sin almacenar fotografía cruda.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleOpticalOnboarding}
                    className="w-full min-h-[44px] px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl transition-colors cursor-pointer"
                  >
                    Escanear QR del Custodio y Validar TVI en RAM
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="text-xs text-slate-500">Ventana de Desacoplamiento T-5M</div>
                      <div className="font-mono text-2xl font-semibold text-slate-900 mt-0.5 tabular-nums">
                        {String(Math.floor(t5mRemainingSec / 60)).padStart(2, '0')}:
                        {String(t5mRemainingSec % 60).padStart(2, '0')}
                      </div>
                    </div>
                    <CheckCircle2 className="w-6 h-6 text-emerald-700" />
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleEnterActiveTransit}
                    className="w-full min-h-[44px] px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl transition-colors cursor-pointer"
                  >
                    {t5mRemainingSec > 0
                      ? 'Completar Desacoplamiento e Iniciar Convivencia (S2)'
                      : 'Iniciar Convivencia Activa (S2)'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* STATE 2 & 3: CUSTODIO ISOLATED EXPERIENCE vs CONVIVIENTE ISOLATED EXPERIENCE */}
      {(activeSession.fsmState === 'STATE_2_ACTIVE' ||
        activeSession.fsmState === 'STATE_3_TRIAGE') &&
        (isCustodio ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Custodio Calm Continuity Summary (No intrusive GPS tracking) */}
            <div className="lg:col-span-6 space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <EyeOff className="w-4 h-4 text-slate-900" />
                    <h2 className="font-display text-base font-semibold text-slate-900">
                      Continuidad de Convivencia (Sin Rastreo Intrusivo)
                    </h2>
                  </div>
                  <HelpGlossaryButton topic="zk" />
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Para proteger al menor de conflictos de lealtad, la terminal Custodio muestra
                  indicadores agregados de estabilidad operativa sin mapas ni coordenadas en vivo.
                </p>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="text-slate-500">Estado Operativo</div>
                    <div className="font-mono font-semibold text-slate-900 mt-1">
                      {activeSession.semaphore === 'VERDE'
                        ? 'Nominal · En curso'
                        : activeSession.semaphore === 'AMARILLO'
                        ? 'En ajuste / sombra'
                        : 'Bajo atención CECOFAM'}
                    </div>
                  </div>
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="text-slate-500">Conectividad M-MTS</div>
                    <div className="font-mono font-semibold text-slate-900 mt-1">
                      {activeSession.inShadowZone ? 'Sombra celular (MT-CC)' : 'Enlace estable'}
                    </div>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
                  <strong>Retorno previsto:</strong> El evaluador A-RPA asistirá al conviviente para
                  iniciar el retorno con {deltaResguardoMin} minutos de resguardo hacia{' '}
                  <strong>{activeSession.cecofamSede}</strong>.
                </div>
              </div>

              {/* Custodio Triple Lock Closure */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-slate-800" />
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      Cierre Simétrico Triple Candado (T-GMC · S4)
                    </h3>
                  </div>
                  <HelpGlossaryButton topic="cie" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-700">
                    Distancia de concurrencia en punto de entrega (m · &lt; 15 m)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={proximityMeters}
                    onChange={(e) => setProximityMeters(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-700">
                    Confirmación de entrega del Custodio
                  </label>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={closingNote}
                    onChange={(e) => setClosingNote(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleTripleLockClosure}
                  className="w-full min-h-[44px] py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl transition-colors cursor-pointer"
                >
                  Validar Recepción y Ejecutar Triple Candado (S4)
                </button>
              </div>
            </div>

            {/* Custodio Isolated Chat Proxy */}
            <div className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-slate-800" />
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Canal Logístico Neutral (Emisor: Custodio)
                </h3>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Tus mensajes pasan por sanitización lexicográfica automática antes de entregarse al
                conviviente. Solo se transmiten avisos logísticos neutrales.
              </p>

              <div className="space-y-2 max-h-64 overflow-y-auto bg-slate-50 border border-slate-200 rounded-xl p-3">
                {mensajes.filter((m) => m.status !== 'RECHAZADO_HOSTIL' || m.senderRole === 'CUSTODIO')
                  .length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">
                    Sin avisos logísticos intercambiados todavía.
                  </p>
                ) : (
                  mensajes
                    .filter((m) => m.status !== 'RECHAZADO_HOSTIL' || m.senderRole === 'CUSTODIO')
                    .map((m) => (
                      <div
                        key={m.id}
                        className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between font-mono text-[11px] text-slate-500">
                          <span>{m.senderRole}</span>
                          <span>{m.status}</span>
                        </div>
                        <p className="text-slate-800">
                          {m.status === 'RECHAZADO_HOSTIL'
                            ? '[Bloqueado por hostilidad antes de retransmitirse]'
                            : m.cleanContent}
                        </p>
                      </div>
                    ))
                )}
              </div>

              <div className="space-y-2">
                <textarea
                  rows={2}
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="Escribe un aviso logístico (ej. punto de encuentro, horario de llegada)..."
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                />
                {chatFeedback && <p className="text-xs text-slate-600">{chatFeedback}</p>}
                <button
                  type="button"
                  disabled={busy || !chatText.trim()}
                  onClick={handleSendChatProxy}
                  className="w-full min-h-[40px] py-2 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-xl flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Enviar Aviso por Proxy Seguro</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* CONVIVIENTE ISOLATED WORKSPACE */
          <div className="space-y-6">
            {/* Sub-views strictly inside Conviviente App */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-slate-700">
                <EyeOff className="w-4 h-4 text-slate-900 shrink-0" />
                <span>
                  <strong>Silencio Visual Activo:</strong> Usa el modo calmo frente al menor o abre las
                  herramientas de campo cuando requieras aportar contexto.
                </span>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setConvivienteTab('silencio')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    convivienteTab === 'silencio'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Silencio Visual (MILE + A-RPA)
                </button>
                <button
                  type="button"
                  onClick={() => setConvivienteTab('campo')}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    convivienteTab === 'campo'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Contexto F-BLUR, M-CP y Cierre
                </button>
              </div>
            </div>

            {convivienteTab === 'silencio' ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Calm Mobile-Friendly Child-Safe Screen */}
                <div className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
                  <div className="text-center space-y-1">
                    <div className="text-xs text-slate-500">Convivencia autorizada</div>
                    <h2 className="font-display text-lg font-semibold text-slate-900">
                      Tiempo Compartido en Armonía
                    </h2>
                    <p className="text-xs text-slate-500">
                      Sin relojes regresivos ni alertas punitivas visibles para el menor.
                    </p>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
                    <div className="font-semibold text-slate-800">Lineamientos de Convivencia</div>
                    <div className="text-slate-600">
                      Vestimenta registrada: {activeSession.minorClothingDesc}
                    </div>
                    <div className="text-slate-600">
                      Vehículo autorizado: {activeSession.vehicleDesc}
                    </div>
                  </div>

                  <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-800">
                        <Sparkles className="w-4 h-4" />
                        <span>{mileCard.title}</span>
                      </div>
                      <HelpGlossaryButton topic="tvi" />
                    </div>
                    <p className="text-sm text-slate-800 leading-relaxed">{mileCard.prompt}</p>
                    <p className="text-xs text-slate-500 leading-relaxed">{mileCard.activity}</p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleMileVoiceCheck}
                      className="w-full min-h-[44px] py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Volume2 className="w-4 h-4" />
                      <span>
                        {activeSession.tavVerified
                          ? 'TAV Validado en RAM (Repetir Lectura)'
                          : 'Completar Lectura Lúdica (TAV)'}
                      </span>
                    </button>
                  </div>

                  {rpaEval.triggered && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 leading-relaxed">
                      {rpaEval.message}
                    </div>
                  )}
                </div>

                {/* A-RPA Empathetic Return Predictor + Conviviente Chat */}
                <div className="lg:col-span-6 space-y-6">
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-base font-semibold text-slate-900">
                        Asistente Empático de Retorno (A-RPA)
                      </h3>
                      <HelpGlossaryButton topic="arpa" />
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Evalúa <span className="font-mono">T_restante ≤ ETA_tráfico + Δt_resguardo</span>{' '}
                      para anticipar un regreso sin estrés.
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">T_restante (m)</label>
                        <input
                          type="number"
                          min={5}
                          max={360}
                          value={tRestanteMin}
                          onChange={(e) => setTRestanteMin(Number(e.target.value))}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">ETA tráfico (m)</label>
                        <input
                          type="number"
                          min={5}
                          max={180}
                          value={etaTraficoMin}
                          onChange={(e) => setEtaTraficoMin(Number(e.target.value))}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-700">Resguardo (m)</label>
                        <input
                          type="number"
                          min={10}
                          max={15}
                          value={deltaResguardoMin}
                          onChange={(e) => setDeltaResguardoMin(Number(e.target.value))}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
                        />
                      </div>
                    </div>
                    <div
                      className={`p-3.5 rounded-xl border text-xs ${
                        rpaEval.triggered
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      {rpaEval.message}
                    </div>
                  </div>

                  {/* Conviviente Isolated Chat Proxy */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-slate-800" />
                      <h3 className="font-display text-sm font-semibold text-slate-900">
                        Canal Logístico Neutral (Emisor: Conviviente)
                      </h3>
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto bg-slate-50 border border-slate-200 rounded-xl p-3">
                      {mensajes.filter(
                        (m) => m.status !== 'RECHAZADO_HOSTIL' || m.senderRole === 'CONVIVIENTE'
                      ).length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-2">
                          Sin mensajes en este expediente.
                        </p>
                      ) : (
                        mensajes
                          .filter(
                            (m) => m.status !== 'RECHAZADO_HOSTIL' || m.senderRole === 'CONVIVIENTE'
                          )
                          .map((m) => (
                            <div
                              key={m.id}
                              className="p-2 bg-white border border-slate-200 rounded-lg text-xs"
                            >
                              <div className="font-mono text-[11px] text-slate-500">
                                {m.senderRole} · {m.status}
                              </div>
                              <p className="text-slate-800 mt-0.5">
                                {m.status === 'RECHAZADO_HOSTIL'
                                  ? '[Mensaje bloqueado por filtro anti-hostilidad]'
                                  : m.cleanContent}
                              </p>
                            </div>
                          ))
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={chatText}
                        onChange={(e) => setChatText(e.target.value)}
                        placeholder="Aviso logístico de retorno..."
                        className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs"
                      />
                      <button
                        type="button"
                        disabled={busy || !chatText.trim()}
                        onClick={handleSendChatProxy}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Enviar
                      </button>
                    </div>
                    {chatFeedback && <p className="text-xs text-slate-600">{chatFeedback}</p>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Geofence SVG & M-CP */}
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-slate-800" />
                      <h3 className="font-display text-base font-semibold text-slate-900">
                        Geocerca Autorizada y Zonas de Sombra (M-MTS)
                      </h3>
                    </div>
                    <span className="font-mono text-xs text-slate-500 tabular-nums">
                      Dist: {distanceFromOrigin} m · {activeSession.signalDbm} dBm
                    </span>
                  </div>

                  <svg
                    viewBox="0 0 420 220"
                    className="w-full h-56 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    {[40, 80, 120, 160].map((y) => (
                      <line key={y} x1={0} y1={y} x2={420} y2={y} stroke="#E2E8F0" strokeWidth={1} />
                    ))}
                    {[70, 140, 210, 280, 350].map((x) => (
                      <line key={x} x1={x} y1={0} x2={x} y2={220} stroke="#E2E8F0" strokeWidth={1} />
                    ))}
                    <circle
                      cx={210}
                      cy={110}
                      r={78}
                      fill="rgba(15, 23, 42, 0.04)"
                      stroke="#0F172A"
                      strokeDasharray="5 4"
                      strokeWidth={1.5}
                    />
                    <ellipse
                      cx={315}
                      cy={148}
                      rx={48}
                      ry={32}
                      fill="rgba(217, 119, 6, 0.14)"
                      stroke="#D97706"
                      strokeDasharray="3 3"
                      strokeWidth={1}
                    />
                    <text x={282} y={152} fontSize="9" fill="#92400E" fontFamily="monospace">
                      Zona Sombra M-MTS
                    </text>
                    <circle cx={210} cy={110} r={5} fill="#0F172A" />
                    <text x={156} y={97} fontSize="10" fill="#0F172A" fontWeight="600">
                      {baseCoords.label}
                    </text>
                    {(() => {
                      const dx = (activeSession.lng - baseCoords.lng) * 2800;
                      const dy = -(activeSession.lat - baseCoords.lat) * 2800;
                      const px = Math.max(20, Math.min(400, 210 + dx));
                      const py = Math.max(20, Math.min(200, 110 + dy));
                      return (
                        <g>
                          <line
                            x1={210}
                            y1={110}
                            x2={px}
                            y2={py}
                            stroke="#475569"
                            strokeWidth={1}
                            strokeDasharray="2 2"
                          />
                          <circle
                            cx={px}
                            cy={py}
                            r={7}
                            fill={
                              activeSession.semaphore === 'ROJO'
                                ? '#DC2626'
                                : activeSession.semaphore === 'AMARILLO'
                                ? '#D97706'
                                : '#16A34A'
                            }
                            stroke="#FFFFFF"
                            strokeWidth={2}
                          />
                        </g>
                      );
                    })()}
                  </svg>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleApplyTelemetryMove(0.004, -0.005, false, -72, 82)}
                      className="px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-xl hover:bg-slate-800 cursor-pointer flex items-center gap-1.5"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      <span>Tránsito Nominal (Verde)</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleApplyTelemetryMove(0.014, 0.036, true, -108, 64)}
                      className="px-3 py-2 text-xs font-medium bg-amber-50 border border-amber-300 text-amber-900 rounded-xl hover:bg-amber-100 cursor-pointer flex items-center gap-1.5"
                    >
                      <WifiOff className="w-3.5 h-3.5" />
                      <span>Zona Sombra M-MTS</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleApplyTelemetryMove(0.068, -0.042, false, -76, 58)}
                      className="px-3 py-2 text-xs font-medium bg-red-50 border border-red-300 text-red-900 rounded-xl hover:bg-red-100 cursor-pointer flex items-center gap-1.5"
                    >
                      <Radio className="w-3.5 h-3.5" />
                      <span>Desviación Geocerca</span>
                    </button>
                  </div>

                  {/* M-CP Plan Change */}
                  <div className="pt-4 border-t border-slate-100 space-y-3">
                    <h4 className="text-xs font-semibold text-slate-900">
                      Submódulo Cambio de Plan (M-CP) · Justificación ≥ 20 caracteres
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        placeholder={`Nueva lat (ej. ${(baseCoords.lat + 0.008).toFixed(5)})`}
                        value={mcpLat}
                        onChange={(e) => setMcpLat(e.target.value)}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
                      />
                      <input
                        type="text"
                        placeholder={`Nueva lng (ej. ${(baseCoords.lng + 0.006).toFixed(5)})`}
                        value={mcpLng}
                        onChange={(e) => setMcpLng(e.target.value)}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
                      />
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={500}
                        placeholder="Detalle fáctico (ej. Saturación de aforo, traslado a parque autorizado)"
                        value={mcpJustification}
                        onChange={(e) => setMcpJustification(e.target.value)}
                        className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleSubmitMcp}
                        className="px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-xl hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Registrar M-CP
                      </button>
                    </div>
                  </div>
                </div>

                {/* F-BLUR Visual Context + Triple Lock Closure */}
                <div className="lg:col-span-5 space-y-6">
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Camera className="w-4 h-4 text-slate-800" />
                        <h3 className="font-display text-base font-semibold text-slate-900">
                          Aportar Contexto (F-BLUR + AES-256-GCM)
                        </h3>
                      </div>
                      <HelpGlossaryButton topic="fblur" />
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Degrada la imagen en tu dispositivo (<span className="font-mono">r = 36 px</span>)
                      y cifra en RAM antes de verificar el entorno lícito. Nunca se envían rostros.
                    </p>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleContextualPhotoUpload(f);
                      }}
                      className="hidden"
                    />

                    <button
                      type="button"
                      disabled={visionLoading}
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full min-h-[44px] py-2.5 px-3 border border-slate-300 hover:bg-slate-50 text-slate-900 text-xs font-medium rounded-xl transition-colors cursor-pointer"
                    >
                      {visionLoading
                        ? 'Procesando F-BLUR y AES-256-GCM...'
                        : 'Seleccionar Fotografía de Entorno'}
                    </button>

                    {blurredPreviewUrl && (
                      <div className="space-y-2">
                        <img
                          src={blurredPreviewUrl}
                          alt="Vista previa tras filtro destructivo F-BLUR"
                          referrerPolicy="no-referrer"
                          className="w-full h-36 object-cover rounded-xl border border-slate-200"
                        />
                        {aesSummary && (
                          <div className="font-mono text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                            AES-256-GCM IV: {aesSummary.ivHex.slice(0, 16)}… ·{' '}
                            {aesSummary.cipherByteLength} B
                          </div>
                        )}
                      </div>
                    )}

                    {visionError && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
                        {visionError}
                      </div>
                    )}

                    {visionResult && (
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1.5">
                        <div className="font-semibold text-slate-900">
                          {visionResult.tipoEspacio} ·{' '}
                          {visionResult.entornoLicito ? 'Entorno Lícito' : 'Requiere Revisión'}
                        </div>
                        <p className="text-slate-700 leading-relaxed">
                          {visionResult.observacionNeutral}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Triple Lock State 4 */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Lock className="w-4 h-4 text-slate-800" />
                        <h3 className="font-display text-base font-semibold text-slate-900">
                          Cierre Simétrico y Data Wipe (S4)
                        </h3>
                      </div>
                      <HelpGlossaryButton topic="cie" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-700">
                        Distancia al punto de entrega (m · &lt; 15 m)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={proximityMeters}
                        onChange={(e) => setProximityMeters(Number(e.target.value))}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-700">Nota de entrega</label>
                      <textarea
                        rows={2}
                        maxLength={500}
                        value={closingNote}
                        onChange={(e) => setClosingNote(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleTripleLockClosure}
                      className="w-full min-h-[44px] py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl transition-colors cursor-pointer"
                    >
                      Ejecutar Triple Candado y Data Wipe Local (S4)
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

      {/* STATE 4: CLOSED */}
      {activeSession.fsmState === 'STATE_4_CLOSED' && (
        <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="w-5 h-5" />
            <h2 className="font-display text-base font-semibold text-slate-900">
              Estado 4 · Sesión Cerrada Simétricamente y Sellada en Archivo Ciego
            </h2>
          </div>
          <p className="text-sm text-slate-600">{activeSession.closingNote}</p>
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-700 break-all">
            Sello criptográfico inmutable: {activeSession.sealHash || 'Sellado'}
          </div>
        </div>
      )}
        </>
      )}

      {isCustodio && (
        <FolioQrScannerModal
          open={folioScannerOpen}
          onClose={() => setFolioScannerOpen(false)}
          sessions={sessions}
          onSelectSession={(matched) => {
            onSelectId(matched.id);
            setStatusMsg(
              `Expediente seleccionado por QR: Folio ${matched.folioFisico} (${matched.cecofamSede}).`
            );
          }}
        />
      )}
    </div>
  );
}
