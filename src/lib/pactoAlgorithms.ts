import type { AgeGroup, ConvivenciaSession } from '../types/pacto';
import { AGE_GROUP_THRESHOLDS } from '../types/pacto';

// --- Cryptographic Utilities (WebCrypto in-RAM) ---

export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha512Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-512', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function encryptInRamAesGcm(
  plainBytes: Uint8Array,
  aadLabel: string
): Promise<{ ivHex: string; cipherByteLength: number; authTagPreview: string }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(aadLabel);
  const safeInput = new Uint8Array(plainBytes);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    safeInput
  );
  const cipherArray = new Uint8Array(encrypted);
  const ivHex = Array.from(iv)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const tagBytes = cipherArray.slice(Math.max(0, cipherArray.length - 16));
  const authTagPreview = Array.from(tagBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  // Zero-out temporary buffer in RAM
  safeInput.fill(0);
  return {
    ivHex,
    cipherByteLength: cipherArray.byteLength,
    authTagPreview,
  };
}

export function generateFolioFisico(): string {
  const arr = crypto.getRandomValues(new Uint32Array(1));
  const num = 10000000 + (arr[0] % 90000000);
  return String(num);
}

export function generateKJuez(): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(arr)
    .map((v) => charset[v % charset.length])
    .join('');
}

// --- A-PACTO Eligibility & M-ARR / M-RIPE ---

export interface MarrInput {
  vHab: number;
  vLab: number;
  vCum: number;
  vVin: number;
  vCop: number;
  wHab: number;
  wLab: number;
  wCum: number;
  wVin: number;
  wCop: number;
}

export function computeMarrIndex(input: MarrInput): number {
  const totalWeight = input.wHab + input.wLab + input.wCum + input.wVin + input.wCop;
  if (totalWeight <= 0) return 0;
  const weighted =
    (input.vHab * input.wHab +
      input.vLab * input.wLab +
      input.vCum * input.wCum +
      input.vVin * input.wVin +
      input.vCop * input.wCop) /
    totalWeight;
  return Math.round(Math.max(0, Math.min(100, weighted)) * 100) / 100;
}

export function evaluateEligibility(
  exclusions: Record<string, boolean>,
  iArrScore: number,
  ageGroup: AgeGroup
): { eligible: boolean; reason: string; requiredThreshold: number } {
  const activeExclusions = Object.entries(exclusions)
    .filter(([, checked]) => checked)
    .map(([code]) => code);

  const requiredThreshold = AGE_GROUP_THRESHOLDS[ageGroup].minArr;

  if (activeExclusions.length > 0) {
    return {
      eligible: false,
      requiredThreshold,
      reason: `Exclusión absoluta activa (${activeExclusions.join(', ')}). El expediente debe permanecer en sala presencial CECOFAM.`,
    };
  }

  if (iArrScore < requiredThreshold) {
    return {
      eligible: false,
      requiredThreshold,
      reason: `Índice M-ARR (${iArrScore.toFixed(1)}) inferior al umbral M-RIPE requerido (${requiredThreshold} pts para ${AGE_GROUP_THRESHOLDS[ageGroup].label}).`,
    };
  }

  return {
    eligible: true,
    requiredThreshold,
    reason: `Apto para modalidad extramuros PACTO bajo criterio de Bajo Riesgo Judicial (I_ARR ${iArrScore.toFixed(1)} ≥ ${requiredThreshold}).`,
  };
}

// --- A-RPA Predictive Return Algorithm ---

export function evaluateARpa(
  tRestanteSec: number,
  etaTraficoSec: number,
  deltaResguardoSec = 720
): { triggered: boolean; marginSec: number; message: string } {
  const marginSec = tRestanteSec - (etaTraficoSec + deltaResguardoSec);
  const triggered = tRestanteSec <= etaTraficoSec + deltaResguardoSec;
  const etaMins = Math.max(1, Math.round(etaTraficoSec / 60));
  const message = triggered
    ? `Te sugerimos considerar el trayecto de retorno para proteger la bitácora logística de tu convivencia familiar. El tráfico actual estima un tiempo de traslado de ${etaMins} minutos hasta el punto de entrega. La niñez se beneficia de la puntualidad y la concordia.`
    : `Margen de retorno favorable (+${Math.round(marginSec / 60)} min sobre el colchón de resguardo).`;
  return { triggered, marginSec, message };
}

// --- Geospatial Distance (Haversine) ---

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// --- Asymmetric Chat Proxy Lexicographic Analyzer ---

const HOSTILE_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /\b(tu culpa|por tu culpa|culpa tuya)\b/gi, label: 'atribución de culpa' },
  { regex: /\b(idiota|est[uú]pid[oa]|imb[eé]cil|in[uú]til|basura|maldit[oa]|loc[oa])\b/gi, label: 'insulto directo' },
  { regex: /\b(juzgado|abogado|demanda|juez|denuncia|penal|custodia|pensión)\b/gi, label: 'reclamación judicial' },
  { regex: /\b(siempre llegas tarde|nunca cumples|mentiros[oa]|manipulador[a]?|me las vas a pagar)\b/gi, label: 'reproche o intimidación' },
  { regex: /\b(odio|harto|harta|callate|cállate|molestes)\b/gi, label: 'hostilidad emocional' },
];

export interface ChatSanitizationResult {
  status: 'RECHAZADO_HOSTIL' | 'SANITIZADO_RETRANSMITIDO' | 'LOGISTICO_LIMPIO';
  hostileTokensCount: number;
  detectedCategories: string[];
  cleanContent: string;
  guidanceMessage: string;
}

export function analyzeAndSanitizeMessage(rawText: string): ChatSanitizationResult {
  const trimmed = rawText.trim();
  const detected: string[] = [];
  let matchesCount = 0;

  for (const item of HOSTILE_PATTERNS) {
    const matches = trimmed.match(item.regex);
    if (matches && matches.length > 0) {
      matchesCount += matches.length;
      detected.push(item.label);
    }
  }

  // Extract logistical facts (time mentions, traffic, location, pickup/return)
  const hasLogisticalFact =
    /\b(\d{1,2}\s?(min|minutos|horas|hrs)|retraso|tráfico|trafico|llegando|estoy en|punto de entrega|plaza|parque|lluvia|camino|retorno|salida)\b/i.test(
      trimmed
    );

  if (matchesCount >= 2 || (matchesCount === 1 && !hasLogisticalFact)) {
    return {
      status: 'RECHAZADO_HOSTIL',
      hostileTokensCount: matchesCount,
      detectedCategories: detected,
      cleanContent: '',
      guidanceMessage:
        'Tu mensaje no cumple con el formato logístico neutral autorizado en el protocolo. Por favor, reescribe tu solicitud concentrándote de forma estricta en el dato fáctico de la entrega o el transporte de la convivencia.',
    };
  }

  if (matchesCount === 1 && hasLogisticalFact) {
    let clean = trimmed;
    for (const item of HOSTILE_PATTERNS) {
      clean = clean.replace(item.regex, '');
    }
    clean = clean.replace(/\s{2,}/g, ' ').replace(/^[,.\s]+|[,.\s]+$/g, '').trim();
    const formatted =
      clean.length >= 6
        ? `Actualización logística intermediada: ${clean}.`
        : 'Actualización logística intermediada: ajuste operativo en tránsito reportado.';
    return {
      status: 'SANITIZADO_RETRANSMITIDO',
      hostileTokensCount: matchesCount,
      detectedCategories: detected,
      cleanContent: formatted,
      guidanceMessage:
        'Se suprimió carga emocional/litigiosa y se retransmitió únicamente el dato logístico objetivo.',
    };
  }

  return {
    status: 'LOGISTICO_LIMPIO',
    hostileTokensCount: 0,
    detectedCategories: [],
    cleanContent: trimmed,
    guidanceMessage: 'Mensaje logístico verificado y retransmitido vía proxy institucional.',
  };
}

// --- PRC 4-Condition Deterministic Gate ---

export function evaluatePrcConditions(session: ConvivenciaSession) {
  const c1 = session.fsmState === 'STATE_3_TRIAGE';
  const c2 = session.gpsLossSeconds >= 900 && !session.inShadowZone;
  const c3 = session.chatAttempts >= 3;
  const c4 = session.pvBlaFailures >= 2;
  return {
    c1TriageState: c1,
    c2GpsLoss900s: c2,
    c3ChatSilence3: c3,
    c4PvBlaFail2: c4,
    allMet: c1 && c2 && c3 && c4,
  };
}

// --- Monte Carlo Stochastic Simulation (Seed 2026, N = 10,000) ---

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleGamma(rng: () => number, alpha: number): number {
  // Marsaglia and Tsang method for alpha >= 1
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x = 0;
    let v = 0;
    do {
      const u1 = Math.max(1e-12, rng());
      const u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(rng: () => number, alpha: number, beta: number): number {
  const x = sampleGamma(rng, alpha);
  const y = sampleGamma(rng, beta);
  return x / (x + y);
}

function sampleNormal(rng: () => number, mean: number, std: number): number {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + std * z;
}

function sampleTriangular(rng: () => number, left: number, mode: number, right: number): number {
  const u = rng();
  const f = (mode - left) / (right - left);
  if (u < f) {
    return left + Math.sqrt(u * (right - left) * (mode - left));
  }
  return right - Math.sqrt((1 - u) * (right - left) * (right - mode));
}

function computeStats(arr: number[]) {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((acc, v) => acc + v, 0) / n;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const p25 = sorted[Math.floor(n * 0.025)];
  const p975 = sorted[Math.floor(n * 0.975)];
  return { mean, median, std, ic95: [p25, p975] as [number, number] };
}

function spearmanCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const rank = (arr: number[]) => {
    const indexed = arr.map((v, idx) => ({ v, idx })).sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      ranks[indexed[i].idx] = i + 1;
    }
    return ranks;
  };
  const rx = rank(x);
  const ry = rank(y);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = rx[i] - ry[i];
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

export interface MonteCarloResults {
  iterations: number;
  seed: number;
  ifg: { mean: number; median: number; std: number; ic95: [number, number] };
  roi: { mean: number; median: number; std: number; ic95: [number, number] };
  icvi: { mean: number; median: number; std: number; ic95: [number, number] };
  probExitoPerfecto: number;
  histogram: { binLabel: string; count: number; minVal: number }[];
  spearman: { label: string; rho: number }[];
}

export function runMonteCarloPacto(iterations = 10000, seed = 2026): MonteCarloResults {
  const rng = mulberry32(seed);
  const adopcion: number[] = [];
  const redTraslados: number[] = [];
  const fallas: number[] = [];
  const riesgoLegal: number[] = [];
  const ahorroCosto: number[] = [];
  const redLatencia: number[] = [];
  const satisfaccion: number[] = [];
  const falsosPositivos: number[] = [];
  const icvi: number[] = [];
  const ifg: number[] = [];

  let exitos = 0;

  for (let i = 0; i < iterations; i++) {
    const ad = sampleBeta(rng, 3, 4) * 100;
    const rt = sampleBeta(rng, 7, 3) * 100;
    const fa = sampleTriangular(rng, 1.0, 5.0, 18.0);
    const rl = 1.5 + rng() * 6.0;
    const ac = sampleNormal(rng, 32.0, 8.0);
    const la = sampleNormal(rng, 55.0, 12.0);
    const sa = sampleBeta(rng, 6, 2) * 100;
    const fp = sampleTriangular(rng, 0.5, 2.5, 8.0);
    const ic = sampleBeta(rng, 7.5, 2.5) * 100;

    const rawIfg =
      ad * 0.25 +
      rt * 0.2 +
      sa * 0.2 +
      ac * 0.2 +
      la * 0.15 -
      fa * 0.8 -
      rl * 1.0 -
      fp * 0.5;
    const clippedIfg = Math.max(0, Math.min(100, rawIfg));

    if (clippedIfg > 55.0 && rl < 5.5 && fa < 12.0) {
      exitos++;
    }

    adopcion.push(ad);
    redTraslados.push(rt);
    fallas.push(fa);
    riesgoLegal.push(rl);
    ahorroCosto.push(ac);
    redLatencia.push(la);
    satisfaccion.push(sa);
    falsosPositivos.push(fp);
    icvi.push(ic);
    ifg.push(clippedIfg);
  }

  // Build 10 histogram bins across [15, 70]
  const bins = Array.from({ length: 10 }, (_, idx) => {
    const minVal = 15 + idx * 5.5;
    return {
      binLabel: `${Math.round(minVal)}–${Math.round(minVal + 5.5)}`,
      count: 0,
      minVal,
    };
  });

  for (const val of ifg) {
    const idx = Math.max(0, Math.min(9, Math.floor((val - 15) / 5.5)));
    bins[idx].count++;
  }

  const spearman = [
    { label: 'Adopción Institucional', rho: spearmanCorrelation(adopcion, ifg) },
    { label: 'Fallas Técnicas en Campo', rho: spearmanCorrelation(fallas, ifg) },
    { label: 'Reducción de Traslados', rho: spearmanCorrelation(redTraslados, ifg) },
    { label: 'Satisfacción del Usuario', rho: spearmanCorrelation(satisfaccion, ifg) },
    { label: 'Reducción de Latencia', rho: spearmanCorrelation(redLatencia, ifg) },
    { label: 'Riesgo Legal / Regulatorio', rho: spearmanCorrelation(riesgoLegal, ifg) },
    { label: 'Ahorro Costo Presupuestal', rho: spearmanCorrelation(ahorroCosto, ifg) },
    { label: 'Falsos Positivos de Alerta', rho: spearmanCorrelation(falsosPositivos, ifg) },
  ].sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));

  return {
    iterations,
    seed,
    ifg: computeStats(ifg),
    roi: computeStats(ahorroCosto),
    icvi: computeStats(icvi),
    probExitoPerfecto: (exitos / iterations) * 100,
    histogram: bins,
    spearman,
  };
}
