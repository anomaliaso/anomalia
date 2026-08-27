/** Drive folder listing + recursive expand (uses provider HTTP). */
import { parseDriveFolderId, type DriveFolderOption } from '$lib/drive-folders';
import {
  driveFilesByIdsQuery,
  driveFilesInFoldersQuery,
  driveFolderListQuery,
  parseDriveFileList,
  parseDriveFolderList,
  type DriveFile
} from './drive';
import { providerGetJson, type ProviderAuth } from './provider-fetch';

const FOLDER_FIELDS = 'nextPageToken,files(id,name,mimeType,webViewLink)';
const FILE_FIELDS = 'nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,parents)';
const FILE_META_FIELDS = 'id,name,mimeType,modifiedTime,size,webViewLink,parents';
const MAX_EXPANDED_FOLDERS = 40;

function driveFilesUrl(q: string, pageToken: string | null, pageSize = 100): string {
  return (
    `https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}&q=${encodeURIComponent(q)}` +
    `&fields=${FILE_FIELDS}&supportsAllDrives=true&includeItemsFromAllDrives=true` +
    (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
  );
}

export async function listDriveFolders(auth: ProviderAuth): Promise<DriveFolderOption[]> {
  const out: DriveFolderOption[] = [];
  let pageToken: string | null = null;
  const q = driveFolderListQuery();
  for (let i = 0; i < 3; i++) {
    const url =
      `https://www.googleapis.com/drive/v3/files?pageSize=100&q=${encodeURIComponent(q)}` +
      `&fields=${FOLDER_FIELDS}&orderBy=name` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const data = await providerGetJson(url, auth);
    const parsed = parseDriveFolderList(data);
    for (const folder of parsed.folders) {
      const id = parseDriveFolderId(folder.id);
      if (!id) continue;
      out.push({ id, name: folder.name });
    }
    pageToken = parsed.nextPageToken;
    if (!pageToken) break;
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function expandDriveFolderIds(auth: ProviderAuth, folderIds: string[]): Promise<string[]> {
  const seen = new Set(folderIds.map((id) => parseDriveFolderId(id)).filter((id): id is string => !!id));
  let frontier = [...seen];
  for (let depth = 0; depth < 4 && frontier.length && seen.size < MAX_EXPANDED_FOLDERS; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (seen.size >= MAX_EXPANDED_FOLDERS) break;
      const q = `'${id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const data = await providerGetJson(
        `https://www.googleapis.com/drive/v3/files?pageSize=100&q=${encodeURIComponent(q)}&fields=files(id,mimeType)`,
        auth
      );
      for (const folder of parseDriveFolderList(data).folders) {
        const child = parseDriveFolderId(folder.id);
        if (!child || seen.has(child) || seen.size >= MAX_EXPANDED_FOLDERS) continue;
        seen.add(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return [...seen];
}

export async function listDriveFilesInFolders(
  auth: ProviderAuth,
  folderIds: string[],
  cap: number
): Promise<DriveFile[]> {
  if (!folderIds.length || cap <= 0) return [];
  const files: DriveFile[] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < folderIds.length; i += 10) chunks.push(folderIds.slice(i, i + 10));
  for (const chunk of chunks) {
    if (files.length >= cap) break;
    let pageToken: string | null = null;
    const q = driveFilesInFoldersQuery(chunk);
    for (let i = 0; i < 4 && files.length < cap; i++) {
      const data = await providerGetJson(
        driveFilesUrl(q, pageToken) + `&orderBy=modifiedTime desc`,
        auth
      );
      const parsed = parseDriveFileList(data);
      files.push(...parsed.files);
      pageToken = parsed.nextPageToken;
      if (!pageToken) break;
    }
  }
  const unique = new Map<string, DriveFile>();
  for (const file of files) {
    if (!unique.has(file.id)) unique.set(file.id, file);
  }
  return [...unique.values()].slice(0, cap);
}

export async function fetchDriveFile(
  auth: ProviderAuth,
  fileId: string
): Promise<(DriveFile & { parents: string[] }) | null> {
  const id = parseDriveFolderId(fileId);
  if (!id) return null;
  const data = await providerGetJson(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=${FILE_META_FIELDS}&supportsAllDrives=true`,
    auth
  );
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  const mimeType = String(rec.mimeType ?? '');
  const parsedId = String(rec.id ?? id);
  const parents = Array.isArray(rec.parents) ? rec.parents.map((p) => String(p ?? '').trim()).filter(Boolean) : [];
  if (mimeType === 'application/vnd.google-apps.folder') {
    return {
      id: parsedId,
      name: String(rec.name ?? 'Untitled folder'),
      mimeType,
      modifiedTime: rec.modifiedTime ? String(rec.modifiedTime) : null,
      size: 0,
      webViewLink: rec.webViewLink ? String(rec.webViewLink) : null,
      parents
    };
  }
  const list = parseDriveFileList({ files: [rec] }).files[0];
  if (!list) return null;
  return { ...list, parents };
}

export async function listDriveFilesByIds(auth: ProviderAuth, fileIds: string[]): Promise<DriveFile[]> {
  const ids = [...new Set(fileIds.map((id) => parseDriveFolderId(id)).filter((id): id is string => !!id))];
  if (!ids.length) return [];
  const files: DriveFile[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const data = await providerGetJson(driveFilesUrl(driveFilesByIdsQuery(chunk), null, 50), auth);
    files.push(...parseDriveFileList(data).files);
  }
  const unique = new Map<string, DriveFile>();
  for (const file of files) {
    if (!unique.has(file.id)) unique.set(file.id, file);
  }
  return [...unique.values()];
}
