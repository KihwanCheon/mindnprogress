import { restoreBackup } from './data-archive.mjs'

function parseArguments(args) {
  const result = { projectDirectory: undefined, archivePath: undefined }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--project' || argument === '--archive') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} 뒤에 경로를 지정해 주세요.`)
      if (argument === '--project') result.projectDirectory = value
      else result.archivePath = value
      index += 1
    } else if (argument.startsWith('--')) {
      throw new Error(`알 수 없는 옵션입니다: ${argument}`)
    } else if (result.archivePath === undefined) {
      result.archivePath = argument
    } else {
      throw new Error(`복원할 ZIP은 하나만 지정할 수 있습니다: ${argument}`)
    }
  }
  return result
}

try {
  const options = parseArguments(process.argv.slice(2))
  const result = await restoreBackup({
    archivePath: options.archivePath,
    projectDirectory: options.projectDirectory,
  })
  console.log(`[MindNProgress] 복원 완료: ${result.archivePath}`)
  console.log(`[MindNProgress] 백업 생성 시각: ${result.manifest.createdAt}`)
  console.log(`[MindNProgress] 백업 Git 커밋: ${result.manifest.sourceCommit || '정보 없음'}`)
  if (result.rollbackDirectory) console.log(`[MindNProgress] 복원 전 데이터 보관: ${result.rollbackDirectory}`)
} catch (error) {
  console.error(`[MindNProgress] 복원 실패: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
