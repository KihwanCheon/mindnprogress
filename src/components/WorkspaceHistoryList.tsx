import './WorkspaceHistoryList.css'

export function WorkspaceHistoryList({ workspaces, workspace, disabled = false, heading = '최근 작업공간', onSelect, onRemove }: {
  workspaces: string[]
  workspace: string
  disabled?: boolean
  heading?: string
  onSelect: (workspace: string) => void
  onRemove?: (workspace: string) => void
}) {
  return <div className="ai-workspace-history">
    <div className="ai-workspace-history-heading"><span>{heading}</span><small>{workspaces.length}개</small></div>
    <div className="ai-workspace-history-list" role="list" aria-label={heading}>
      {workspaces.map((item) => <div className={`ai-workspace-history-item ${workspace.trim() === item ? 'selected' : ''}`} role="listitem" key={item}>
        <button type="button" className="ai-workspace-history-select" disabled={disabled} onClick={() => onSelect(item)} title={item} aria-pressed={workspace.trim() === item}>
          <span>{item}</span>
        </button>
        {onRemove && <button type="button" className="ai-workspace-history-remove" disabled={disabled} onClick={() => onRemove(item)} aria-label={`${item} 이력 삭제`} title="이력에서 삭제">×</button>}
      </div>)}
      {workspaces.length === 0 && <p className="ai-workspace-history-empty">최근 작업공간이 없습니다.</p>}
    </div>
  </div>
}
