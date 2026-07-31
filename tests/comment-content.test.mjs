import assert from 'node:assert/strict'
import test from 'node:test'
import {
  commentForResponse,
  createCommentContent,
  structuredCommentFormat,
  updateCommentContent,
} from '../server/lib/commentContent.mjs'

test('새 댓글을 마이그레이션 식별 가능한 요약·상세 형식으로 만든다', () => {
  const result = createCommentContent({
    summary: ' [결과] 구현과 검증을 완료했습니다. ',
    detail: ' 변경:\n- 댓글 구조 확장\n\n검증:\n- 단위 테스트 통과 ',
  })

  assert.deepEqual(result, {
    content: {
      contentFormat: structuredCommentFormat,
      summary: '[결과] 구현과 검증을 완료했습니다.',
      text: '[결과] 구현과 검증을 완료했습니다.',
      detail: '변경:\n- 댓글 구조 확장\n\n검증:\n- 단위 테스트 통과',
    },
  })
})

test('이전 text 호출은 기존 형식으로 보존해 향후 마이그레이션 대상으로 남긴다', () => {
  const result = createCommentContent({ text: '기존 호출로 작성한 상세 댓글' })

  assert.deepEqual(result, { content: { text: '기존 호출로 작성한 상세 댓글' } })
})

test('기존 댓글은 요약과 상세를 함께 보내면 새 형식으로 전환한다', () => {
  const legacy = {
    id: 'comment-legacy',
    text: '기존의 긴 본문',
    author: { id: 'user-editor', name: '편집자' },
  }
  const result = updateCommentContent(legacy, {
    summary: '[진행] 기존 댓글 분류를 완료했습니다.',
    detail: '기존 원문을 확인해 수행 내용과 결과를 상세에 보존했습니다.',
  })

  assert.equal(result.content.contentFormat, structuredCommentFormat)
  assert.equal(result.content.summary, '[진행] 기존 댓글 분류를 완료했습니다.')
  assert.equal(result.content.text, result.content.summary)
  assert.equal(result.content.detail, '기존 원문을 확인해 수행 내용과 결과를 상세에 보존했습니다.')
  assert.deepEqual(result.content.author, legacy.author)
})

test('기존 댓글에 상세만 추가해 원문 의미를 모호하게 만드는 변경을 거부한다', () => {
  const result = updateCommentContent({ id: 'comment-legacy', text: '기존 본문' }, {
    detail: '상세만 추가',
  })

  assert.match(result.error, /요약을 함께/)
})

test('요약 전용 조회는 상세 존재 여부만 알리고 상세 본문을 제외한다', () => {
  const comment = {
    id: 'comment-structured',
    contentFormat: structuredCommentFormat,
    summary: '[결과] 완료',
    text: '[결과] 완료',
    detail: '긴 상세 내용',
  }

  assert.deepEqual(commentForResponse(comment, false), {
    id: 'comment-structured',
    contentFormat: structuredCommentFormat,
    summary: '[결과] 완료',
    text: '[결과] 완료',
    hasDetail: true,
  })
  assert.equal(commentForResponse(comment, true), comment)
})
