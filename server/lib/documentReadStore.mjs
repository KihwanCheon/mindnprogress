import { readFile, stat } from 'node:fs/promises'

// 파일 교체와 외부 편집을 stat으로 확인한다. 호출자는 캐시 원문을 수정할 수 없다.
export function createDocumentReadStore({ fileForId, maxBytes = 64 * 1024 * 1024, read = readFile, inspect = stat }) {
  const cache = new Map()
  const pending = new Map()
  const generations = new Map()
  let bytes = 0
  const signature = (info) => [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':')
  const remove = (id) => {
    const previous = cache.get(id)
    if (previous) bytes -= previous.bytes
    cache.delete(id)
  }
  const invalidate = (id) => {
    generations.set(id, (generations.get(id) ?? 0) + 1)
    remove(id)
  }
  async function load(id, attempts = 0) {
    const file = fileForId(id)
    let info
    try { info = await inspect(file) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      invalidate(id)
      return null
    }
    const stamp = signature(info)
    const generation = generations.get(id) ?? 0
    const existing = cache.get(id)
    if (existing?.stamp === stamp && existing.generation === generation) {
      cache.delete(id); cache.set(id, existing)
      return existing
    }
    const key = `${id}:${generation}:${stamp}`
    if (pending.has(key)) return pending.get(key)
    const operation = (async () => {
      let text, after
      try { text = await read(file, 'utf8'); after = await inspect(file) } catch (error) {
        if (error.code !== 'ENOENT') throw error
        invalidate(id)
        return null
      }
      if (signature(after) !== stamp || (generations.get(id) ?? 0) !== generation) {
        if (attempts >= 3) throw Object.assign(new Error('문서 변경 중입니다. 다시 조회하세요.'), { code: 'DOCUMENT_READ_CHANGED' })
        return load(id, attempts + 1)
      }
      const entry = { stamp, generation, bytes: Buffer.byteLength(text), value: JSON.parse(text), projectionKey: null, projection: null }
      remove(id)
      if (entry.bytes <= maxBytes) {
        while (cache.size && bytes + entry.bytes > maxBytes) remove(cache.keys().next().value)
        cache.set(id, entry); bytes += entry.bytes
      }
      return entry
    })().finally(() => pending.delete(key))
    pending.set(key, operation)
    return operation
  }
  return {
    invalidate,
    async select(id, key, project, select = (value) => value) {
      const entry = await load(id)
      if (!entry) return null
      if (entry.projectionKey !== key || !entry.projection) {
        entry.projection = project(structuredClone(entry.value))
        entry.projectionKey = key
      }
      return structuredClone(select(entry.projection))
    },
  }
}
