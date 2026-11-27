import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  CheckCircle2,
  ImageUp,
  RefreshCw,
  ShieldAlert,
  SwitchCamera,
  X,
} from 'lucide-react';
import type { ConvivenciaSession } from '../types/pacto';

interface Props {
  open: boolean;
  onClose: () => void;
  sessions: ConvivenciaSession[];
  onSelectSession: (session: ConvivenciaSession) => void;
}

export function extractFolioFromQrPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^[0-9]{8}$/.test(trimmed)) {
    return trimmed;
  }

  const prefixed = trimmed.match(/^(?:PACTO[:\-/]|FOLIO[:\-/])?([0-9]{8})(?:[:\-/][A-Za-z0-9_-]+)?$/i);
  if (prefixed?.[1]) {
    return prefixed[1];
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const candidate =
        typeof parsed.folioFisico === 'string'
          ? parsed.folioFisico
          : typeof parsed.folio === 'string'
          ? parsed.folio
          : null;
      if (candidate && /^[0-9]{8}$/.test(candidate.trim())) {
        return candidate.trim();
      }
    } catch {
      // Ignore invalid JSON and try fallback token match
    }
  }

  const fallback = trimmed.match(/\b([0-9]{8})\b/);
  return fallback?.[1] ?? null;
}

interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

export function FolioQrScannerModal({
  open,
  onClose,
  sessions,
  onSelectSession,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastScanMsRef = useRef<number>(0);
  const attemptCountRef = useRef<number>(0);

  const [cameraState, setCameraState] = useState<
    'starting' | 'active' | 'paused' | 'error'
  >('starting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [detectedFolio, setDetectedFolio] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleDecodedString = useCallback(
    (rawValue: string) => {
      const folio = extractFolioFromQrPayload(rawValue);
      if (!folio) {
        setScanNotice(
          'Código QR leído sin un Folio Físico válido de 8 dígitos. Alinea el QR emitido por PACTO.'
        );
        return false;
      }

      const matched = sessions.find((s) => s.folioFisico === folio);
      if (!matched) {
        stopCamera();
        setCameraState('paused');
        setDetectedFolio(folio);
        setScanNotice(
          `El folio ${folio} no existe o no está vinculado a tu cuenta actual.`
        );
        return true;
      }

      stopCamera();
      setDetectedFolio(folio);
      setScanNotice(`Folio ${folio} reconocido. Seleccionando expediente...`);
      onSelectSession(matched);
      onClose();
      return true;
    },
    [onClose, onSelectSession, sessions, stopCamera]
  );

  const startCamera = useCallback(
    async (preferredDeviceId?: string) => {
      stopCamera();
      setCameraState('starting');
      setErrorMessage(null);
      setScanNotice(null);
      setDetectedFolio(null);

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setCameraState('error');
        setErrorMessage(
          'Este navegador no expone la API de cámara (MediaDevices). Usa un contexto HTTPS o carga una imagen del QR.'
        );
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: preferredDeviceId
              ? { deviceId: { exact: preferredDeviceId } }
              : {
                  facingMode: { ideal: 'environment' },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                },
            audio: false,
          });
        } catch (constraintErr) {
          if (
            constraintErr instanceof DOMException &&
            (constraintErr.name === 'OverconstrainedError' ||
              constraintErr.name === 'ConstraintNotSatisfiedError')
          ) {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          } else {
            throw constraintErr;
          }
        }

        streamRef.current = stream;

        if (typeof navigator.mediaDevices.enumerateDevices === 'function') {
          try {
            const all = await navigator.mediaDevices.enumerateDevices();
            const cams = all.filter((d) => d.kind === 'videoinput');
            setDevices(cams);
            if (!preferredDeviceId && cams.length > 0) {
              const activeTrack = stream.getVideoTracks()[0];
              const activeId = activeTrack?.getSettings()?.deviceId;
              if (activeId) {
                setSelectedDeviceId(activeId);
              }
            }
          } catch {
            // Optional device listing
          }
        }

        const video = videoRef.current;
        if (!video) {
          stopCamera();
          return;
        }
        video.srcObject = stream;
        await video.play();
        setCameraState('active');
      } catch (err) {
        stopCamera();
        setCameraState('error');
        if (err instanceof DOMException) {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setErrorMessage(
              'Permiso de cámara denegado. Habilita el acceso a la cámara en tu navegador o sube una imagen del QR.'
            );
            return;
          }
          if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            setErrorMessage(
              'No se detectó ninguna cámara disponible en este dispositivo. Puedes subir una imagen del QR para escanearlo.'
            );
            return;
          }
          if (err.name === 'NotReadableError') {
            setErrorMessage(
              'La cámara está siendo utilizada por otra aplicación. Libérala e intenta nuevamente.'
            );
            return;
          }
        }
        setErrorMessage(
          'No fue posible iniciar la cámara del navegador. Puedes cargar una imagen del código QR.'
        );
      }
    },
    [stopCamera]
  );

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    void startCamera(selectedDeviceId || undefined);
    return () => {
      stopCamera();
    };
  }, [open, selectedDeviceId, startCamera, stopCamera]);

  useEffect(() => {
    if (!open || cameraState !== 'active') return;

    const DetectorCtor = (
      window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
    ).BarcodeDetector;
    const detector = DetectorCtor
      ? new DetectorCtor({ formats: ['qr_code'] })
      : null;

    let cancelled = false;

    const scanFrame = async (timestamp: number) => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (
        video &&
        canvas &&
        video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0 &&
        timestamp - lastScanMsRef.current >= 120
      ) {
        lastScanMsRef.current = timestamp;
        attemptCountRef.current += 1;

        const maxDim = 720;
        const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
        const width = Math.max(1, Math.floor(video.videoWidth * scale));
        const height = Math.max(1, Math.floor(video.videoHeight * scale));

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, width, height);

          let decodedRaw: string | null = null;
          if (detector) {
            try {
              const found = await detector.detect(canvas);
              const first = found.find((item) => typeof item.rawValue === 'string' && item.rawValue.trim());
              if (first?.rawValue) {
                decodedRaw = first.rawValue;
              }
            } catch {
              // Fall back to jsQR
            }
          }

          if (!decodedRaw) {
            const imageData = ctx.getImageData(0, 0, width, height);
            const inversionAttempts =
              attemptCountRef.current % 4 === 0 ? 'attemptBoth' : 'dontInvert';
            const qrResult = jsQR(imageData.data, width, height, {
              inversionAttempts,
            });
            if (qrResult?.data) {
              decodedRaw = qrResult.data;
            }
          }

          if (decodedRaw && !cancelled) {
            const handled = handleDecodedString(decodedRaw);
            if (handled) return;
          }
        }
      }

      if (!cancelled) {
        rafRef.current = window.requestAnimationFrame((ts) => {
          void scanFrame(ts);
        });
      }
    };

    rafRef.current = window.requestAnimationFrame((ts) => {
      void scanFrame(ts);
    });

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [cameraState, handleDecodedString, open]);

  const handleImageFileScan = async (file: File) => {
    setScanNotice(null);
    setErrorMessage(null);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = canvasRef.current ?? document.createElement('canvas');
      const maxDim = 1024;
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
      canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        bitmap.close();
        setScanNotice('No se pudo procesar la imagen en memoria.');
        return;
      }
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qrResult = jsQR(imgData.data, canvas.width, canvas.height, {
        inversionAttempts: 'attemptBoth',
      });
      if (!qrResult?.data) {
        setScanNotice('No se detectó ningún código QR legible en la imagen seleccionada.');
        return;
      }
      handleDecodedString(qrResult.data);
    } catch {
      setScanNotice('No se pudo decodificar el archivo de imagen seleccionado.');
    }
  };

  const handleCycleCamera = () => {
    if (devices.length < 2) return;
    const currentIdx = devices.findIndex((d) => d.deviceId === selectedDeviceId);
    const nextIdx = (currentIdx + 1) % devices.length;
    setSelectedDeviceId(devices[nextIdx].deviceId);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-scanner-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Camera className="w-5 h-5 text-slate-900 shrink-0" />
            <div className="min-w-0">
              <h2
                id="qr-scanner-title"
                className="font-display text-base font-semibold text-slate-900 truncate"
              >
                Escanear QR de Folio Físico
              </h2>
              <p className="text-xs text-slate-500 truncate">
                Lectura local en memoria RAM · Cero almacenamiento de video
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer shrink-0"
            aria-label="Cerrar escáner QR"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="relative bg-slate-950 rounded-xl overflow-hidden aspect-4/3 flex items-center justify-center border border-slate-200">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`w-full h-full object-cover ${
                cameraState === 'active' ? 'opacity-100' : 'opacity-25'
              }`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {cameraState === 'active' && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
              >
                <div className="w-48 h-48 sm:w-56 sm:h-56 relative">
                  <span className="absolute top-0 left-0 w-7 h-7 border-t-2 border-l-2 border-white rounded-tl-lg" />
                  <span className="absolute top-0 right-0 w-7 h-7 border-t-2 border-r-2 border-white rounded-tr-lg" />
                  <span className="absolute bottom-0 left-0 w-7 h-7 border-b-2 border-l-2 border-white rounded-bl-lg" />
                  <span className="absolute bottom-0 right-0 w-7 h-7 border-b-2 border-r-2 border-white rounded-br-lg" />
                </div>
              </div>
            )}

            {cameraState === 'starting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-xs gap-2 p-4 text-center">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Solicitando acceso a la cámara del navegador...</span>
              </div>
            )}

            {cameraState === 'error' && errorMessage && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-xs gap-3 p-6 text-center bg-slate-900/90">
                <ShieldAlert className="w-6 h-6 text-amber-400" />
                <p className="leading-relaxed max-w-sm text-slate-100">{errorMessage}</p>
                <button
                  type="button"
                  onClick={() => void startCamera(selectedDeviceId || undefined)}
                  className="min-h-[40px] px-4 py-2 bg-white text-slate-900 font-medium rounded-xl hover:bg-slate-100 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Reintentar cámara
                </button>
              </div>
            )}

            {cameraState === 'paused' && detectedFolio && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-xs gap-3 p-6 text-center bg-slate-900/90">
                <CheckCircle2 className="w-6 h-6 text-amber-400" />
                <p className="font-mono text-sm font-semibold tabular-nums">
                  Folio detectado: {detectedFolio}
                </p>
                <button
                  type="button"
                  onClick={() => void startCamera(selectedDeviceId || undefined)}
                  className="min-h-[40px] px-4 py-2 bg-white text-slate-900 font-medium rounded-xl hover:bg-slate-100 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Escanear otro código
                </button>
              </div>
            )}
          </div>

          {scanNotice && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 leading-relaxed">
              {scanNotice}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              {devices.length > 1 && (
                <button
                  type="button"
                  onClick={handleCycleCamera}
                  className="min-h-[40px] px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <SwitchCamera className="w-4 h-4" />
                  <span>Cambiar cámara</span>
                </button>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void handleImageFileScan(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[40px] px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-xl flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ImageUp className="w-4 h-4" />
                <span>Subir imagen QR</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                stopCamera();
                onClose();
              }}
              className="min-h-[40px] px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
