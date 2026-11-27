import type {
  CecofamSede,
  ConvivenciaSession,
  IncidentCategory,
  IncidentReport,
  IncidentSeverity,
  RbacRole,
} from '../types/pacto';

const DB_NAME = 'pacto-offline-db';
const DB_VERSION = 1;

const STORE_SESSIONS = 'cached_sessions';
const STORE_INCIDENTS = 'cached_incidents';
const STORE_META = 'cached_meta';
const STORE_PENDING_INCIDENTS = 'pending_incidents';

export interface PendingOfflineIncident {
  localId: string;
  uid: string;
  actorRole: string;
  convivenciaId: string;
  folioFisico: string;
  cecofamSede: CecofamSede;
  category: IncidentCategory;
  severity: IncidentSeverity;
  title: string;
  description: string;
  evidenceHash: string;
  prevAuditHash: string;
  queuedAtIso: string;
  lastError?: string;
}

export interface CachedUserMeta {
  uid: string;
  lastAuditHash: string;
  assignedRole: RbacRole | null;
  savedAtMs: number;
}

function toCloneSafeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(toCloneSafeValue);
  }
  if (typeof value === 'object') {
    const maybeTs = value as {
      seconds?: unknown;
      nanoseconds?: unknown;
      toMillis?: () => number;
    };
    if (
      typeof maybeTs.seconds === 'number' &&
      typeof maybeTs.nanoseconds === 'number'
    ) {
      return { seconds: maybeTs.seconds, nanoseconds: maybeTs.nanoseconds };
    }
    if (typeof maybeTs.toMillis === 'function') {
      const ms = maybeTs.toMillis();
      return { seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1_000_000 };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v !== 'function' && typeof v !== 'symbol') {
        out[k] = toCloneSafeValue(v);
      }
    }
    return out;
  }
  return undefined;
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'uid' });
      }
      if (!db.objectStoreNames.contains(STORE_INCIDENTS)) {
        db.createObjectStore(STORE_INCIDENTS, { keyPath: 'uid' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'uid' });
      }
      if (!db.objectStoreNames.contains(STORE_PENDING_INCIDENTS)) {
        const pendingStore = db.createObjectStore(STORE_PENDING_INCIDENTS, {
          keyPath: 'localId',
        });
        pendingStore.createIndex('by_uid', 'uid', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function saveCachedSessions(
  uid: string,
  rows: ConvivenciaSession[]
): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readwrite');
      tx.objectStore(STORE_SESSIONS).put({
        uid,
        savedAtMs: Date.now(),
        rows: toCloneSafeValue(rows) as ConvivenciaSession[],
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Non-fatal in private browsing or restricted contexts
  }
}

export async function loadCachedSessions(
  uid: string
): Promise<{ rows: ConvivenciaSession[]; savedAtMs: number } | null> {
  try {
    const db = await openOfflineDb();
    const record = await new Promise<
      { uid: string; savedAtMs: number; rows: ConvivenciaSession[] } | undefined
    >((resolve, reject) => {
      const tx = db.transaction(STORE_SESSIONS, 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).get(uid);
      req.onsuccess = () =>
        resolve(
          req.result as
            | { uid: string; savedAtMs: number; rows: ConvivenciaSession[] }
            | undefined
        );
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!record) return null;
    return { rows: record.rows ?? [], savedAtMs: record.savedAtMs ?? 0 };
  } catch {
    return null;
  }
}

export async function saveCachedIncidents(
  uid: string,
  rows: IncidentReport[]
): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_INCIDENTS, 'readwrite');
      tx.objectStore(STORE_INCIDENTS).put({
        uid,
        savedAtMs: Date.now(),
        rows: toCloneSafeValue(rows) as IncidentReport[],
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore storage quota / private mode failures
  }
}

export async function loadCachedIncidents(
  uid: string
): Promise<{ rows: IncidentReport[]; savedAtMs: number } | null> {
  try {
    const db = await openOfflineDb();
    const record = await new Promise<
      { uid: string; savedAtMs: number; rows: IncidentReport[] } | undefined
    >((resolve, reject) => {
      const tx = db.transaction(STORE_INCIDENTS, 'readonly');
      const req = tx.objectStore(STORE_INCIDENTS).get(uid);
      req.onsuccess = () =>
        resolve(
          req.result as
            | { uid: string; savedAtMs: number; rows: IncidentReport[] }
            | undefined
        );
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!record) return null;
    return { rows: record.rows ?? [], savedAtMs: record.savedAtMs ?? 0 };
  } catch {
    return null;
  }
}

export async function saveCachedMeta(meta: CachedUserMeta): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Non-fatal
  }
}

export async function loadCachedMeta(uid: string): Promise<CachedUserMeta | null> {
  try {
    const db = await openOfflineDb();
    const record = await new Promise<CachedUserMeta | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get(uid);
      req.onsuccess = () => resolve(req.result as CachedUserMeta | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return record ?? null;
  } catch {
    return null;
  }
}

export async function enqueueOfflineIncident(
  item: PendingOfflineIncident
): Promise<void> {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PENDING_INCIDENTS, 'readwrite');
    tx.objectStore(STORE_PENDING_INCIDENTS).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  await registerIncidentBackgroundSync();
}

export async function listPendingOfflineIncidents(
  uid: string
): Promise<PendingOfflineIncident[]> {
  try {
    const db = await openOfflineDb();
    const items = await new Promise<PendingOfflineIncident[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_INCIDENTS, 'readonly');
      const idx = tx.objectStore(STORE_PENDING_INCIDENTS).index('by_uid');
      const req = idx.getAll(uid);
      req.onsuccess = () =>
        resolve((req.result as PendingOfflineIncident[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items.sort((a, b) => b.queuedAtIso.localeCompare(a.queuedAtIso));
  } catch {
    return [];
  }
}

export async function removePendingOfflineIncident(localId: string): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_INCIDENTS, 'readwrite');
      tx.objectStore(STORE_PENDING_INCIDENTS).delete(localId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Non-fatal
  }
}

export async function markPendingIncidentError(
  localId: string,
  lastError: string
): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_INCIDENTS, 'readwrite');
      const store = tx.objectStore(STORE_PENDING_INCIDENTS);
      const getReq = store.get(localId);
      getReq.onsuccess = () => {
        const existing = getReq.result as PendingOfflineIncident | undefined;
        if (existing) {
          store.put({ ...existing, lastError });
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Non-fatal
  }
}

export async function registerIncidentBackgroundSync(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const syncReg = registration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    if (syncReg.sync && typeof syncReg.sync.register === 'function') {
      await syncReg.sync.register('sync-pacto-incidents');
    }
  } catch {
    // Background Sync API is Chromium-only; window 'online' listener handles fallback
  }
}
