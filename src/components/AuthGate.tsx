import { useState } from 'react';
import { Lock, ShieldCheck, EyeOff, Scale } from 'lucide-react';
import { signInWithGoogleWorkspace } from '../lib/workspaceAuth';
import { PactoLogo } from './PactoLogo';

export function AuthGate() {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      await signInWithGoogleWorkspace();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo completar el inicio de sesión.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PactoLogo className="w-7 h-7 text-slate-900" />
          <span className="font-display text-lg font-semibold tracking-tight text-slate-900 whitespace-nowrap">
            Protocolo PACTO
          </span>
        </div>
        <span className="text-xs text-slate-500 whitespace-nowrap">
          Trazabilidad Operativa · Interés Superior de la Niñez
        </span>
      </header>

      <main className="max-w-5xl w-full mx-auto px-6 py-14 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-7 space-y-6">
          <p className="text-xs font-medium text-slate-500 tracking-wide">
            Infraestructura Ligera de Continuidad Convivencial Judicial
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-slate-900 leading-tight [text-wrap:balance]">
            Supervisión extramuros proporcional, asíncrona y auditable bajo soberanía judicial.
          </h1>
          <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
            PACTO sustituye la saturación presencial de los Centros de Convivencia Familiar (CECOFAM)
            en expedientes de bajo riesgo mediante trazabilidad mínima, ofuscación biométrica local en
            RAM y aislamiento comunicacional entre progenitores.
          </p>

          <div className="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-6 border-t border-slate-200">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-slate-900 font-medium text-sm">
                <EyeOff className="w-4 h-4 text-slate-700" />
                <span>Invisibilidad Operativa</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                El menor nunca es autenticado ni perfilado. Modo Silencio Visual Activo en estado nominal.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-slate-900 font-medium text-sm">
                <Lock className="w-4 h-4 text-slate-700" />
                <span>Edge AI Zero-Knowledge</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Vectores TVI/TAV y desenfoque F-BLUR ejecutados exclusivamente en RAM volátil local.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-slate-900 font-medium text-sm">
                <Scale className="w-4 h-4 text-slate-700" />
                <span>Custodia K-JUEZ</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Archivo Ciego cifrado y bitácora WORM verificable por hash en audiencia judicial.
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-8 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-slate-900">
              <ShieldCheck className="w-5 h-5 text-slate-800" />
              <h2 className="font-display text-lg font-semibold">Acceso Institucional Verificado</h2>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Inicia sesión con tu cuenta autorizada de Google para gestionar expedientes, operar
              agenda en Google Tasks, administrar actas en Google Docs y notarizar archivos con CSG.
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {errorMsg}
            </div>
          )}

          <button
            type="button"
            onClick={handleSignIn}
            disabled={loading}
            className="w-full min-h-[44px] py-2.5 px-4 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 border border-slate-300 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-3 cursor-pointer shadow-xs"
          >
            <svg
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 48 48"
              className="w-5 h-5 shrink-0"
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
            <span>{loading ? 'Autenticando con Google...' : 'Iniciar sesión con Google'}</span>
          </button>

          <p className="text-xs text-slate-500 leading-relaxed">
            Nota doctrinal: PACTO reduce probabilísticamente el riesgo de desviación; la
            responsabilidad civil directa en campo corresponde a las partes conforme al CCP.
          </p>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white px-6 py-4 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-4">
        <span>Protocolo PACTO · Titularidad intelectual de Arturo Salvador Balderas Hernández</span>
        <span>El menor no espera. El pacto empieza hoy.</span>
      </footer>
    </div>
  );
}
