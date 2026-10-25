export function createCoalescedRefresh<T>(load: () => Promise<T>, delayMs?: number): {
  request(): Promise<T>
  dispose(): void
}
