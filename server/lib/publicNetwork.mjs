const virtualInterfacePattern = /(?:vethernet|wsl|docker|hyper-v|vmware|virtualbox|loopback|터널)/i

export function selectPublicIpv4(candidates, preferredInterface, warn = console.warn) {
  const usableCandidates = Array.isArray(candidates)
    ? candidates.filter((candidate) => candidate && typeof candidate.name === 'string' && typeof candidate.address === 'string')
    : []
  const preferred = String(preferredInterface ?? '').trim()

  if (preferred) {
    const wanted = preferred.toLowerCase()
    const matched = usableCandidates.find((candidate) => candidate.name.toLowerCase() === wanted)
      ?? usableCandidates.find((candidate) => candidate.name.toLowerCase().includes(wanted))
    if (matched) return matched.address
    warn(`[Mind & Progress] MNP_PUBLIC_INTERFACE=${preferred}에 해당하는 IPv4 주소가 없어 자동 감지를 사용합니다.`)
  }

  const sortedCandidates = [...usableCandidates]
    .sort((first, second) => Number(virtualInterfacePattern.test(first.name)) - Number(virtualInterfacePattern.test(second.name)))
  return sortedCandidates[0]?.address ?? '127.0.0.1'
}
