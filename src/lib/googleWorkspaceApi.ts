export class WorkspaceApiError extends Error {
  status: number;
  requiresReauth: boolean;

  constructor(message: string, status: number, requiresReauth = false) {
    super(message);
    this.name = 'WorkspaceApiError';
    this.status = status;
    this.requiresReauth = requiresReauth;
  }
}

async function fetchWorkspaceJson<T>(
  url: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401 || res.status === 403) {
    let detail = 'Token OAuth de Google Workspace expirado o sin permisos suficientes.';
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      if (errBody?.error?.message) {
        detail = errBody.error.message;
      }
    } catch {
      // Ignore JSON parse fallback
    }
    throw new WorkspaceApiError(detail, res.status, true);
  }

  if (res.status === 204) {
    return {} as T;
  }

  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new WorkspaceApiError(
      data?.error?.message || `Error HTTP ${res.status} en Google Workspace API.`,
      res.status,
      false
    );
  }
  return data;
}

// --- Google Tasks API v1 ---

export interface GoogleTaskList {
  id: string;
  title: string;
  updated?: string;
}

export interface GoogleTaskItem {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  status: 'needsAction' | 'completed';
  completed?: string;
  updated?: string;
  webViewLink?: string;
}

export async function listTaskLists(accessToken: string): Promise<GoogleTaskList[]> {
  const data = await fetchWorkspaceJson<{ items?: GoogleTaskList[] }>(
    'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=50',
    accessToken
  );
  return data.items ?? [];
}

export async function createTaskList(
  accessToken: string,
  title: string
): Promise<GoogleTaskList> {
  return fetchWorkspaceJson<GoogleTaskList>(
    'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ title: title.trim().slice(0, 120) }),
    }
  );
}

export async function listTasks(
  accessToken: string,
  taskListId: string
): Promise<GoogleTaskItem[]> {
  const encoded = encodeURIComponent(taskListId);
  const data = await fetchWorkspaceJson<{ items?: GoogleTaskItem[] }>(
    `https://tasks.googleapis.com/tasks/v1/lists/${encoded}/tasks?showCompleted=true&showHidden=true&maxResults=100`,
    accessToken
  );
  return data.items ?? [];
}

export async function createTask(
  accessToken: string,
  taskListId: string,
  input: { title: string; notes?: string; dueDateYmd?: string }
): Promise<GoogleTaskItem> {
  const encoded = encodeURIComponent(taskListId);
  const payload: Record<string, string> = {
    title: input.title.trim().slice(0, 200),
  };
  if (input.notes?.trim()) {
    payload.notes = input.notes.trim().slice(0, 2000);
  }
  if (input.dueDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDateYmd)) {
    // Google Tasks API RFC 3339 date timestamp (date portion is authoritative)
    payload.due = `${input.dueDateYmd}T12:00:00.000Z`;
  }
  return fetchWorkspaceJson<GoogleTaskItem>(
    `https://tasks.googleapis.com/tasks/v1/lists/${encoded}/tasks`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export async function updateTask(
  accessToken: string,
  taskListId: string,
  taskId: string,
  patch: {
    title?: string;
    notes?: string;
    dueDateYmd?: string;
    status?: 'needsAction' | 'completed';
  }
): Promise<GoogleTaskItem> {
  const encodedList = encodeURIComponent(taskListId);
  const encodedTask = encodeURIComponent(taskId);
  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) payload.title = patch.title.trim().slice(0, 200);
  if (patch.notes !== undefined) payload.notes = patch.notes.trim().slice(0, 2000);
  if (patch.dueDateYmd !== undefined) {
    payload.due =
      patch.dueDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(patch.dueDateYmd)
        ? `${patch.dueDateYmd}T12:00:00.000Z`
        : null;
  }
  if (patch.status !== undefined) {
    payload.status = patch.status;
    if (patch.status === 'needsAction') {
      payload.completed = null;
    }
  }
  return fetchWorkspaceJson<GoogleTaskItem>(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodedList}/tasks/${encodedTask}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  );
}

export async function deleteTask(
  accessToken: string,
  taskListId: string,
  taskId: string
): Promise<void> {
  const encodedList = encodeURIComponent(taskListId);
  const encodedTask = encodeURIComponent(taskId);
  await fetchWorkspaceJson<Record<string, never>>(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodedList}/tasks/${encodedTask}`,
    accessToken,
    { method: 'DELETE' }
  );
}

// --- Google Drive v3 + Google Docs v1 ---

export interface DriveDocSummary {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
  mimeType?: string;
}

export interface GoogleDocContent {
  documentId: string;
  title: string;
  revisionId?: string;
  plainText: string;
  endIndex: number;
  webViewLink: string;
}

export async function listGoogleDocs(
  accessToken: string,
  searchTerm?: string
): Promise<DriveDocSummary[]> {
  const safeSearch = (searchTerm ?? '').replace(/'/g, "\\'").trim();
  const qParts = [
    "mimeType='application/vnd.google-apps.document'",
    'trashed=false',
  ];
  if (safeSearch.length > 0) {
    qParts.push(`name contains '${safeSearch}'`);
  }
  const params = new URLSearchParams({
    q: qParts.join(' and '),
    fields: 'files(id,name,modifiedTime,webViewLink,mimeType)',
    orderBy: 'modifiedTime desc',
    pageSize: '25',
  });
  const data = await fetchWorkspaceJson<{ files?: DriveDocSummary[] }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken
  );
  return data.files ?? [];
}

interface DocsStructuralElement {
  endIndex?: number;
  paragraph?: {
    elements?: {
      textRun?: { content?: string };
    }[];
  };
  table?: {
    tableRows?: {
      tableCells?: {
        content?: DocsStructuralElement[];
      }[];
    }[];
  };
}

function collectTextFromElements(elements: DocsStructuralElement[] | undefined): string {
  if (!elements || !Array.isArray(elements)) return '';
  const chunks: string[] = [];
  for (const el of elements) {
    if (el.paragraph?.elements) {
      for (const pe of el.paragraph.elements) {
        if (pe.textRun?.content) {
          chunks.push(pe.textRun.content);
        }
      }
    }
    if (el.table?.tableRows) {
      for (const row of el.table.tableRows) {
        const cellTexts: string[] = [];
        for (const cell of row.tableCells ?? []) {
          cellTexts.push(collectTextFromElements(cell.content).trim());
        }
        chunks.push(`${cellTexts.join(' | ')}\n`);
      }
    }
  }
  return chunks.join('');
}

export async function getGoogleDoc(
  accessToken: string,
  documentId: string
): Promise<GoogleDocContent> {
  const encoded = encodeURIComponent(documentId);
  const raw = await fetchWorkspaceJson<{
    documentId: string;
    title: string;
    revisionId?: string;
    body?: { content?: DocsStructuralElement[] };
  }>(`https://docs.googleapis.com/v1/documents/${encoded}`, accessToken);

  const elements = raw.body?.content ?? [];
  const plainText = collectTextFromElements(elements).trim();
  const lastEl = elements[elements.length - 1];
  const endIndex = Math.max(1, lastEl?.endIndex ?? 1);

  return {
    documentId: raw.documentId,
    title: raw.title,
    revisionId: raw.revisionId,
    plainText,
    endIndex,
    webViewLink: `https://docs.google.com/document/d/${raw.documentId}/edit`,
  };
}

export async function createGoogleDoc(
  accessToken: string,
  title: string,
  initialBodyText: string
): Promise<GoogleDocContent> {
  const created = await fetchWorkspaceJson<{ documentId: string; title: string }>(
    'https://docs.googleapis.com/v1/documents',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ title: title.trim().slice(0, 180) }),
    }
  );

  const cleanBody = initialBodyText.trim();
  if (cleanBody.length > 0) {
    await fetchWorkspaceJson<unknown>(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(created.documentId)}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: `${cleanBody}\n`,
              },
            },
          ],
        }),
      }
    );
  }

  return getGoogleDoc(accessToken, created.documentId);
}

export async function appendTextToGoogleDoc(
  accessToken: string,
  documentId: string,
  textToAppend: string
): Promise<GoogleDocContent> {
  const current = await getGoogleDoc(accessToken, documentId);
  const insertAt = Math.max(1, current.endIndex - 1);
  await fetchWorkspaceJson<unknown>(
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index: insertAt },
              text: `\n${textToAppend.trim()}\n`,
            },
          },
        ],
      }),
    }
  );
  return getGoogleDoc(accessToken, documentId);
}
