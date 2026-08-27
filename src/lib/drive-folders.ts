/** Client-safe Google Drive selection for a brand (Picker files + legacy folders). */

export const DRIVE_FOLDER_LIMIT = 8;
/** Files granted via Google Picker (`drive.file` scope). Caps ingest + live reads. */
export const DRIVE_FILE_LIMIT = 40;

export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export type DriveFolderOption = { id: string; name: string };
export type DriveFileOption = { id: string; name: string; mimeType: string };

export function parseDriveFolderId(raw: string): string | null {
  const id = raw.trim();
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) return null;
  return id;
}

function asFolder(raw: unknown): DriveFolderOption | null {
  if (typeof raw === 'string') {
    const tab = raw.indexOf('\t');
    const idPart = tab === -1 ? raw : raw.slice(0, tab);
    const namePart = tab === -1 ? raw : raw.slice(tab + 1);
    const id = parseDriveFolderId(idPart);
    if (!id) return null;
    const name = namePart.trim() || id;
    return { id, name };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as { id?: unknown; name?: unknown };
  const id = typeof o.id === 'string' ? parseDriveFolderId(o.id) : null;
  if (!id) return null;
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : id;
  return { id, name };
}

export function parseDriveFolderSelection(settings: unknown): DriveFolderOption[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
  const folders = (settings as { folders?: unknown }).folders;
  if (!Array.isArray(folders)) return [];
  const unique: DriveFolderOption[] = [];
  for (const raw of folders) {
    const folder = asFolder(raw);
    if (!folder || unique.some((f) => f.id === folder.id)) continue;
    unique.push(folder);
    if (unique.length >= DRIVE_FOLDER_LIMIT) break;
  }
  return unique;
}

function asFile(raw: unknown): DriveFileOption | null {
  if (typeof raw === 'string') {
    const parts = raw.split('\t');
    const id = parseDriveFolderId(parts[0] ?? '');
    if (!id) return null;
    const name = (parts[1] ?? '').trim() || id;
    const mimeType = (parts[2] ?? '').trim() || 'application/octet-stream';
    return { id, name, mimeType };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as { id?: unknown; name?: unknown; mimeType?: unknown; mime_type?: unknown };
  const id = typeof o.id === 'string' ? parseDriveFolderId(o.id) : null;
  if (!id) return null;
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : id;
  const mimeType =
    (typeof o.mimeType === 'string' && o.mimeType.trim()) ||
    (typeof o.mime_type === 'string' && o.mime_type.trim()) ||
    'application/octet-stream';
  return { id, name, mimeType };
}

export function parseDriveFileSelection(settings: unknown): DriveFileOption[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
  const files = (settings as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  const unique: DriveFileOption[] = [];
  for (const raw of files) {
    const file = asFile(raw);
    if (!file || unique.some((f) => f.id === file.id)) continue;
    unique.push(file);
    if (unique.length >= DRIVE_FILE_LIMIT) break;
  }
  return unique;
}

/** True until the brand has picked at least one Picker file or (legacy) folder. */
export function driveNeedsFolderSelection(settings: unknown): boolean {
  return parseDriveFileSelection(settings).length === 0 && parseDriveFolderSelection(settings).length === 0;
}

export function driveFileFormValue(file: DriveFileOption): string {
  return `${file.id}\t${file.name.replace(/\t/g, ' ')}\t${file.mimeType.replace(/\t/g, ' ')}`;
}

export function parseDriveFileFormValues(raw: string[]): DriveFileOption[] {
  return parseDriveFileSelection({ files: raw });
}

export function isDriveFolderMime(mimeType: string): boolean {
  return mimeType === DRIVE_FOLDER_MIME;
}

export function splitPickedDriveItems(items: DriveFileOption[]): {
  files: DriveFileOption[];
  folders: DriveFolderOption[];
} {
  const files: DriveFileOption[] = [];
  const folders: DriveFolderOption[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (isDriveFolderMime(item.mimeType)) {
      if (folders.length < DRIVE_FOLDER_LIMIT) folders.push({ id: item.id, name: item.name });
    } else if (files.length < DRIVE_FILE_LIMIT) {
      files.push(item);
    }
  }
  return { files, folders };
}

export function driveBrandScope(settings: unknown): { fileIds: string[]; folderIds: string[] } {
  const files = parseDriveFileSelection(settings);
  const folderIds = [
    ...parseDriveFolderSelection(settings).map((f) => f.id),
    ...files.filter((f) => isDriveFolderMime(f.mimeType)).map((f) => f.id)
  ];
  const fileIds = files.filter((f) => !isDriveFolderMime(f.mimeType)).map((f) => f.id);
  return { fileIds: [...new Set(fileIds)], folderIds: [...new Set(folderIds)] };
}

/** File is in the brand picker list, or sits in a picked folder. */
export function driveFileInBrandScope(
  fileId: string,
  parentIds: string[],
  settings: unknown,
  extraFolderIds?: Iterable<string>
): boolean {
  const id = parseDriveFolderId(fileId);
  if (!id) return false;
  const scope = driveBrandScope(settings);
  if (scope.fileIds.includes(id)) return true;
  const folders = new Set([...scope.folderIds, ...(extraFolderIds ?? [])]);
  return parentIds.some((p) => folders.has(p));
}

export function parseDriveFolderFormValues(raw: string[]): DriveFolderOption[] {
  return parseDriveFolderSelection({ folders: raw });
}

export function driveFormValue(folder: DriveFolderOption): string {
  return `${folder.id}\t${folder.name.replace(/\t/g, ' ')}`;
}
