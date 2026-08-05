export type MindImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export function splitImageFileName(fileName: string, mimeType: MindImageMimeType): {
  name: string
  extension: string
}

export function uniqueImageFileName(
  fileName: string,
  mimeType: MindImageMimeType,
  usedFileNames: Iterable<string>,
): string
