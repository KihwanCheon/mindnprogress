// 연속 알림은 한 번에 조회하되 조회 도중 도착한 변경은 다음 조회로 반드시 확인한다.
export function createCoalescedRefresh(load, delayMs = 150) {
  let pending = [], timer = null, running = false, disposed = false
  const run = async () => {
    timer = null
    if (disposed) return
    running = true
    const batch = pending.splice(0)
    try {
      const value = await load()
      if (disposed) throw new Error('조회가 종료되었습니다.')
      for (const item of batch) item.resolve(value)
    } catch (error) { for (const item of batch) item.reject(error) }
    finally {
      running = false
      if (!disposed && pending.length) timer = setTimeout(run, delayMs)
    }
  }
  return {
    request() {
      if (disposed) return Promise.reject(new Error('조회가 종료되었습니다.'))
      const result = new Promise((resolve, reject) => pending.push({ resolve, reject }))
      if (!running && timer === null) timer = setTimeout(run, delayMs)
      return result
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      for (const item of pending.splice(0)) item.reject(new Error('조회가 종료되었습니다.'))
    },
  }
}
