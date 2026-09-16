import { createBackup } from './data-archive.mjs'

function parseArguments(args) {
  const result = { projectDirectory: undefined, destination: undefined }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--project' || argument === '--destination') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} 뒤에 경로를 지정해 주세요.`)
      if (argument === '--project') result.projectDirectory = value
      else result.destination = value
      index += 1
    } else if (argument.startsWith('--')) {
      throw new Error(`알 수 없는 옵션입니다: ${argument}`)
    } else if (result.destination === undefined) {
      result.destination = argument
    } else {
      throw new Error(`백업 경로는 하나만 지정할 수 있습니다: ${argument}`)
    }
  }
  return result
}

try {
  const options = parseArguments(process.argv.slice(2))
  const result = await createBackup({
    projectDirectory: options.projectDirectory,
    destination: options.destination,
  })
  console.log(`[MindNProgress] 백업 완료: ${result.archivePath}`)
  console.log(`[MindNProgress] 파일 ${result.manifest.fileCount}개, 원본 ${result.manifest.totalBytes} 바이트, ZIP ${result.archiveBytes} 바이트`)
} catch (error) {
  console.error(`[MindNProgress] 백업 실패: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
