/** Pure helpers for Google Drive ingest selection + export mime mapping. */

export const DRIVE_DOC = 'application/vnd.google-apps.document';
export const DRIVE_SHEET = 'application/vnd.google-apps.spreadsheet';
export const DRIVE_SLIDE = 'application/vnd.google-apps.presentation';
export const DRIVE_FOLDER = 'application/vnd.google-apps.folder';

const TEXT_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  DRIVE_DOC,
  DRIVE_SHEET,
  DRIVE_SLIDE
]);

export function isDriveIngestible(mimeType: string | null | undefined): boolean {
  const m = (mimeType ?? '').trim();
  if (!m || m === DRIVE_FOLDER) return false;
  if (TEXT_MIMES.has(m)) return true;
  if (m.startsWith('text/')) return true;
  return false;
}

/** Native Drive export target. Binary files return null (download instead). */
export function driveExportMime(mimeType: string): string | null {
  if (mimeType === DRIVE_DOC) return 'text/plain';
  if (mimeType === DRIVE_SHEET) return 'text/csv';
  if (mimeType === DRIVE_SLIDE) return 'application/pdf';
  return null;
}

export function driveMimeFilter(): string {
  const mimes = [...TEXT_MIMES].map((m) => `mimeType = '${m}'`).join(' or ');
  return `(${mimes})`;
}

export function driveListQuery(): string {
  return `trashed = false and ${driveMimeFilter()}`;
}

export function driveFolderListQuery(): string {
  return `trashed = false and mimeType = '${DRIVE_FOLDER}'`;
}

export function driveFilesInFoldersQuery(folderIds: string[]): string {
  const parents = folderIds
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => `'${escapeDriveQueryLiteral(id)}' in parents`);
  if (!parents.length) return 'id = ""';
  return `trashed = false and (${parents.join(' or ')}) and ${driveMimeFilter()}`;
}

/** Escape a user string for Drive `contains '…'` literals. */
export function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Live chat search: name or fullText, ingestible mimes only, not trashed. */
export function driveLiveSearchQuery(query: string): string {
  const q = escapeDriveQueryLiteral(query.trim());
  return `trashed = false and (name contains '${q}' or fullText contains '${q}') and ${driveMimeFilter()}`;
}

export function driveLiveSearchInFoldersQuery(query: string, folderIds: string[]): string {
  const q = escapeDriveQueryLiteral(query.trim());
  return `(${driveFilesInFoldersQuery(folderIds)}) and (name contains '${q}' or fullText contains '${q}')`;
}

export function driveFilesByIdsQuery(fileIds: string[]): string {
  const ids = fileIds.map((id) => id.trim()).filter(Boolean);
  if (!ids.length) return 'id = ""';
  const clause = ids.map((id) => `id = '${escapeDriveQueryLiteral(id)}'`).join(' or ');
  return `trashed = false and (${clause})`;
}

export function driveLiveSearchAmongIdsQuery(query: string, fileIds: string[]): string {
  const q = escapeDriveQueryLiteral(query.trim());
  const text = q
    ? ` and (name contains '${q}' or fullText contains '${q}')`
    : '';
  return `${driveFilesByIdsQuery(fileIds)}${text} and ${driveMimeFilter()}`;
}

/** File id from a Drive/Docs URL or a raw id. */
export function parseDriveFileId(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const fromPath = t.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (fromPath?.[1]) return fromPath[1];
  const fromQuery = t.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (fromQuery?.[1]) return fromQuery[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(t)) return t;
  return null;
}

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  size: number;
  webViewLink: string | null;
};

export function parseDriveFileList(data: unknown): { files: DriveFile[]; nextPageToken: string | null } {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const raw = Array.isArray(o.files) ? o.files : [];
  const files: DriveFile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const id = String(f.id ?? '').trim();
    const mimeType = String(f.mimeType ?? f.mime_type ?? '');
    if (!id || !isDriveIngestible(mimeType)) continue;
    files.push({
      id,
      name: String(f.name ?? 'Untitled'),
      mimeType,
      modifiedTime: f.modifiedTime ? String(f.modifiedTime) : null,
      size: Number(f.size ?? 0) || 0,
      webViewLink: f.webViewLink ? String(f.webViewLink) : null
    });
  }
  return { files, nextPageToken: o.nextPageToken ? String(o.nextPageToken) : null };
}

export function parseDriveAboutUser(data: unknown): string | null {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const user = o.user && typeof o.user === 'object' ? (o.user as Record<string, unknown>) : null;
  const email = String(user?.emailAddress ?? user?.displayName ?? '').trim();
  return email || null;
}

export type DriveFolder = { id: string; name: string; webViewLink: string | null };

export function parseDriveFolderList(data: unknown): { folders: DriveFolder[]; nextPageToken: string | null } {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const raw = Array.isArray(o.files) ? o.files : [];
  const folders: DriveFolder[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const id = String(f.id ?? '').trim();
    const mimeType = String(f.mimeType ?? f.mime_type ?? '');
    if (!id || mimeType !== DRIVE_FOLDER) continue;
    folders.push({
      id,
      name: String(f.name ?? 'Untitled folder'),
      webViewLink: f.webViewLink ? String(f.webViewLink) : null
    });
  }
  return { folders, nextPageToken: o.nextPageToken ? String(o.nextPageToken) : null };
}

export function parseDriveParents(data: unknown): string[] {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const raw = Array.isArray(o.parents) ? o.parents : [];
  return raw.map((p) => String(p ?? '').trim()).filter(Boolean);
}
