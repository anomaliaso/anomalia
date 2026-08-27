import { describe, expect, it } from 'vitest';
import {
  DRIVE_FILE_LIMIT,
  DRIVE_FOLDER_LIMIT,
  DRIVE_FOLDER_MIME,
  driveBrandScope,
  driveFileFormValue,
  driveFileInBrandScope,
  driveFormValue,
  driveNeedsFolderSelection,
  parseDriveFileFormValues,
  parseDriveFileSelection,
  parseDriveFolderFormValues,
  parseDriveFolderId,
  parseDriveFolderSelection,
  splitPickedDriveItems
} from './drive-folders';
import { connectorNeedsScope } from './knowledge-scope';
import {
  notionFormValue,
  notionNeedsPageSelection,
  parseNotionPageFormValues,
  parseNotionPageSelection,
  normalizeNotionId
} from './notion-pages';

describe('drive folder selection', () => {
  it('parses ids, form values, and caps the list', () => {
    expect(parseDriveFolderId('abc123XYZ-_9')).toBe('abc123XYZ-_9');
    expect(parseDriveFolderId('nope')).toBeNull();
    const selected = parseDriveFolderFormValues(['fld12345678\tBrand kit', 'fld12345678\tDup']);
    expect(selected).toEqual([{ id: 'fld12345678', name: 'Brand kit' }]);
    expect(driveFormValue(selected[0])).toBe('fld12345678\tBrand kit');
    expect(driveNeedsFolderSelection({ folders: [] })).toBe(true);
    expect(driveNeedsFolderSelection({ folders: selected })).toBe(false);
    const many = Array.from({ length: DRIVE_FOLDER_LIMIT + 3 }, (_, i) => `folderid00${i}\tF${i}`);
    expect(parseDriveFolderSelection({ folders: many })).toHaveLength(DRIVE_FOLDER_LIMIT);
  });
});

describe('drive file picker selection', () => {
  it('parses Picker files and treats them as scoped', () => {
    const form = 'fileid00001\tBrand kit.pdf\tapplication/pdf';
    expect(parseDriveFileFormValues([form])).toEqual([
      { id: 'fileid00001', name: 'Brand kit.pdf', mimeType: 'application/pdf' }
    ]);
    expect(driveFileFormValue(parseDriveFileFormValues([form])[0])).toBe(form);
    expect(driveNeedsFolderSelection({ files: [] })).toBe(true);
    expect(driveNeedsFolderSelection({ files: [{ id: 'fileid00001', name: 'Kit', mimeType: 'application/pdf' }] })).toBe(
      false
    );
    expect(driveNeedsFolderSelection({ folders: [], files: [] })).toBe(true);
    const many = Array.from({ length: DRIVE_FILE_LIMIT + 5 }, (_, i) => ({
      id: `fileid0000${i}`,
      name: `F${i}`,
      mimeType: 'application/pdf'
    }));
    expect(parseDriveFileSelection({ files: many })).toHaveLength(DRIVE_FILE_LIMIT);
  });

  it('splits Picker folders from files and scopes reads', () => {
    const split = splitPickedDriveItems([
      { id: 'fileid00001', name: 'Kit.pdf', mimeType: 'application/pdf' },
      { id: 'folderid001', name: 'Brand', mimeType: DRIVE_FOLDER_MIME },
      { id: 'fileid00001', name: 'dup', mimeType: 'application/pdf' }
    ]);
    expect(split.files).toEqual([{ id: 'fileid00001', name: 'Kit.pdf', mimeType: 'application/pdf' }]);
    expect(split.folders).toEqual([{ id: 'folderid001', name: 'Brand' }]);
    expect(driveBrandScope({ files: split.files, folders: split.folders })).toEqual({
      fileIds: ['fileid00001'],
      folderIds: ['folderid001']
    });
    expect(driveFileInBrandScope('fileid00001', [], { files: split.files })).toBe(true);
    expect(driveFileInBrandScope('otherfile01', ['folderid001'], { folders: split.folders })).toBe(true);
    expect(driveFileInBrandScope('otherfile01', ['elsewhere1'], { files: split.files })).toBe(false);
  });
});

describe('notion page selection', () => {
  it('normalizes ids and keeps page vs database kind', () => {
    expect(normalizeNotionId('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(
      'a1b2c3d4-e5f6-a1b2-c3d4-e5f6a1b2c3d4'
    );
    const item = {
      id: 'a1b2c3d4-e5f6-a1b2-c3d4-e5f6a1b2c3d4',
      title: 'Voice',
      kind: 'page' as const
    };
    expect(parseNotionPageFormValues([notionFormValue(item)])).toEqual([item]);
    expect(notionNeedsPageSelection({})).toBe(true);
    expect(connectorNeedsScope('google-drive', {})).toBe(true);
    expect(connectorNeedsScope('google-drive', { files: [{ id: 'fileid00001', name: 'Kit', mimeType: 'application/pdf' }] })).toBe(
      false
    );
    expect(connectorNeedsScope('notion', { pages: [item] })).toBe(false);
    expect(connectorNeedsScope('google-mail', {})).toBe(false);
  });
});
