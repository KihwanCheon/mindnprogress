const IMAGE_FILE_EXTENSIONS = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpeg', '.jpg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
}

const MAX_IMAGE_FILE_NAME_LENGTH = 240

function fileNameWithSuffix(name, extension, suffix = '') {
  const availableNameLength = Math.max(1, MAX_IMAGE_FILE_NAME_LENGTH - extension.length - suffix.length)
  const truncatedName = name.slice(0, availableNameLength).trimEnd() || '이미지'.slice(0, availableNameLength)
  return `${truncatedName}${suffix}${extension}`
}

export function splitImageFileName(fileName, mimeType) {
  const trimmedFileName = String(fileName ?? '').trim()
  const extensions = IMAGE_FILE_EXTENSIONS[mimeType] ?? ['']
  const matchedExtension = extensions
    .find((extension) => extension && trimmedFileName.toLowerCase().endsWith(extension)
      && trimmedFileName.length > extension.length)
  const extension = matchedExtension
    ? trimmedFileName.slice(-matchedExtension.length)
    : extensions[0]
  const name = matchedExtension
    ? trimmedFileName.slice(0, -matchedExtension.length)
    : trimmedFileName
  return { name: name || '이미지', extension }
}

export function uniqueImageFileName(fileName, mimeType, usedFileNames) {
  const occupied = new Set([...usedFileNames].map((usedFileName) => {
    const used = splitImageFileName(usedFileName, mimeType)
    return fileNameWithSuffix(used.name, used.extension).toLowerCase()
  }))
  const { name, extension } = splitImageFileName(fileName, mimeType)
  const original = fileNameWithSuffix(name, extension)
  if (!occupied.has(original.toLowerCase())) return original

  const numberedName = name.match(/^(.*) \((\d+)\)$/)
  const baseName = numberedName?.[1]?.trimEnd() || name
  let sequence = numberedName ? Number(numberedName[2]) + 1 : 1
  while (true) {
    const candidate = fileNameWithSuffix(baseName, extension, ` (${sequence})`)
    if (!occupied.has(candidate.toLowerCase())) return candidate
    sequence += 1
  }
}
