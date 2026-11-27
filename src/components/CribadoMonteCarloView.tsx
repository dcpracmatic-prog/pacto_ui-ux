import { useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, Play, PlusCircle, ShieldAlert } from 'lucide-react';
import {
  computeMarrIndex,
  evaluateEligibility,
  runMonteCarloPacto,
  type MonteCarloResults,
} from '../lib/pactoAlgorithms';
import { createConvivenciaFromScreening } from '../lib/pactoStore';
import type { AgeGroup, CecofamSede } from '../types/pacto';
import { AGE_GROUP_THRESHOLDS } from '../types/pacto';
import { QrCodeMatrixSvg } from './QrCodeMatrixSvg';

const EXCLUSIONS_CATALOG = [
  { code: 'E1', title: 'Violencia Intrafamiliar Grave', desc: 'Antecedentes acreditados de violencia física, psicológica o económica severa.' },
  { code: 'E2', title: 'Delitos de Integridad Sexual', desc: 'Indicios, denuncias o carpetas relacionadas con abuso o negligencia grave.' },
  { code: 'E3', title: 'Riesgo de Sustracción de Menores', desc: 'Historial de retención ilícita, ocultamiento o amenazas de no retorno.' },
  { code: 'E4', title: 'Amenazas y Agresión Directa Activa', desc: 'Medidas de restricción vigentes que impiden el enlace físico en Estado 1.' },
  { code: 'E5', title: 'Consumo de Sustancias de Riesgo', desc: 'Adicciones activas descontroladas sin dictamen médico vigente de control.' },
  { code: 'E6', title: 'Medidas Cautelares Incompatibles', desc: 'Prisión preventiva o arraigo domiciliario incompatible con el polígono.' },
  { code: 'E7', title: 'Historial de Incumplimiento Grave', desc: 'Tres o más inasistencias injustificadas en CECOFAM en los últimos 6 meses.' },
];

interface Props {
  uid: string;
  lastAuditHash: string;
  onCaseCreated: (convivenciaId: string, folioFisico: string, kJuez: string) => void;
}

export function CribadoMonteCarloView({ uid, lastAuditHash, onCaseCreated }: Props) {
  const [subTab, setSubTab] = useState<'cribado' | 'montecarlo'>('cribado');

  // A-PACTO state
  const [cecofamSede, setCecofamSede] = useState<CecofamSede>('Ecatepec');
  const [ageGroup, setAgeGroup] = useState<AgeGroup>('ESCOLAR');
  const [durationMinutes, setDurationMinutes] = useState(240);
  const [minorClothingDesc, setMinorClothingDesc] = useState(
    'Chamarra azul marino, playera blanca, pantalón de mezclilla y tenis blancos'
  );
  const [vehicleDesc, setVehicleDesc] = useState('Sedán gris plata · Uso familiar');
  const [exclusions, setExclusions] = useState<Record<string, boolean>>({
    E1: false,
    E2: false,
    E3: false,
    E4: false,
    E5: false,
    E6: false,
    E7: false,
  });

  // M-ARR vectors (0..100) and weights
  const [vHab, setVHab] = useState(82);
  const [vLab, setVLab] = useState(74);
  const [vCum, setVCum] = useState(88);
  const [vVin, setVVin] = useState(76);
  const [vCop, setVCop] = useState(90);

  const [creating, setCreating] = useState(false);
  const [createdNotice, setCreatedNotice] = useState<{
    folioFisico: string;
    kJuez: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Weights adapted dynamically by M-RIPE focus while preserving sum = 1.0
  const weights = useMemo(() => {
    if (ageGroup === 'PRIMERA_INFANCIA') {
      return { wHab: 0.3, wLab: 0.2, wCum: 0.25, wVin: 0.15, wCop: 0.1 };
    }
    if (ageGroup === 'ADOLESCENTE') {
      return { wHab: 0.25, wLab: 0.1, wCum: 0.25, wVin: 0.2, wCop: 0.2 };
    }
    return { wHab: 0.22, wLab: 0.16, wCum: 0.27, wVin: 0.2, wCop: 0.15 };
  }, [ageGroup]);

  const iArrScore = useMemo(
    () =>
      computeMarrIndex({
        vHab,
        vLab,
        vCum,
        vVin,
        vCop,
        ...weights,
      }),
    [vHab, vLab, vCum, vVin, vCop, weights]
  );

  const verdict = useMemo(
    () => evaluateEligibility(exclusions, iArrScore, ageGroup),
    [exclusions, iArrScore, ageGroup]
  );

  // Monte Carlo state
  const [seed, setSeed] = useState(2026);
  const [iterations, setIterations] = useState(10000);
  const [mcResult, setMcResult] = useState<MonteCarloResults>(() =>
    runMonteCarloPacto(10000, 2026)
  );

  const handleCreateFolio = async () => {
    if (!verdict.eligible) return;
    setCreating(true);
    setErrorMsg(null);
    setCreatedNotice(null);
    try {
      const created = await createConvivenciaFromScreening({
        uid,
        cecofamSede,
        ageGroup,
        iArrScore,
        exclusionsClear: true,
        durationMinutes,
        minorClothingDesc,
        vehicleDesc,
        prevAuditHash: lastAuditHash,
      });
      setCreatedNotice({ folioFisico: created.folioFisico, kJuez: created.kJuez });
      onCaseCreated(created.id, created.folioFisico, created.kJuez);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo inicializar el folio.');
    } finally {
      setCreating(false);
    }
  };

  const handleRunMc = () => {
    const safeIter = Math.max(500, Math.min(25000, iterations));
    setMcResult(runMonteCarloPacto(safeIter, seed));
  };

  const maxHistCount = Math.max(...mcResult.histogram.map((b) => b.count), 1);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">
            Cribado Paramétrico A-PACTO y Simulación Estocástica
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Evaluación de bajo riesgo judicial mediante exclusiones absolutas, matriz M-ARR, modulador
            M-RIPE y validación científica de Monte Carlo.
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => setSubTab('cribado')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'cribado'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Cribado Paramétrico A-PACTO
          </button>
          <button
            type="button"
            onClick={() => setSubTab('montecarlo')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'montecarlo'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Simulación Monte Carlo (N=10,000)
          </button>
        </div>
      </div>

      {subTab === 'cribado' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left column: Screening inputs */}
          <div className="lg:col-span-7 space-y-8">
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-slate-900">
                  01. Matriz de Exclusiones Absolutas (E1 – E7)
                </h2>
                <span className="text-xs text-slate-500">Criterio eliminatorio estricto</span>
              </div>
              <div className="divide-y divide-slate-100">
                {EXCLUSIONS_CATALOG.map((ex) => (
                  <label
                    key={ex.code}
                    className="py-3 flex items-start gap-3 cursor-pointer hover:bg-slate-50/70 px-2 rounded-lg transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={exclusions[ex.code]}
                      onChange={(e) =>
                        setExclusions((prev) => ({ ...prev, [ex.code]: e.target.checked }))
                      }
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium text-slate-900">
                        <span className="font-mono text-xs text-slate-500 mr-2">{ex.code}</span>
                        {ex.title}
                      </div>
                      <p className="text-xs text-slate-600">{ex.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </section>

            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-slate-900">
                  02. Matriz de Arraigo Verificable Multidimensional (M-ARR)
                </h2>
                <span className="text-xs text-slate-500">Sin sesgo patrimonial crudo</span>
              </div>

              <div className="space-y-4">
                {[
                  {
                    id: 'vHab',
                    label: 'V_HAB · Estabilidad Habitacional',
                    weight: weights.wHab,
                    value: vHab,
                    setter: setVHab,
                  },
                  {
                    id: 'vLab',
                    label: 'V_LAB · Actividad Productiva Lícita',
                    weight: weights.wLab,
                    value: vLab,
                    setter: setVLab,
                  },
                  {
                    id: 'vCum',
                    label: 'V_CUM · Cumplimiento Procesal Histórico',
                    weight: weights.wCum,
                    value: vCum,
                    setter: setVCum,
                  },
                  {
                    id: 'vVin',
                    label: 'V_VIN · Cohesión Social y Vínculos Locales',
                    weight: weights.wVin,
                    value: vVin,
                    setter: setVVin,
                  },
                  {
                    id: 'vCop',
                    label: 'V_COP · Cooperación con Protocolo (MIPA)',
                    weight: weights.wCop,
                    value: vCop,
                    setter: setVCop,
                  },
                ].map((vec) => (
                  <div key={vec.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-800">{vec.label}</span>
                      <span className="font-mono text-slate-600">
                        {vec.value} pts · peso {(vec.weight * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={vec.value}
                      onChange={(e) => vec.setter(Number(e.target.value))}
                      className="w-full accent-slate-900 cursor-pointer"
                    />
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Right column: M-RIPE, Metadata & Creation */}
          <div className="lg:col-span-5 space-y-6">
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <h2 className="font-display text-base font-semibold text-slate-900">
                03. Modulador M-RIPE y Parametrización
              </h2>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700">
                  Grupo Etario del Menor (Principio de Rigor Proporcional)
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {(Object.keys(AGE_GROUP_THRESHOLDS) as AgeGroup[]).map((key) => {
                    const info = AGE_GROUP_THRESHOLDS[key];
                    const active = ageGroup === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setAgeGroup(key)}
                        className={`text-left px-3.5 py-2.5 rounded-lg border text-xs transition-colors cursor-pointer flex items-center justify-between ${
                          active
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="font-medium">
                          {info.label} ({info.range})
                        </span>
                        <span className="font-mono">Umbral ≥ {info.minArr}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700">Sede CECOFAM</label>
                  <select
                    value={cecofamSede}
                    onChange={(e) => setCecofamSede(e.target.value as CecofamSede)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs bg-white text-slate-900"
                  >
                    <option value="Ecatepec">Ecatepec</option>
                    <option value="Toluca">Toluca</option>
                    <option value="Nicolás Romero">Nicolás Romero</option>
                    <option value="Ixtapaluca">Ixtapaluca</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700">
                    Duración (min)
                  </label>
                  <input
                    type="number"
                    min={60}
                    max={480}
                    step={30}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono text-slate-900"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  Vestimenta del menor (referencia disociada para contingencia PRC)
                </label>
                <input
                  type="text"
                  maxLength={240}
                  value={minorClothingDesc}
                  onChange={(e) => setMinorClothingDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  Vehículo declarado del conviviente (sin datos personales)
                </label>
                <input
                  type="text"
                  maxLength={160}
                  value={vehicleDesc}
                  onChange={(e) => setVehicleDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900"
                />
              </div>
            </section>

            {/* Verdict Summary */}
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="text-xs font-medium text-slate-500">Dictamen Paramétrico</span>
                <span className="font-mono text-lg font-semibold text-slate-900">
                  I_ARR {iArrScore.toFixed(1)} / 100
                </span>
              </div>

              <div
                className={`p-3.5 rounded-lg border text-xs leading-relaxed flex items-start gap-2.5 ${
                  verdict.eligible
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                {verdict.eligible ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
                ) : (
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
                )}
                <span>{verdict.reason}</span>
              </div>

              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                  {errorMsg}
                </div>
              )}

              {createdNotice && (
                <div className="p-4 bg-slate-900 text-white rounded-xl text-xs flex flex-col sm:flex-row items-center gap-4">
                  <QrCodeMatrixSvg
                    value={`PACTO:${createdNotice.folioFisico}`}
                    className="w-24 h-24"
                    ariaLabel={`Código QR del folio físico ${createdNotice.folioFisico}`}
                  />
                  <div className="space-y-1.5 min-w-0">
                    <div className="font-medium">Expediente inicializado en Estado 0 (Ingesta)</div>
                    <div className="font-mono text-slate-300 tabular-nums">
                      Folio Físico: {createdNotice.folioFisico} · Token K-JUEZ: {createdNotice.kJuez}
                    </div>
                    <p className="text-slate-400 leading-relaxed">
                      Código QR escaneable por el Perfil Custodio para selección rápida del expediente.
                    </p>
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={!verdict.eligible || creating}
                onClick={handleCreateFolio}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>{creating ? 'Tokenizando Folio...' : 'Emitir Folio y Pasar a Estado 0'}</span>
              </button>
            </section>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Controls */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-end justify-between gap-6">
            <div className="flex flex-wrap items-end gap-6">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  Iteraciones Estocásticas (N)
                </label>
                <input
                  type="number"
                  min={500}
                  max={25000}
                  step={500}
                  value={iterations}
                  onChange={(e) => setIterations(Number(e.target.value))}
                  className="w-36 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono text-slate-900"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  Semilla Criptográfica Reproducible
                </label>
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                  className="w-32 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono text-slate-900"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleRunMc}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Ejecutar Simulación Monte Carlo</span>
            </button>
          </div>

          {/* Summary KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
              <div className="text-xs text-slate-500">IFG Mediano (Umbral Piloto ≥ 40)</div>
              <div className="font-mono text-2xl font-semibold text-slate-900">
                {mcResult.ifg.median.toFixed(2)}
              </div>
              <div className="text-xs text-slate-600 font-mono">
                IC 95%: [{mcResult.ifg.ic95[0].toFixed(2)}, {mcResult.ifg.ic95[1].toFixed(2)}]
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
              <div className="text-xs text-slate-500">ICVI Mediano (Calidad de Vida Infantil)</div>
              <div className="font-mono text-2xl font-semibold text-slate-900">
                {mcResult.icvi.median.toFixed(2)}
              </div>
              <div className="text-xs text-slate-600 font-mono">
                IC 95%: [{mcResult.icvi.ic95[0].toFixed(2)}, {mcResult.icvi.ic95[1].toFixed(2)}]
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
              <div className="text-xs text-slate-500">ROI Presupuestal CECOFAM</div>
              <div className="font-mono text-2xl font-semibold text-slate-900">
                {mcResult.roi.median.toFixed(2)}%
              </div>
              <div className="text-xs text-slate-600 font-mono">
                IC 95%: [{mcResult.roi.ic95[0].toFixed(2)}%, {mcResult.roi.ic95[1].toFixed(2)}%]
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
              <div className="text-xs text-slate-500">Éxito Pleno Simultáneo (IFG&gt;55 · RL&lt;5.5)</div>
              <div className="font-mono text-2xl font-semibold text-slate-900">
                {mcResult.probExitoPerfecto.toFixed(2)}%
              </div>
              <div className="text-xs text-slate-600">
                N = {mcResult.iterations.toLocaleString()} · Semilla {mcResult.seed}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* IFG Histogram */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-slate-700" />
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    Distribución Probabilística del Índice de Funcionalidad Global (IFG)
                  </h3>
                </div>
                <span className="text-xs text-slate-500">Umbral piloto: 40.0</span>
              </div>

              <div className="pt-4 space-y-2">
                <div className="h-52 flex items-end gap-2 border-b border-slate-200 pb-2">
                  {mcResult.histogram.map((bin) => {
                    const heightPct = (bin.count / maxHistCount) * 100;
                    const aboveThreshold = bin.minVal >= 40;
                    return (
                      <div key={bin.binLabel} className="flex-1 flex flex-col items-center h-full justify-end gap-1">
                        <span className="font-mono text-[10px] text-slate-500">{bin.count}</span>
                        <div
                          className={`w-full rounded-t transition-all ${
                            aboveThreshold ? 'bg-slate-900' : 'bg-slate-300'
                          }`}
                          style={{ height: `${Math.max(4, heightPct)}%` }}
                          title={`${bin.binLabel}: ${bin.count} iteraciones`}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2 text-[10px] font-mono text-slate-500 text-center">
                  {mcResult.histogram.map((bin) => (
                    <div key={bin.binLabel} className="flex-1 truncate">
                      {bin.binLabel}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Spearman Sensitivity */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Análisis de Sensibilidad (Correlación de Spearman ρ)
              </h3>
              <div className="space-y-3">
                {mcResult.spearman.map((row) => {
                  const widthPct = Math.min(100, Math.abs(row.rho) * 100);
                  const positive = row.rho >= 0;
                  return (
                    <div key={row.label} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-700">{row.label}</span>
                        <span
                          className={`font-mono font-medium ${
                            positive ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {row.rho >= 0 ? '+' : ''}
                          {row.rho.toFixed(3)}
                        </span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            positive ? 'bg-emerald-600' : 'bg-red-600'
                          }`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
