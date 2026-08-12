const TRAILING_SENTENCE_PUNCTUATION = /[.,!?;:，。！？；：]+$/u
const KOREAN_POSTPOSITIONS = [
  '으로부터', '에게서', '한테서', '이라고', '으로', '에서', '에게', '한테', '께서',
  '부터', '까지', '처럼', '보다', '마다', '조차', '마저', '밖에', '이랑', '이며',
  '라고', '이나', '하고', '은', '는', '이', '가', '을', '를', '의', '에', '로',
  '와', '과', '도', '만', '나', '랑', '며',
]

function openableHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function removeTrailingKoreanPostposition(value) {
  for (const postposition of KOREAN_POSTPOSITIONS) {
    if (!value.endsWith(postposition)) continue
    const prefix = value.slice(0, -postposition.length)
    const precedingCharacter = prefix.at(-1) ?? ''
    if (/[\x21-\x7e]/u.test(precedingCharacter)) return prefix
  }
  return value
}

function removeUnmatchedClosingDelimiters(value) {
  let result = value
  for (const [opening, closing] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    while (result.endsWith(closing)
      && result.split(closing).length > result.split(opening).length) {
      result = result.slice(0, -1)
    }
  }
  return result
}

function trimTextLinkCandidate(value) {
  let result = value
  let previous = ''
  while (result !== previous) {
    previous = result
    result = result.replace(TRAILING_SENTENCE_PUNCTUATION, '')
    result = removeTrailingKoreanPostposition(result)
    result = removeUnmatchedClosingDelimiters(result)
  }
  return result
}

export function extractTextLinks(text) {
  const links = []
  const urlPattern = /https?:\/\/[^\s<>"']+/gi
  let match

  while ((match = urlPattern.exec(text)) !== null) {
    const label = trimTextLinkCandidate(match[0])
    const href = openableHttpUrl(label)
    if (href) links.push({ href, label, start: match.index, end: match.index + label.length })
  }

  return links
}
