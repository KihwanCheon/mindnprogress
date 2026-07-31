import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDirectory = path.resolve(String(process.env.MNP_DATA_DIR ?? '').trim() || path.join(projectDirectory, 'server', 'data'))
const tokenFile = path.resolve(String(process.env.MNP_TOKEN_FILE ?? '').trim() || path.join(dataDirectory, '_integration-token'))
const apiBaseUrl = String(process.env.MNP_API_URL ?? 'http://127.0.0.1:4176').replace(/\/+$/, '')
const manifestFile = path.resolve(
  String(process.env.MNP_COMMENT_MIGRATION_MANIFEST ?? '').trim()
    || path.join(dataDirectory, '_migrations', 'comment-summary-detail-v1.json'),
)
const actor = String(process.env.MNP_MIGRATION_ACTOR ?? 'Codex CLI(GPT-5.6-Sol)').trim()
const command = process.argv[2] ?? 'status'

function option(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? String(process.argv[index + 1] ?? '') : fallback
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function now() {
  return new Date().toISOString()
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function readManifest() {
  try {
    return await readJson(manifestFile)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`마이그레이션 매니페스트가 없습니다. 먼저 snapshot을 실행하세요: ${manifestFile}`)
    }
    throw error
  }
}

async function writeManifest(manifest) {
  manifest.updatedAt = now()
  await mkdir(path.dirname(manifestFile), { recursive: true })
  const temporaryFile = `${manifestFile}.${process.pid}.tmp`
  await writeFile(temporaryFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rename(temporaryFile, manifestFile)
}

let integrationToken = ''

async function apiRequest(pathname, init = {}) {
  if (!integrationToken) integrationToken = (await readFile(tokenFile, 'utf8')).trim()
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${integrationToken}`,
      'X-MNP-Editor-Id': 'user-editor',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.error || `API 요청 실패: ${response.status}`)
    error.status = response.status
    error.body = body
    throw error
  }
  return body
}

function preservedMetadata(comment) {
  return {
    id: comment.id,
    mapId: comment.mapId,
    nodeId: comment.nodeId,
    parentId: comment.parentId ?? null,
    createdAt: comment.createdAt,
    author: comment.author,
    resolvedAt: comment.resolvedAt ?? null,
    resolvedBy: comment.resolvedBy ?? null,
    reactions: comment.reactions ?? {},
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function statusSummary(manifest) {
  const byStatus = {}
  const byDocument = {}
  for (const item of manifest.items) {
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1
    const document = byDocument[item.mapTitle] ?? { total: 0, statuses: {} }
    document.total += 1
    document.statuses[item.status] = (document.statuses[item.status] ?? 0) + 1
    byDocument[item.mapTitle] = document
  }
  return {
    manifestFile,
    total: manifest.items.length,
    byStatus,
    byDocument,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  }
}

async function snapshot() {
  let manifest
  try {
    manifest = await readManifest()
  } catch (error) {
    if (!String(error.message).startsWith('마이그레이션 매니페스트가 없습니다.')) throw error
    manifest = {
      migration: 'comment-summary-detail',
      version: 1,
      policy: {
        summary: '원문을 근거로 1~2문장 작성',
        detail: '마이그레이션 시 기존 댓글 원문을 문자 단위로 그대로 보존',
      },
      createdAt: now(),
      updatedAt: now(),
      items: [],
    }
  }

  const documentResult = await apiRequest('/api/maps')
  const documents = documentResult.maps ?? []
  const existingById = new Map(manifest.items.map((item) => [item.commentId, item]))
  const seenCommentIds = new Set()

  for (const document of documents) {
    const [mapResult, commentResult] = await Promise.all([
      apiRequest(`/api/maps/${encodeURIComponent(document.id)}`),
      apiRequest(`/api/maps/${encodeURIComponent(document.id)}/comments?includeDetail=true`),
    ])
    const nodesById = new Map((mapResult.map?.nodes ?? []).map((node) => [node.id, node]))
    for (const comment of commentResult.comments ?? []) {
      seenCommentIds.add(comment.id)
      const existing = existingById.get(comment.id)
      if (comment.contentFormat === 'summary-detail') {
        if (existing && existing.status !== 'verified') {
          existing.status = 'externally-migrated'
          existing.error = '매니페스트 적용 밖에서 summary-detail 형식으로 변경되었습니다.'
        }
        continue
      }

      const originalText = String(comment.text ?? '')
      const originalTextHash = sha256(originalText)
      if (existing) {
        if (existing.originalTextHash !== originalTextHash) {
          existing.status = 'needs-review'
          existing.error = '스냅샷 이후 원문이 변경되었습니다.'
          existing.currentTextHash = originalTextHash
        }
        continue
      }

      const node = nodesById.get(comment.nodeId)
      const item = {
        mapId: document.id,
        mapTitle: document.title,
        nodeId: comment.nodeId,
        nodeLabel: node?.data?.label ?? comment.nodeId,
        commentId: comment.id,
        parentId: comment.parentId ?? null,
        createdAt: comment.createdAt,
        author: comment.author,
        originalText,
        originalTextHash,
        originalMetadata: preservedMetadata(comment),
        summary: null,
        detail: null,
        status: 'pending',
        draftedAt: null,
        draftedBy: null,
        reviewedAt: null,
        reviewedBy: null,
        appliedAt: null,
        verifiedAt: null,
        error: null,
      }
      manifest.items.push(item)
      existingById.set(comment.id, item)
    }
  }

  for (const item of manifest.items) {
    if (!seenCommentIds.has(item.commentId) && !['verified', 'externally-migrated'].includes(item.status)) {
      item.status = 'missing'
      item.error = '현재 활성 문서 댓글 목록에서 찾을 수 없습니다.'
    }
  }

  manifest.items.sort((left, right) =>
    left.mapTitle.localeCompare(right.mapTitle, 'ko')
    || left.nodeLabel.localeCompare(right.nodeLabel, 'ko')
    || String(left.createdAt).localeCompare(String(right.createdAt)))
  await writeManifest(manifest)
  console.log(JSON.stringify(statusSummary(manifest), null, 2))
}

async function stageDrafts() {
  const inputFile = option('input')
  if (!inputFile) throw new Error('stage에는 --input <JSON 파일>이 필요합니다.')
  const drafts = await readJson(path.resolve(inputFile))
  if (!Array.isArray(drafts) || drafts.length === 0) throw new Error('초안 입력은 1개 이상의 배열이어야 합니다.')
  const manifest = await readManifest()
  const itemsById = new Map(manifest.items.map((item) => [item.commentId, item]))

  for (const draft of drafts) {
    const item = itemsById.get(String(draft.commentId ?? ''))
    if (!item) throw new Error(`매니페스트에서 댓글을 찾을 수 없습니다: ${draft.commentId}`)
    if (!['pending', 'drafted'].includes(item.status)) {
      throw new Error(`초안을 작성할 수 없는 상태입니다: ${item.commentId} (${item.status})`)
    }
    const summary = String(draft.summary ?? '').trim()
    if (!summary || summary.length > 240) throw new Error(`요약 길이가 올바르지 않습니다: ${item.commentId}`)
    if (!/^\[(진행|차단|결과)\]/.test(summary)) {
      throw new Error(`요약은 [진행], [차단], [결과] 중 하나로 시작해야 합니다: ${item.commentId}`)
    }
    item.summary = summary
    item.detail = item.originalText
    item.status = 'drafted'
    item.draftedAt = now()
    item.draftedBy = actor
    item.reviewedAt = null
    item.reviewedBy = null
    item.error = null
  }

  await writeManifest(manifest)
  console.log(JSON.stringify({ staged: drafts.length, ...statusSummary(manifest) }, null, 2))
}

async function reviewDrafts() {
  const inputFile = option('input')
  if (!inputFile) throw new Error('review에는 --input <JSON 파일>이 필요합니다.')
  const reviews = await readJson(path.resolve(inputFile))
  if (!Array.isArray(reviews) || reviews.length === 0) throw new Error('검토 입력은 1개 이상의 배열이어야 합니다.')
  const manifest = await readManifest()
  const itemsById = new Map(manifest.items.map((item) => [item.commentId, item]))

  for (const review of reviews) {
    const item = itemsById.get(String(review.commentId ?? ''))
    if (!item) throw new Error(`매니페스트에서 댓글을 찾을 수 없습니다: ${review.commentId}`)
    if (item.status !== 'drafted') throw new Error(`검토할 수 없는 상태입니다: ${item.commentId} (${item.status})`)
    if (item.detail !== item.originalText || sha256(item.detail) !== item.originalTextHash) {
      throw new Error(`상세가 원문과 일치하지 않습니다: ${item.commentId}`)
    }
    if (review.approved !== true) {
      item.status = 'needs-review'
      item.error = String(review.note ?? '요약 재검토 필요')
      continue
    }
    item.status = 'reviewed'
    item.reviewedAt = now()
    item.reviewedBy = actor
    item.error = null
  }

  await writeManifest(manifest)
  console.log(JSON.stringify({ reviewed: reviews.length, ...statusSummary(manifest) }, null, 2))
}

async function fetchComment(item) {
  const result = await apiRequest(`/api/maps/${encodeURIComponent(item.mapId)}/comments?nodeId=${encodeURIComponent(item.nodeId)}&includeDetail=true`)
  return (result.comments ?? []).find((comment) => comment.id === item.commentId) ?? null
}

function verifyMigratedComment(item, comment) {
  if (!comment) return '댓글을 찾을 수 없습니다.'
  if (comment.contentFormat !== 'summary-detail') return 'summary-detail 형식이 아닙니다.'
  if (comment.summary !== item.summary || comment.text !== item.summary) return '저장된 요약이 초안과 다릅니다.'
  if (comment.detail !== item.originalText) return '저장된 상세가 원문과 다릅니다.'
  if (!sameJson(preservedMetadata(comment), item.originalMetadata)) return '댓글 메타데이터가 변경되었습니다.'
  return ''
}

async function applyReviewed() {
  if (!hasFlag('confirm')) throw new Error('실제 적용에는 --confirm이 필요합니다.')
  const limit = Math.max(1, Number.parseInt(option('limit', '10'), 10) || 10)
  const manifest = await readManifest()
  const targets = manifest.items.filter((item) => item.status === 'reviewed').slice(0, limit)
  if (targets.length === 0) {
    console.log(JSON.stringify({ applied: 0, message: '적용할 reviewed 댓글이 없습니다.', ...statusSummary(manifest) }, null, 2))
    return
  }

  let applied = 0
  for (const item of targets) {
    try {
      if (item.detail !== item.originalText || sha256(item.detail) !== item.originalTextHash) {
        throw new Error('상세가 원문과 일치하지 않습니다.')
      }
      const current = await fetchComment(item)
      if (!current) throw new Error('현재 댓글을 찾을 수 없습니다.')
      if (current.contentFormat === 'summary-detail') throw new Error('이미 새 형식으로 변경된 댓글입니다.')
      if (current.text !== item.originalText) throw new Error('스냅샷 이후 원문이 변경되었습니다.')
      if (!sameJson(preservedMetadata(current), item.originalMetadata)) throw new Error('스냅샷 이후 댓글 메타데이터가 변경되었습니다.')

      await apiRequest(`/api/maps/${encodeURIComponent(item.mapId)}/comments/${encodeURIComponent(item.commentId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          expectedText: item.originalText,
          summary: item.summary,
          detail: item.originalText,
        }),
      })
      item.appliedAt = now()
      item.status = 'applied'
      await writeManifest(manifest)

      const saved = await fetchComment(item)
      const verificationError = verifyMigratedComment(item, saved)
      if (verificationError) throw new Error(verificationError)
      item.status = 'verified'
      item.verifiedAt = now()
      item.error = null
      applied += 1
      await writeManifest(manifest)
    } catch (error) {
      item.status = 'needs-review'
      item.error = error instanceof Error ? error.message : String(error)
      await writeManifest(manifest)
      throw error
    }
  }

  console.log(JSON.stringify({ applied, ...statusSummary(manifest) }, null, 2))
}

async function verifyApplied() {
  const manifest = await readManifest()
  const targets = manifest.items.filter((item) => ['applied', 'verified'].includes(item.status))
  let verified = 0
  for (const item of targets) {
    const comment = await fetchComment(item)
    const error = verifyMigratedComment(item, comment)
    if (error) {
      item.status = 'needs-review'
      item.error = error
    } else {
      item.status = 'verified'
      item.verifiedAt ??= now()
      item.error = null
      verified += 1
    }
  }
  await writeManifest(manifest)
  console.log(JSON.stringify({ verified, ...statusSummary(manifest) }, null, 2))
}

async function listItems() {
  const manifest = await readManifest()
  const requestedStatus = option('status')
  const requestedMapId = option('map-id')
  const requestedNodeId = option('node-id')
  const limit = Math.max(1, Number.parseInt(option('limit', '20'), 10) || 20)
  const items = manifest.items
    .filter((item) => !requestedStatus || item.status === requestedStatus)
    .filter((item) => !requestedMapId || item.mapId === requestedMapId)
    .filter((item) => !requestedNodeId || item.nodeId === requestedNodeId)
    .slice(0, limit)
    .map((item) => ({
      mapId: item.mapId,
      mapTitle: item.mapTitle,
      nodeId: item.nodeId,
      nodeLabel: item.nodeLabel,
      commentId: item.commentId,
      createdAt: item.createdAt,
      author: item.author?.name,
      status: item.status,
      originalText: item.originalText,
      summary: item.summary,
      error: item.error,
    }))
  console.log(JSON.stringify({ count: items.length, items }, null, 2))
}

async function main() {
  if (command === 'snapshot') return snapshot()
  if (command === 'stage') return stageDrafts()
  if (command === 'review') return reviewDrafts()
  if (command === 'apply') return applyReviewed()
  if (command === 'verify') return verifyApplied()
  if (command === 'list') return listItems()
  if (command === 'status') {
    console.log(JSON.stringify(statusSummary(await readManifest()), null, 2))
    return
  }
  throw new Error(`지원하지 않는 명령입니다: ${command}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
