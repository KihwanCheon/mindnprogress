// 카드 이동·생성·자동 배치가 사용하는 캔버스 원점 기준 격자.
export const MINDMAP_GRID_SIZE = 24

export function snapMindMapPosition(position) {
  return {
    x: Math.round(position.x / MINDMAP_GRID_SIZE) * MINDMAP_GRID_SIZE,
    y: Math.round(position.y / MINDMAP_GRID_SIZE) * MINDMAP_GRID_SIZE,
  }
}
