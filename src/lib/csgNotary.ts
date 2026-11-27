/**
 * Motor criptográfico CSG — Cerradura de Seguridad Geométrica / Sello de Integridad
 * Port fiel de https://github.com/dcpracmatic-prog/CSG.git (sello-integridad-rust + sidecar)
 *
 * Primitivas exactas:
 * - SHA3-256 (FIPS-202) para hash_contenido y cuerpo_hash
 * - JSON Canónico determinista (orden alfabético recursivo de claves, sin espacios extra)
 * - Firmas Ed25519 (RFC 8032) sobre cuerpo_hash.as_bytes()
 * - PoliticaConatus (endurecimiento exponencial x1.6 por fallo + damage_log AES-256-GCM en RAM + ruptura)
 */
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

ed.hashes.sha512 = sha512;

export const CSG_SCHEMA = 'csg-sello-v1';
export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export type TipoEventoCsg = 'archivo' | 'transaccion' | 'autorizacion';

export interface EventoCsg {
  evento_id: string;
  hash_contenido: string;
  tipo: TipoEventoCsg;
  proyecto_id: string;
  timestamp: number;
  metadatos: Record<string, string>;
}

export interface CuerpoSelloCsg {
  evento_id: string;
  aceptado: boolean;
  razon: string;
  timestamp: number;
  hash_contenido: string;
  firmante_pub: string;
  sello_anterior: string;
}

export interface SelloCsg extends CuerpoSelloCsg {
  schema: string;
  proyecto_id: string;
  cuerpo_hash: string;
  firma_notario: string;
  notario_pub: string;
}

export interface ReporteVerificacionCsg {
  evento_id: string;
  todo_valido: boolean;
  checks: {
    content_digest_match: boolean | null;
    cuerpo_no_alterado: boolean;
    firma_notario_valida: boolean;
    encadenamiento_correcto: boolean | null;
    aceptado: boolean;
  };
  hash_contenido_recalculado: string | null;
  cuerpo_hash_recalculado: string;
}

export interface PoliticaConatus {
  umbral_ruptura: number;
  factor_endurecimiento: number;
  retardo_base_ms: number;
}

export interface DamageLogEntry {
  attemptNo: number;
  timestamp: number;
  razon: string;
  encryptedHexPreview: string;
  ivHex: string;
}

export interface EstadoProteccionCsg {
  intentos_fallidos: number;
  conatus: number;
  estructura_rota: boolean;
  damage_log: DamageLogEntry[];
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) {
        sorted[key] = sortJsonValue(record[key]);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Serializa cualquier valor a JSON canónico sin espacios y con claves ordenadas alfabéticamente
 * (equivalente exacto a crypto.rs::json_canonico).
 */
export function jsonCanonico(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

export function sha3_256Bytes(input: Uint8Array | string): Uint8Array {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return sha3_256(bytes);
}

export function sha3_256Hex(input: Uint8Array | string): string {
  return bytesToHex(sha3_256Bytes(input));
}

export function computeCuerpoHashHex(cuerpo: CuerpoSelloCsg): string {
  const canonico = jsonCanonico({
    evento_id: cuerpo.evento_id,
    aceptado: cuerpo.aceptado,
    razon: cuerpo.razon,
    timestamp: cuerpo.timestamp,
    hash_contenido: cuerpo.hash_contenido,
    firmante_pub: cuerpo.firmante_pub,
    sello_anterior: cuerpo.sello_anterior,
  });
  return sha3_256Hex(canonico);
}

/**
 * Verificación independiente de un Sello CSG (equivalente a sello.rs::verificar_sello + sidecar /verify).
 * No requiere la clave privada del notario; solo su clave pública Ed25519 en hex.
 */
export function verificarSelloCsg(
  sello: SelloCsg,
  contentBytesOrText?: Uint8Array | string | null,
  expectedPrevHash?: string | null
): ReporteVerificacionCsg {
  const cuerpo: CuerpoSelloCsg = {
    evento_id: sello.evento_id,
    aceptado: sello.aceptado,
    razon: sello.razon,
    timestamp: sello.timestamp,
    hash_contenido: sello.hash_contenido,
    firmante_pub: sello.firmante_pub,
    sello_anterior: sello.sello_anterior,
  };

  const cuerpoHashRecalculado = computeCuerpoHashHex(cuerpo);
  const cuerpoNoAlterado = cuerpoHashRecalculado === sello.cuerpo_hash;

  let firmaNotarioValida = false;
  try {
    if (cuerpoNoAlterado && /^[a-fA-F0-9]{64}$/.test(sello.notario_pub) && /^[a-fA-F0-9]{128}$/.test(sello.firma_notario)) {
      const msgBytes = new TextEncoder().encode(sello.cuerpo_hash);
      firmaNotarioValida = ed.verify(
        hexToBytes(sello.firma_notario),
        msgBytes,
        hexToBytes(sello.notario_pub)
      );
    }
  } catch {
    firmaNotarioValida = false;
  }

  let hashContenidoRecalculado: string | null = null;
  let contentDigestMatch: boolean | null = null;
  if (contentBytesOrText !== undefined && contentBytesOrText !== null) {
    hashContenidoRecalculado = sha3_256Hex(contentBytesOrText);
    contentDigestMatch = hashContenidoRecalculado === sello.hash_contenido;
  }

  const encadenamientoCorrecto =
    expectedPrevHash !== undefined && expectedPrevHash !== null
      ? sello.sello_anterior === expectedPrevHash
      : null;

  const todoValido =
    cuerpoNoAlterado &&
    firmaNotarioValida &&
    sello.aceptado &&
    (contentDigestMatch ?? true) &&
    (encadenamientoCorrecto ?? true);

  return {
    evento_id: sello.evento_id,
    todo_valido: todoValido,
    checks: {
      content_digest_match: contentDigestMatch,
      cuerpo_no_alterado: cuerpoNoAlterado,
      firma_notario_valida: firmaNotarioValida,
      encadenamiento_correcto: encadenamientoCorrecto,
      aceptado: sello.aceptado,
    },
    hash_contenido_recalculado: hashContenidoRecalculado,
    cuerpo_hash_recalculado: cuerpoHashRecalculado,
  };
}

/**
 * Sesión de NotarioProtegido + Firmante CSG en memoria RAM del navegador.
 */
export class CsgNotarySession {
  private notarioPriv: Uint8Array;
  public readonly notarioPubHex: string;
  private firmantePriv: Uint8Array;
  public readonly firmantePubHex: string;
  public readonly politica: PoliticaConatus;
  private ultimoHash: string;
  private vistos = new Set<string>();
  private proteccion: EstadoProteccionCsg;

  constructor(
    initialPrevHash: string = GENESIS_HASH,
    politica: PoliticaConatus = {
      umbral_ruptura: 5,
      factor_endurecimiento: 1.6,
      retardo_base_ms: 50,
    }
  ) {
    const notarioKeys = ed.keygen();
    const firmanteKeys = ed.keygen();
    this.notarioPriv = notarioKeys.secretKey;
    this.notarioPubHex = bytesToHex(notarioKeys.publicKey);
    this.firmantePriv = firmanteKeys.secretKey;
    this.firmantePubHex = bytesToHex(firmanteKeys.publicKey);
    this.politica = politica;
    this.ultimoHash = /^[a-fA-F0-9]{64}$/.test(initialPrevHash) ? initialPrevHash : GENESIS_HASH;
    this.proteccion = {
      intentos_fallidos: 0,
      conatus: 1.0,
      estructura_rota: false,
      damage_log: [],
    };
  }

  public getUltimoHash(): string {
    return this.ultimoHash;
  }

  public setUltimoHash(hash: string): void {
    if (/^[a-fA-F0-9]{64}$/.test(hash)) {
      this.ultimoHash = hash;
    }
  }

  public getEstadoProteccion(): EstadoProteccionCsg {
    return {
      ...this.proteccion,
      damage_log: [...this.proteccion.damage_log],
    };
  }

  public zeroizeAndDestroy(): void {
    this.notarioPriv.fill(0);
    this.firmantePriv.fill(0);
  }

  private async appendEncryptedDamageLog(razon: string, fpInput: string): Promise<void> {
    this.proteccion.intentos_fallidos += 1;
    this.proteccion.conatus = Number(
      (this.proteccion.conatus * this.politica.factor_endurecimiento).toFixed(4)
    );
    const delayMs = Math.round(this.politica.retardo_base_ms * this.proteccion.conatus);
    if (delayMs > 0) {
      await new Promise((r) => window.setTimeout(r, Math.min(delayMs, 2000)));
    }

    const fpHash = sha3_256Hex(fpInput);
    const plaintext = new TextEncoder().encode(
      JSON.stringify({
        t: Math.floor(Date.now() / 1000),
        attempt_no: this.proteccion.intentos_fallidos,
        fp: fpHash,
        razon,
      })
    );
    const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext);
    plaintext.fill(0);

    this.proteccion.damage_log.push({
      attemptNo: this.proteccion.intentos_fallidos,
      timestamp: Math.floor(Date.now() / 1000),
      razon,
      encryptedHexPreview: bytesToHex(new Uint8Array(encrypted).slice(0, 20)),
      ivHex: bytesToHex(iv),
    });

    if (this.proteccion.intentos_fallidos >= this.politica.umbral_ruptura) {
      this.proteccion.estructura_rota = true;
    }
  }

  public async notarizarContenido(params: {
    contentBytesOrText: Uint8Array | string;
    proyectoId: string;
    tipo: TipoEventoCsg;
    eventoId?: string;
    metadatos?: Record<string, string>;
    prevSelloHash?: string;
    simulateForgedSignature?: boolean;
  }): Promise<{ evento: EventoCsg; sello: SelloCsg; verificacion: ReporteVerificacionCsg }> {
    if (this.proteccion.estructura_rota) {
      throw new Error(
        'Estructura rota: el NotarioProtegido CSG quedó invalidado por exceso de intentos fallidos. Reinicia el notario fuera de banda.'
      );
    }

    const hashContenido = sha3_256Hex(params.contentBytesOrText);
    const timestamp = Math.floor(Date.now() / 1000);
    const randSuffix = bytesToHex(crypto.getRandomValues(new Uint8Array(4)));
    const eventoId =
      params.eventoId?.trim() || `evt-${hashContenido.slice(0, 12)}-${randSuffix}`;

    if (this.vistos.has(eventoId)) {
      await this.appendEncryptedDamageLog('replay_detectado', eventoId);
      throw new Error(`Evento duplicado (prevención de replay CSG): ${eventoId}`);
    }

    const evento: EventoCsg = {
      evento_id: eventoId,
      hash_contenido: hashContenido,
      tipo: params.tipo,
      proyecto_id: params.proyectoId,
      timestamp,
      metadatos: params.metadatos ?? {},
    };

    const eventoCanonico = new TextEncoder().encode(jsonCanonico(evento));
    const firmaFirmante = ed.sign(eventoCanonico, this.firmantePriv);
    if (params.simulateForgedSignature) {
      firmaFirmante[0] ^= 0xff; // Alteración intencional de 1 byte para validar rechazo CSG
    }

    const firmaFirmanteValida = ed.verify(
      firmaFirmante,
      eventoCanonico,
      hexToBytes(this.firmantePubHex)
    );

    const selloAnterior =
      params.prevSelloHash && /^[a-fA-F0-9]{64}$/.test(params.prevSelloHash)
        ? params.prevSelloHash
        : this.ultimoHash;

    const aceptado = firmaFirmanteValida;
    const razon = aceptado ? '' : 'firma_invalida';

    const cuerpo: CuerpoSelloCsg = {
      evento_id: evento.evento_id,
      aceptado,
      razon,
      timestamp,
      hash_contenido: hashContenido,
      firmante_pub: this.firmantePubHex,
      sello_anterior: selloAnterior,
    };

    const cuerpoHash = computeCuerpoHashHex(cuerpo);
    const firmaNotarioBytes = ed.sign(new TextEncoder().encode(cuerpoHash), this.notarioPriv);

    const sello: SelloCsg = {
      schema: CSG_SCHEMA,
      proyecto_id: params.proyectoId,
      ...cuerpo,
      cuerpo_hash: cuerpoHash,
      firma_notario: bytesToHex(firmaNotarioBytes),
      notario_pub: this.notarioPubHex,
    };

    // El encadenamiento avanza incluso en rechazos (idéntico a Notario::emitir_sello en Rust)
    this.ultimoHash = cuerpoHash;

    if (!aceptado) {
      await this.appendEncryptedDamageLog(razon, `${eventoId}:${hashContenido}`);
    } else {
      this.vistos.add(eventoId);
    }

    const verificacion = verificarSelloCsg(sello, params.contentBytesOrText, selloAnterior);
    return { evento, sello, verificacion };
  }

  public async registrarVerificacionFallida(razon: string, fpContext: string): Promise<void> {
    if (this.proteccion.estructura_rota) return;
    await this.appendEncryptedDamageLog(razon, fpContext);
  }
}
