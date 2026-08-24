[CmdletBinding()]
param(
  [string]$InstallRoot = '',
  [string]$MindNProgressRepository = 'https://github.com/mabobsa/MindNProgress.git',
  [string]$AionUiRepository = 'https://github.com/mabobsa/AionUi.git',
  [string]$AionCoreRepository = 'https://github.com/mabobsa/AionCore.git',
  [string]$MindNProgressBranch = 'main',
  [string]$AionUiBranch = 'main',
  [string]$AionCoreBranch = 'main',
  [switch]$NonInteractive,
  [switch]$InstallMissingPrerequisites,
  [switch]$ReuseExistingRepositories,
  [switch]$UpdateExistingRepositories,
  [switch]$SkipDependencyInstall,
  [switch]$SkipAionCoreBuild,
  [switch]$IncludeUnityWorkSkill,
  [switch]$CreateDesktopShortcuts,
  [switch]$NoLaunchPrompt,
  [switch]$PlanOnly,
  [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$script:TranscriptStarted = $false
$script:InstallLogPath = ''
$script:AgentGuidanceStartMarker = '<!-- BEGIN MnP Suite managed agent guidance -->'
$script:AgentGuidanceEndMarker = '<!-- END MnP Suite managed agent guidance -->'
$script:ManagedSkillMarkerName = '.mnp-suite-managed.json'

function Write-Step {
  param([int]$Number, [int]$Total, [string]$Message)
  Write-Host ''
  Write-Host "[$Number/$Total] $Message" -ForegroundColor Cyan
}

function Write-Info {
  param([string]$Message)
  Write-Host "  $Message"
}

function Write-Success {
  param([string]$Message)
  Write-Host "  [완료] $Message" -ForegroundColor Green
}

function Write-Utf8File {
  param([string]$Path, [string]$Content)
  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Read-Utf8File {
  param([string]$Path)
  try {
    return [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false, $true))
  } catch {
    throw "UTF-8 텍스트 파일을 안전하게 읽을 수 없습니다: $Path. 원본 파일을 UTF-8로 저장한 뒤 다시 실행하세요. ($($_.Exception.Message))"
  }
}

function Get-MnPSuitePackagedSkillPath {
  param([string]$Name)
  $path = Join-Path $PSScriptRoot "skills\$Name"
  if (-not (Test-Path -LiteralPath $path -PathType Container)) {
    throw "설치 패키지 스킬 폴더가 없습니다: $path"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $path 'SKILL.md') -PathType Leaf)) {
    throw "설치 패키지 스킬의 SKILL.md가 없습니다: $path"
  }
  return $path
}

function Get-MnPSuiteManagedSkillMarker {
  param([string]$DestinationPath)
  return Join-Path $DestinationPath $script:ManagedSkillMarkerName
}

function Test-MnPSuiteManagedSkill {
  param([string]$SkillsRoot, [string]$Name)
  $destination = Join-Path $SkillsRoot $Name
  $markerPath = Get-MnPSuiteManagedSkillMarker $destination
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { return $false }
  try {
    $marker = Read-Utf8File $markerPath | ConvertFrom-Json
    return [string]$marker.packageId -eq 'mnp-suite' -and [string]$marker.skillName -eq $Name
  } catch {
    return $false
  }
}

function Assert-MnPSuiteManagedSkillTarget {
  param([string]$SkillsRoot, [string]$Name)
  $destination = Join-Path $SkillsRoot $Name
  if (Test-Path -LiteralPath $destination -PathType Leaf) {
    throw "스킬 설치 대상이 폴더가 아닙니다: $destination"
  }
  if ((Test-Path -LiteralPath $destination) -and -not (Test-MnPSuiteManagedSkill $SkillsRoot $Name)) {
    throw "사용자 소유 스킬과 이름이 충돌합니다. 기존 폴더를 보존하기 위해 설치를 중단합니다: $destination"
  }
}

function Assert-MnPSuiteManagedBlockTarget {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path -PathType Container) {
    throw "전역 지침 파일 대상이 폴더입니다: $Path"
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  $existing = Read-Utf8File $Path
  $startCount = [regex]::Matches($existing, [regex]::Escape($script:AgentGuidanceStartMarker)).Count
  $endCount = [regex]::Matches($existing, [regex]::Escape($script:AgentGuidanceEndMarker)).Count
  if ($startCount -ne $endCount -or $startCount -gt 1) {
    throw "MnP Suite 관리 블록 표식이 손상되어 전역 지침을 안전하게 갱신할 수 없습니다: $Path"
  }
  if ($startCount -eq 1) {
    $pattern = [regex]::Escape($script:AgentGuidanceStartMarker) + '[\s\S]*?' + [regex]::Escape($script:AgentGuidanceEndMarker)
    if ([regex]::Matches($existing, $pattern).Count -ne 1) {
      throw "MnP Suite 관리 블록 표식 순서가 손상되어 전역 지침을 안전하게 갱신할 수 없습니다: $Path"
    }
  }
}

function Install-MnPSuiteManagedSkill {
  param(
    [string]$SourcePath,
    [string]$SkillsRoot,
    [string]$Name
  )
  Assert-MnPSuiteManagedSkillTarget $SkillsRoot $Name
  $destination = Join-Path $SkillsRoot $Name
  New-Item -ItemType Directory -Path $destination -Force | Out-Null

  $sourceRoot = [IO.Path]::GetFullPath($SourcePath).TrimEnd('\', '/')
  $installedFiles = @()
  foreach ($sourceFile in Get-ChildItem -LiteralPath $sourceRoot -File -Recurse) {
    $relativePath = $sourceFile.FullName.Substring($sourceRoot.Length).TrimStart([char[]]'\/')
    $destinationFile = Join-Path $destination $relativePath
    $destinationParent = Split-Path -Parent $destinationFile
    if (-not (Test-Path -LiteralPath $destinationParent)) {
      New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    }
    Copy-Item -LiteralPath $sourceFile.FullName -Destination $destinationFile -Force
    $installedFiles += [ordered]@{
      path = $relativePath.Replace('/', '\')
      sha256 = (Get-FileHash -LiteralPath $destinationFile -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }

  $marker = [ordered]@{
    schemaVersion = 1
    packageId = 'mnp-suite'
    skillName = $Name
    installedAt = (Get-Date).ToString('o')
    files = $installedFiles
  }
  Write-Utf8File (Get-MnPSuiteManagedSkillMarker $destination) ($marker | ConvertTo-Json -Depth 5)
  return [pscustomobject]@{
    Name = $Name
    Path = $destination
    Files = $installedFiles
  }
}

function Set-MnPSuiteManagedBlock {
  param([string]$Path, [string]$Content)
  Assert-MnPSuiteManagedBlockTarget $Path
  $existing = if (Test-Path -LiteralPath $Path -PathType Leaf) { Read-Utf8File $Path } else { '' }
  $newLine = if ($existing -match "`r`n") { "`r`n" } else { "`n" }
  $block = $script:AgentGuidanceStartMarker + $newLine + $Content.Trim() + $newLine + $script:AgentGuidanceEndMarker
  $startCount = [regex]::Matches($existing, [regex]::Escape($script:AgentGuidanceStartMarker)).Count

  if ($startCount -eq 1) {
    $pattern = [regex]::Escape($script:AgentGuidanceStartMarker) + '[\s\S]*?' + [regex]::Escape($script:AgentGuidanceEndMarker)
    $updated = [regex]::Replace($existing, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($match) $block }, 1)
  } elseif ([string]::IsNullOrWhiteSpace($existing)) {
    $updated = $block + $newLine
  } else {
    $updated = $existing.TrimEnd([char[]]"`r`n") + $newLine + $newLine + $block + $newLine
  }

  $backupPath = ''
  if ($updated -ne $existing) {
    if (-not [string]::IsNullOrWhiteSpace($existing)) {
      $backupPath = $Path + '.mnp-suite.preinstall.bak'
      if (-not (Test-Path -LiteralPath $backupPath)) {
        Copy-Item -LiteralPath $Path -Destination $backupPath
      }
    }
    Write-Utf8File $Path $updated
  }
  return [pscustomobject]@{ Path = $Path; BackupPath = $backupPath; Changed = $updated -ne $existing }
}

function Get-MnPSuiteAgentGuidance {
  param([bool]$IncludeUnityWork)
  $sections = @(@'
## MindNProgress·Dooray 작업

- MindNProgress MCP 도구를 호출하거나 Dooray 업무·댓글을 다루기 전에 `mnp-dooray` 스킬을 읽고 따른다.
- 사용자가 작성한 요구사항과 아직 유효한 기존 내용을 임의로 삭제하거나 의미가 달라지도록 바꾸지 않는다.
- 한국어 자연어는 실제 문자로 작성하고, 긴 원문은 파일로 확보해 프로그램으로 수정한 뒤 저장 문자열을 비교한다.
- Dooray 업무 생성·수정은 사용자가 승인했거나 현재 요청에서 명시한 경우에만 수행한다.
'@.Trim())

  if ($IncludeUnityWork) {
    $sections += @'
## Unity 작업

- Unity MCP로 프로젝트를 변경하거나 Unity UI 배치 코드를 작성하기 전에 `unity-work` 스킬을 읽고 따른다.
- 변경 호출마다 대상 `unity_instance`를 명시하고, `execute_code` 첫 줄에서 `Application.dataPath`를 검증하며 `replay`를 사용하지 않는다.
- `RectTransform`, `LayoutGroup`, `ScrollRect`의 시각적 배치를 런타임 코드로 덮어쓰지 않는다.
'@.Trim()
  }

  return $sections -join "`n`n"
}

function Assert-MnPSuiteAgentConfigurationTargets {
  param(
    [string]$CodexHome,
    [string]$ClaudeHome,
    [bool]$IncludeUnityWork
  )
  $skillNames = @('mnp-dooray')
  if ($IncludeUnityWork) { $skillNames += 'unity-work' }
  $platforms = @(
    [pscustomobject]@{ Name = 'Codex'; SkillsRoot = (Join-Path $CodexHome 'skills'); Instructions = (Join-Path $CodexHome 'AGENTS.md') },
    [pscustomobject]@{ Name = 'Claude Code'; SkillsRoot = (Join-Path $ClaudeHome 'skills'); Instructions = (Join-Path $ClaudeHome 'CLAUDE.md') }
  )
  foreach ($skillName in $skillNames) {
    Get-MnPSuitePackagedSkillPath $skillName | Out-Null
    foreach ($platform in $platforms) {
      Assert-MnPSuiteManagedSkillTarget $platform.SkillsRoot $skillName
    }
  }
  foreach ($platform in $platforms) {
    Assert-MnPSuiteManagedBlockTarget $platform.Instructions
  }
}

function Install-MnPSuiteAgentConfiguration {
  param(
    [string]$CodexHome,
    [string]$ClaudeHome,
    [bool]$IncludeUnityWork
  )
  Assert-MnPSuiteAgentConfigurationTargets $CodexHome $ClaudeHome $IncludeUnityWork
  $skillNames = @('mnp-dooray')
  if ($IncludeUnityWork) { $skillNames += 'unity-work' }
  $platforms = @(
    [pscustomobject]@{ Name = 'Codex'; SkillsRoot = (Join-Path $CodexHome 'skills'); Instructions = (Join-Path $CodexHome 'AGENTS.md') },
    [pscustomobject]@{ Name = 'Claude Code'; SkillsRoot = (Join-Path $ClaudeHome 'skills'); Instructions = (Join-Path $ClaudeHome 'CLAUDE.md') }
  )
  $guidance = Get-MnPSuiteAgentGuidance $IncludeUnityWork
  $platformResults = @()
  foreach ($platform in $platforms) {
    $installedSkills = @()
    foreach ($skillName in $skillNames) {
      $installedSkills += Install-MnPSuiteManagedSkill (Get-MnPSuitePackagedSkillPath $skillName) $platform.SkillsRoot $skillName
    }
    $instructionResult = Set-MnPSuiteManagedBlock $platform.Instructions $guidance
    $platformResults += [pscustomobject]@{
      Name = $platform.Name
      SkillsRoot = $platform.SkillsRoot
      Instructions = $instructionResult.Path
      InstructionsBackup = $instructionResult.BackupPath
      Skills = $installedSkills
    }
  }
  return [pscustomobject]@{
    Skills = $skillNames
    Platforms = $platformResults
  }
}

function Show-InstallerMessage {
  param(
    [string]$Text,
    [string]$Title,
    [ValidateSet('Information', 'Warning', 'Error')]
    [string]$Icon = 'Information'
  )
  if ($NonInteractive) { return }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $messageIcon = [Windows.Forms.MessageBoxIcon]::$Icon
    [Windows.Forms.MessageBox]::Show(
      $Text,
      $Title,
      [Windows.Forms.MessageBoxButtons]::OK,
      $messageIcon
    ) | Out-Null
  } catch {
    # Console output remains the fallback when WinForms is unavailable.
  }
}

function Read-YesNo {
  param([string]$Question, [bool]$Default = $false)
  if ($NonInteractive) { return $Default }
  $hint = if ($Default) { '[Y/n]' } else { '[y/N]' }
  $answer = (Read-Host "$Question $hint").Trim()
  if (-not $answer) { return $Default }
  return $answer -match '^(?i:y|yes|예|네)$'
}

function Get-MnPSuiteAgentHomes {
  $userProfileRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
  if ([string]::IsNullOrWhiteSpace($userProfileRoot)) {
    $userProfileRoot = $env:USERPROFILE
  }
  if ([string]::IsNullOrWhiteSpace($userProfileRoot)) {
    throw '현재 사용자의 프로필 경로를 확인할 수 없습니다.'
  }

  $codexHome = if ([string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
    Join-Path $userProfileRoot '.codex'
  } else {
    $env:CODEX_HOME
  }
  $claudeHome = if ([string]::IsNullOrWhiteSpace($env:CLAUDE_CONFIG_DIR)) {
    Join-Path $userProfileRoot '.claude'
  } else {
    $env:CLAUDE_CONFIG_DIR
  }

  return [pscustomobject]@{
    UserProfile = [IO.Path]::GetFullPath($userProfileRoot)
    CodexHome = [IO.Path]::GetFullPath($codexHome)
    ClaudeHome = [IO.Path]::GetFullPath($claudeHome)
  }
}

function Resolve-InstallRoot {
  if ($InstallRoot) {
    return [IO.Path]::GetFullPath($InstallRoot)
  }
  if ($NonInteractive) {
    throw 'NonInteractive 모드에서는 -InstallRoot를 지정해야 합니다.'
  }

  $defaultRoot = Join-Path $env:USERPROFILE 'source\MnPSuite'
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'MnP Suite 설치 루트를 선택하거나 새 폴더를 만드세요. 선택한 폴더 아래에 MindNProgress, AionUi, AionCore가 설치됩니다.'
    $dialog.ShowNewFolderButton = $true
    $candidateParent = Split-Path -Parent $defaultRoot
    if (Test-Path -LiteralPath $candidateParent) {
      $dialog.SelectedPath = $candidateParent
    }
    $result = $dialog.ShowDialog()
    if ($result -eq [Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) {
      $selected = [IO.Path]::GetFullPath($dialog.SelectedPath)
      $leaf = Split-Path -Leaf $selected
      if ($leaf -ne 'MnPSuite' -and (Read-YesNo "선택한 폴더 아래에 MnPSuite 폴더를 만들어 설치할까요?`n$selected" $true)) {
        return Join-Path $selected 'MnPSuite'
      }
      return $selected
    }
  } catch {
    Write-Info '폴더 선택 창을 열 수 없어 콘솔 입력으로 전환합니다.'
  }

  $answer = (Read-Host "설치 루트를 입력하세요 [$defaultRoot]").Trim().Trim('"')
  if (-not $answer) { $answer = $defaultRoot }
  return [IO.Path]::GetFullPath($answer)
}

function Assert-SafeInstallRoot {
  param([string]$Path)
  $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
  $root = [IO.Path]::GetPathRoot($fullPath).TrimEnd('\', '/')
  if ($fullPath.Equals($root, [StringComparison]::OrdinalIgnoreCase)) {
    throw '드라이브 루트에는 설치할 수 없습니다. 전용 하위 폴더를 선택하세요.'
  }

  $blocked = @(
    $env:WINDIR,
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    $env:ProgramData
  ) | Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\', '/') }
  foreach ($blockedPath in $blocked) {
    if ($fullPath.Equals($blockedPath, [StringComparison]::OrdinalIgnoreCase) -or
      $fullPath.StartsWith($blockedPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw "시스템 관리 폴더에는 설치할 수 없습니다: $blockedPath"
    }
  }

  if ($fullPath -match '(?i)\\OneDrive(?:\\|$)') {
    if (-not (Read-YesNo '선택한 경로가 OneDrive 안에 있습니다. Git 저장소와 로컬 운영 데이터 충돌 위험이 있습니다. 계속할까요?' $false)) {
      throw '사용자가 OneDrive 경로 설치를 취소했습니다.'
    }
  }
}

function Refresh-ProcessPath {
  $current = $env:Path
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $segments = @($current, $machine, $user) |
    Where-Object { $_ } |
    ForEach-Object { $_ -split ';' } |
    Where-Object { $_ } |
    Select-Object -Unique
  $env:Path = $segments -join ';'
  $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
  if ((Test-Path -LiteralPath $cargoBin) -and $env:Path -notlike "*$cargoBin*") {
    $env:Path = "$cargoBin;$env:Path"
  }
}

function Get-CommandVersion {
  param([string]$Command, [string[]]$Arguments = @('--version'))
  $resolved = Get-Command $Command -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $resolved) { return $null }
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $resolved.Source @Arguments 2>&1 | Select-Object -First 1
    if (-not $output) { return $null }
    return [string]$output
  } catch {
    return $null
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function ConvertTo-Version {
  param([string]$Text)
  if ($Text -match '(\d+)\.(\d+)(?:\.(\d+))?') {
    $patch = if ($matches[3]) { [int]$matches[3] } else { 0 }
    return [Version]::new([int]$matches[1], [int]$matches[2], $patch)
  }
  return $null
}

function Get-PythonVersion {
  $candidates = @(
    @{ Command = 'py'; Arguments = @('-3.12', '--version') },
    @{ Command = 'py'; Arguments = @('-3.11', '--version') },
    @{ Command = 'python'; Arguments = @('--version') }
  )
  foreach ($candidate in $candidates) {
    $version = Get-CommandVersion $candidate.Command $candidate.Arguments
    $parsed = ConvertTo-Version $version
    if ($parsed -and $parsed -ge [Version]'3.11.0') { return $version }
  }
  return $null
}

function Get-MsvcBuildToolsPath {
  $vswhereCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\Installer\vswhere.exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  foreach ($vswhere in $vswhereCandidates) {
    $result = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($LASTEXITCODE -eq 0 -and $result) { return ([string]$result).Trim() }
  }
  return $null
}

function Get-PrerequisiteState {
  Refresh-ProcessPath
  $gitVersion = Get-CommandVersion 'git'
  $gitReady = $gitVersion -match '^git version\s+\d'
  $nodeText = Get-CommandVersion 'node'
  $nodeVersion = ConvertTo-Version $nodeText
  $nodeSupported = $nodeVersion -and $nodeVersion.Major -ge 22 -and $nodeVersion.Major -lt 25
  $npmVersion = Get-CommandVersion 'npm'
  $npmReady = [bool](ConvertTo-Version $npmVersion)
  $bunVersion = Get-CommandVersion 'bun'
  $bunReady = [bool](ConvertTo-Version $bunVersion)
  $cargoVersion = Get-CommandVersion 'cargo'
  $rustupVersion = Get-CommandVersion 'rustup'
  $cargoReady = $cargoVersion -match '^cargo\s+\d' -and $rustupVersion -match '^rustup\s+\d'
  $pythonVersion = Get-PythonVersion
  $buildToolsPath = Get-MsvcBuildToolsPath
  $cargoDisplay = ("$cargoVersion / $rustupVersion").Trim()

  return @(
    [pscustomobject]@{ Key = 'Git'; Ready = [bool]$gitReady; Version = $gitVersion; WingetId = 'Git.Git'; Description = 'Git 저장소 clone과 업데이트' }
    [pscustomobject]@{ Key = 'Node'; Ready = [bool]$nodeSupported; Version = $nodeText; WingetId = 'OpenJS.NodeJS.LTS'; Description = 'AionUi는 Node.js 22 이상 25 미만 필요' }
    [pscustomobject]@{ Key = 'npm'; Ready = [bool]$npmReady; Version = $npmVersion; WingetId = 'OpenJS.NodeJS.LTS'; Description = 'MindNProgress 의존성 설치' }
    [pscustomobject]@{ Key = 'Bun'; Ready = [bool]$bunReady; Version = $bunVersion; WingetId = 'Oven-sh.Bun'; Description = 'AionUi 의존성 설치와 Dev 실행' }
    [pscustomobject]@{ Key = 'Cargo'; Ready = [bool]$cargoReady; Version = $cargoDisplay; WingetId = 'Rustlang.Rustup'; Description = 'AionCore 빌드와 고정 Rust toolchain 관리' }
    [pscustomobject]@{ Key = 'Python'; Ready = [bool]$pythonVersion; Version = $pythonVersion; WingetId = 'Python.Python.3.12'; Description = 'AionUi 네이티브 모듈 빌드' }
    [pscustomobject]@{ Key = 'MSVC'; Ready = [bool]$buildToolsPath; Version = $buildToolsPath; WingetId = 'Microsoft.VisualStudio.2022.BuildTools'; Description = 'Windows Rust MSVC와 네이티브 모듈 빌드' }
  )
}

function Show-PrerequisiteState {
  param([object[]]$State)
  foreach ($item in $State) {
    $marker = if ($item.Ready) { '[OK]' } else { '[필요]' }
    $color = if ($item.Ready) { 'Green' } else { 'Yellow' }
    $version = if ($item.Version) { " - $($item.Version)" } else { '' }
    Write-Host "  $marker $($item.Key)$version" -ForegroundColor $color
    if (-not $item.Ready) { Write-Info "    용도: $($item.Description)" }
  }
}

function Assert-WingetReady {
  $wingetCommand = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $wingetCommand) {
    throw '누락 도구를 자동 설치하려면 winget이 필요합니다. 사내 표준 소프트웨어 배포 도구로 필수 항목을 설치한 뒤 다시 실행하세요.'
  }

  $wingetVersion = Get-CommandVersion 'winget' @('--version')
  Write-Info "winget 상태 확인: $wingetVersion"
  & winget search --id Git.Git --exact --source winget --accept-source-agreements | Out-Null
  $probeExitCode = $LASTEXITCODE
  if ($probeExitCode -ne 0) {
    throw "winget 커뮤니티 소스를 사용할 수 없습니다 (exit $probeExitCode). Microsoft Store 또는 사내 배포 도구에서 '앱 설치 관리자(Desktop App Installer)'를 업데이트한 뒤 다시 실행하거나, 필수 도구를 수동 설치하세요."
  }
}

function Install-PrerequisitePackages {
  param([object[]]$Missing)
  Assert-WingetReady
  $packageIds = $Missing | Select-Object -ExpandProperty WingetId -Unique
  foreach ($packageId in $packageIds) {
    Write-Info "winget 설치: $packageId (source: winget)"
    $arguments = @(
      'install', '--id', $packageId, '--exact',
      '--source', 'winget',
      '--accept-package-agreements', '--accept-source-agreements'
    )
    if ($packageId -eq 'Microsoft.VisualStudio.2022.BuildTools') {
      $arguments += @(
        '--override',
        '--wait --passive --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
      )
    } else {
      $arguments += '--silent'
    }
    & winget @arguments
    if ($LASTEXITCODE -ne 0) {
      throw "winget 설치에 실패했습니다: $packageId (exit $LASTEXITCODE)"
    }
    Refresh-ProcessPath
  }
}

function Invoke-NativeCommand {
  param(
    [string]$Command,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [string]$Description
  )
  Write-Info $Description
  Push-Location $WorkingDirectory
  try {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$Description 실패 (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }
}

function Normalize-GitRemote {
  param([string]$Remote)
  return $Remote.Trim().TrimEnd('/').ToLowerInvariant() -replace '\.git$', ''
}

function Assert-RepositoryUpdateSet {
  param([object[]]$Repositories)
  if (-not $UpdateExistingRepositories) { return }

  foreach ($repository in $Repositories) {
    if (-not (Test-Path -LiteralPath $repository.Path)) { continue }
    if (-not (Test-Path -LiteralPath (Join-Path $repository.Path '.git'))) {
      throw "기존 대상이 Git 저장소가 아닙니다: $($repository.Path)"
    }

    $originOutput = @(& git -C $repository.Path remote get-url origin 2>$null)
    $originExitCode = $LASTEXITCODE
    $actualOrigin = $originOutput | Select-Object -First 1
    if ($originExitCode -ne 0 -or -not $actualOrigin) {
      throw "$($repository.Name) 기존 저장소의 origin을 확인할 수 없습니다: $($repository.Path)"
    }
    if ((Normalize-GitRemote $actualOrigin) -ne (Normalize-GitRemote $repository.Origin)) {
      throw "$($repository.Name) 기존 저장소 origin이 설치 설정과 다릅니다.`n기존: $actualOrigin`n예상: $($repository.Origin)"
    }

    $changes = & git -C $repository.Path status --porcelain
    if ($LASTEXITCODE -ne 0) { throw "$($repository.Name) 변경 상태를 확인할 수 없습니다." }
    if ($changes) {
      throw "$($repository.Name) 저장소에 커밋되지 않은 변경이 있어 어떤 저장소도 업데이트하지 않았습니다: $($repository.Path)"
    }
    $currentBranch = (& git -C $repository.Path branch --show-current).Trim()
    if ($currentBranch -ne $repository.Branch) {
      throw "$($repository.Name) 현재 브랜치가 '$currentBranch'입니다. 어떤 저장소도 업데이트하지 않았습니다."
    }
  }
}

function Install-GitRepository {
  param(
    [string]$Name,
    [string]$TargetPath,
    [string]$OriginUrl,
    [string]$UpstreamUrl,
    [string]$Branch
  )
  if (-not (Test-Path -LiteralPath $TargetPath)) {
    Invoke-NativeCommand 'git' @('-c', 'core.longpaths=true', 'clone', '--branch', $Branch, '--single-branch', $OriginUrl, $TargetPath) (Split-Path -Parent $TargetPath) "$Name clone"
  } else {
    $gitDirectory = Join-Path $TargetPath '.git'
    if (-not (Test-Path -LiteralPath $gitDirectory)) {
      throw "기존 대상이 Git 저장소가 아닙니다: $TargetPath"
    }
    $originOutput = @(& git -C $TargetPath remote get-url origin 2>$null)
    $originExitCode = $LASTEXITCODE
    $actualOrigin = $originOutput | Select-Object -First 1
    if ($originExitCode -ne 0 -or -not $actualOrigin) {
      throw "$Name 기존 저장소의 origin을 확인할 수 없습니다: $TargetPath"
    }
    if ((Normalize-GitRemote $actualOrigin) -ne (Normalize-GitRemote $OriginUrl)) {
      throw "$Name 기존 저장소 origin이 설치 설정과 다릅니다.`n기존: $actualOrigin`n예상: $OriginUrl"
    }

    $shouldUpdate = [bool]$UpdateExistingRepositories
    $shouldReuse = [bool]($ReuseExistingRepositories -or $UpdateExistingRepositories)
    if (-not $shouldReuse -and -not $NonInteractive) {
      Write-Host ''
      Write-Host "기존 $Name 저장소가 있습니다: $TargetPath" -ForegroundColor Yellow
      $choice = (Read-Host "[R] 그대로 재사용  [U] origin/$Branch fast-forward 업데이트  [C] 취소").Trim()
      if ($choice -match '^(?i:u)$') { $shouldReuse = $true; $shouldUpdate = $true }
      elseif ($choice -match '^(?i:r)$') { $shouldReuse = $true }
    }
    if (-not $shouldReuse) {
      throw "기존 $Name 저장소를 덮어쓰지 않았습니다. 재사용하려면 -ReuseExistingRepositories, 업데이트하려면 -UpdateExistingRepositories를 지정하세요."
    }

    if ($shouldUpdate) {
      $changes = & git -C $TargetPath status --porcelain
      if ($LASTEXITCODE -ne 0) { throw "$Name 변경 상태를 확인할 수 없습니다." }
      if ($changes) { throw "$Name 저장소에 커밋되지 않은 변경이 있어 업데이트하지 않았습니다: $TargetPath" }
      $currentBranch = (& git -C $TargetPath branch --show-current).Trim()
      if ($currentBranch -ne $Branch) {
        throw "$Name 현재 브랜치가 '$currentBranch'입니다. 자동으로 '$Branch'로 전환하지 않았습니다."
      }
      Invoke-NativeCommand 'git' @('pull', '--ff-only', 'origin', $Branch) $TargetPath "$Name fast-forward 업데이트"
    } else {
      Write-Info "$Name 기존 저장소 재사용"
    }
  }

  Invoke-NativeCommand 'git' @('config', 'core.longpaths', 'true') $TargetPath "$Name long path 설정"
  if ($UpstreamUrl) {
    $remoteNames = @(& git -C $TargetPath remote)
    if ($LASTEXITCODE -ne 0) { throw "$Name remote 목록을 확인할 수 없습니다." }
    if ($remoteNames -notcontains 'upstream') {
      Invoke-NativeCommand 'git' @('remote', 'add', 'upstream', $UpstreamUrl) $TargetPath "$Name upstream 등록"
    } else {
      $upstreamOutput = @(& git -C $TargetPath remote get-url upstream 2>$null)
      $upstreamExitCode = $LASTEXITCODE
      $existingUpstream = $upstreamOutput | Select-Object -First 1
      if ($upstreamExitCode -ne 0 -or -not $existingUpstream) { throw "$Name upstream 주소를 확인할 수 없습니다." }
      if ((Normalize-GitRemote $existingUpstream) -ne (Normalize-GitRemote $UpstreamUrl)) {
        Write-Warning "$Name upstream이 예상 주소와 달라 기존 값을 유지합니다: $existingUpstream"
      }
    }
  }
  Write-Success "$Name 준비됨"
}

function Ensure-AionUiMindNProgressBootstrap {
  param([string]$RepositoryPath)

  $bootstrapRelativePath = 'packages\desktop\src\process\utils\mindNProgressMcpBootstrap.ts'
  $migrationRelativePath = 'packages\desktop\src\process\utils\runBackendMigrations.ts'
  $testRelativePath = 'tests\unit\mindNProgressMcpBootstrap.test.ts'
  $bootstrapSource = Join-Path $RepositoryPath $bootstrapRelativePath
  $migrationSource = Join-Path $RepositoryPath $migrationRelativePath
  $bootstrapMarker = 'MINDNPROGRESS_MCP_ENTRY'
  $migrationMarker = 'buildMindNProgressMcpServer'
  if ((Test-Path -LiteralPath $bootstrapSource -PathType Leaf) -and
    (Test-Path -LiteralPath $migrationSource -PathType Leaf) -and
    ((Get-Content -LiteralPath $bootstrapSource -Raw) -match $bootstrapMarker) -and
    ((Get-Content -LiteralPath $migrationSource -Raw) -match $migrationMarker)) {
    $bootstrapChanges = @(& git -C $RepositoryPath status --porcelain -- $bootstrapRelativePath $migrationRelativePath $testRelativePath)
    if ($LASTEXITCODE -ne 0) { throw 'AionUi MindNProgress MCP bootstrap 변경 상태를 확인할 수 없습니다.' }
    if ($bootstrapChanges.Count -gt 0) {
      Write-Info 'AionUi에 설치기 MindNProgress MCP bootstrap overlay가 이미 적용되어 있습니다.'
      return [pscustomobject]@{ Applied = $true; Source = 'installer-overlay' }
    }
    Write-Info 'AionUi 저장소에 MindNProgress MCP bootstrap이 이미 포함되어 있습니다.'
    return [pscustomobject]@{ Applied = $false; Source = 'repository' }
  }

  $overlayPath = Join-Path $PSScriptRoot 'overlays\AionUi-MindNProgress-Mcp.patch'
  if (-not (Test-Path -LiteralPath $overlayPath -PathType Leaf)) {
    throw "MindNProgress MCP 자동 등록용 AionUi overlay가 없습니다: $overlayPath"
  }

  Invoke-NativeCommand 'git' @('apply', '--check', '--whitespace=error-all', $overlayPath) $RepositoryPath 'AionUi MindNProgress MCP overlay 사전 검사'
  Invoke-NativeCommand 'git' @('apply', '--whitespace=error-all', $overlayPath) $RepositoryPath 'AionUi MindNProgress MCP overlay 적용'

  if (-not (Test-Path -LiteralPath $bootstrapSource -PathType Leaf) -or
    -not (Test-Path -LiteralPath $migrationSource -PathType Leaf) -or
    ((Get-Content -LiteralPath $bootstrapSource -Raw) -notmatch $bootstrapMarker) -or
    ((Get-Content -LiteralPath $migrationSource -Raw) -notmatch $migrationMarker)) {
    throw 'AionUi MindNProgress MCP bootstrap overlay 적용 결과를 확인할 수 없습니다.'
  }

  Write-Success 'AionUi에 MindNProgress MCP 최초 실행 bootstrap 적용'
  return [pscustomobject]@{ Applied = $true; Source = 'installer-overlay' }
}

function Write-WorkspacePoolScaffold {
  param([string]$RootPath)

  $poolRoot = Join-Path $RootPath 'workspace-pool'
  $commonDirectory = Join-Path $poolRoot 'common'
  $inboxDirectory = Join-Path $poolRoot 'knowledge-inbox'
  $appliedDirectory = Join-Path $poolRoot 'knowledge-applied'
  foreach ($directory in @($poolRoot, $commonDirectory, $inboxDirectory, $appliedDirectory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  $registryPath = Join-Path $poolRoot 'workspaces.json'
  if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) {
    $registry = [ordered]@{
      schemaVersion = 1
      poolId = 'unity-local'
      sharedRoot = $poolRoot
      originUrl = ''
      workspaces = @(
        [ordered]@{
          id = 'integration'
          root = ''
          assetsPath = ''
          unityInstanceHash = ''
          role = 'integration'
          enabled = $false
        },
        [ordered]@{
          id = 'worker-01'
          root = ''
          assetsPath = ''
          unityInstanceHash = ''
          role = 'worker'
          enabled = $false
        }
      )
    }
    Write-Utf8File $registryPath ($registry | ConvertTo-Json -Depth 6)
  } else {
    Write-Info "기존 작업공간 구성 유지: $registryPath"
  }

  $rulesPath = Join-Path $commonDirectory 'MULTI_WORKSPACE.md'
  if (-not (Test-Path -LiteralPath $rulesPath -PathType Leaf)) {
    $rules = @'
# Unity 멀티 작업공간 공통 규칙

## 기본 모델

- `workspaces.json`이 작업공간 목록과 경로의 유일한 정적 원본입니다.
- `role=integration` 작업공간은 사용자 작업과 결과 통합 기준입니다.
- `role=worker`, `enabled=true`인 항목만 AI 위임 후보입니다.
- 실제 가용 상태는 MindNProgress 작업공간 풀 조회 결과로 판단합니다.
- 위임 전문이나 `.ai-session.json`이 없는 일반 대화에서는 worker를 임의로 선택하거나 점유하지 않습니다.

## AI 작업 규칙

1. 배정된 프로젝트 루트의 `.ai-workspace.json`과 `.ai-session.json`을 확인합니다.
2. 배정된 `projectRoot`, `branch`, `jobId`, `leaseId`만 사용합니다.
3. 다른 작업공간으로 이동하거나 그곳을 수정하지 않습니다.
4. 작업공간 선택, 점유, 전환과 해제는 MindNProgress만 수행합니다.
5. 코드와 Unity 에셋은 Git으로만 전달하며 작업공간 사이에 직접 복사하거나 링크하지 않습니다.
6. 공통 지식 제안은 `knowledge-inbox/<jobId>.md`에 기록하고, 적용이 끝난 항목은 `knowledge-applied`에 보관합니다.

## Unity MCP

Unity MCP 대상은 등록된 `assetsPath`와 `unityInstanceHash`로 구분합니다. 프로젝트를 변경하는 호출은 배정된 작업공간과 일치하는 Unity 인스턴스만 사용합니다.
'@
    Write-Utf8File $rulesPath $rules
  } else {
    Write-Info "기존 작업공간 규칙 유지: $rulesPath"
  }

  return [pscustomobject]@{
    Root = $poolRoot
    Registry = $registryPath
    Rules = $rulesPath
  }
}

function Write-DevLaunchers {
  param([string]$RootPath)
  $devDirectory = Join-Path $RootPath 'dev'
  New-Item -ItemType Directory -Path $devDirectory -Force | Out-Null

  $startMindNProgress = @'
@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "SUITE_ROOT=%~dp0.."
set "PROJECT=%SUITE_ROOT%\MindNProgress"
set "MNP_WORKSPACE_POOL_REGISTRY=%SUITE_ROOT%\workspace-pool\workspaces.json"

if not exist "%PROJECT%\package.json" (
  echo [ERROR] MindNProgress repository was not found: %PROJECT%
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node was not found on PATH.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found on PATH.
  pause
  exit /b 1
)

cd /d "%PROJECT%"
echo ============================================================
echo  MindNProgress development server
echo   Web : http://127.0.0.1:4175/
echo   API : http://127.0.0.1:4176/api/health
echo   Pool: %MNP_WORKSPACE_POOL_REGISTRY%
echo   Stop: Ctrl+C in this window
echo ============================================================
call npm run dev
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
'@

  $stopMindNProgress = @'
@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "SUITE_ROOT=%~dp0.."
set "PROJECT=%SUITE_ROOT%\MindNProgress"
set "MNP_STOP_PROJECT=%PROJECT%"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$project=[Regex]::Escape([IO.Path]::GetFullPath($env:MNP_STOP_PROJECT)); $ids=Get-NetTCPConnection -State Listen -LocalPort 4175,4176 -ErrorAction SilentlyContinue | ForEach-Object { $p=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $_.OwningProcess) -ErrorAction SilentlyContinue; if($p.CommandLine -and $p.CommandLine -match $project){ $p.ProcessId } } | Sort-Object -Unique; if($ids){ $ids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction Stop }; Write-Host '[MindNProgress] Stopped.' } else { Write-Host '[MindNProgress] Nothing is running.' }"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
'@

  $rebuildAionCore = @'
@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "SUITE_ROOT=%~dp0.."
set "PROJECT=%SUITE_ROOT%\AionCore"

if not exist "%PROJECT%\Cargo.toml" (
  echo [ERROR] AionCore repository was not found: %PROJECT%
  pause
  exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo [ERROR] cargo was not found on PATH.
  pause
  exit /b 1
)

cd /d "%PROJECT%"
echo [AionCore] Building release aioncore.exe...
call cargo build --release --locked --bin aioncore
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" echo [AionCore] Build completed: %PROJECT%\target\release\aioncore.exe
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
'@

  $backupMindNProgress = @'
@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "SUITE_ROOT=%~dp0.."
set "MNP_BACKUP_NO_PAUSE=1"
call "%SUITE_ROOT%\MindNProgress\MindNProgress_Backup.bat" -Destination "%SUITE_ROOT%\MindNProgress_Backup"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
'@

  $restoreMindNProgress = @'
@echo off
setlocal EnableExtensions
chcp 65001 >nul
if "%~1"=="" (
  echo Usage: %~nx0 "^<backup.zip^>"
  pause
  exit /b 1
)
set "SUITE_ROOT=%~dp0.."
set "MNP_BACKUP_NO_PAUSE=1"
call "%SUITE_ROOT%\MindNProgress\MindNProgress_Restore.bat" "%~1"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
'@

  $startAionUi = @'
@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "SUITE_ROOT=%~dp0.."
set "AION_UI_DIR=%SUITE_ROOT%\AionUi"
set "AION_CORE_BIN=%SUITE_ROOT%\AionCore\target\release"
set "MINDNPROGRESS_MCP_ENTRY=%SUITE_ROOT%\MindNProgress\mcp\server.mjs"

if not exist "%AION_UI_DIR%\package.json" (
  echo [ERROR] AionUi repository was not found: %AION_UI_DIR%
  pause
  exit /b 1
)
if not exist "%AION_CORE_BIN%\aioncore.exe" (
  echo [ERROR] Local AionCore release binary was not found.
  echo         Run Rebuild-AionCore-Release.bat first.
  pause
  exit /b 1
)
if not exist "%MINDNPROGRESS_MCP_ENTRY%" (
  echo [ERROR] MindNProgress MCP entry was not found: %MINDNPROGRESS_MCP_ENTRY%
  pause
  exit /b 1
)
where bun >nul 2>nul
if errorlevel 1 (
  echo [ERROR] bun was not found on PATH.
  pause
  exit /b 1
)

set "PATH=%AION_CORE_BIN%;%PATH%"
set "SENTRY_DSN="
set "NoDefaultCurrentDirectoryInExePath="
cd /d "%AION_UI_DIR%"
echo ============================================================
echo  AionUi development mode
echo   AionCore: %AION_CORE_BIN%\aioncore.exe
echo   MnP MCP : %MINDNPROGRESS_MCP_ENTRY%
echo   Telemetry: disabled for this launcher
echo   Stop     : close AionUi or press Ctrl+C in this window
echo ============================================================
call bun run dev
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
'@

  $startAll = @'
@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "DEV_DIR=%~dp0"

start "MindNProgress Dev" cmd.exe /d /k ""%DEV_DIR%Start-MindNProgress-Dev.bat""
start "AionUi Dev" cmd.exe /d /k ""%DEV_DIR%Start-AionUi-Dev.bat""
echo MindNProgress and AionUi development windows were started.
echo MnP: http://127.0.0.1:4175/
exit /b 0
'@

  $compatibilityStop = @'
@echo off
setlocal EnableExtensions
call "%~dp0dev\Stop-MindNProgress-Dev.bat"
exit /b %ERRORLEVEL%
'@

  $compatibilityLauncher = @'
const { spawn } = require('node:child_process')
const path = require('node:path')

const rootDirectory = __dirname
const launcher = path.join(rootDirectory, 'dev', 'Start-MindNProgress-Dev.bat')
const commandProcessor = process.env.ComSpec || 'cmd.exe'
const child = spawn(commandProcessor, ['/d', '/c', `"${launcher}"`], {
  cwd: rootDirectory,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
})
child.unref()
'@

  Write-Utf8File (Join-Path $devDirectory 'Start-MindNProgress-Dev.bat') $startMindNProgress
  Write-Utf8File (Join-Path $devDirectory 'Stop-MindNProgress-Dev.bat') $stopMindNProgress
  Write-Utf8File (Join-Path $devDirectory 'Rebuild-AionCore-Release.bat') $rebuildAionCore
  Write-Utf8File (Join-Path $devDirectory 'Backup-MindNProgress-Data.bat') $backupMindNProgress
  Write-Utf8File (Join-Path $devDirectory 'Restore-MindNProgress-Data.bat') $restoreMindNProgress
  Write-Utf8File (Join-Path $devDirectory 'Start-AionUi-Dev.bat') $startAionUi
  Write-Utf8File (Join-Path $devDirectory 'Start-All-Dev.bat') $startAll
  Write-Utf8File (Join-Path $RootPath 'MindNProgress_Stop.bat') $compatibilityStop
  Write-Utf8File (Join-Path $RootPath 'MindNProgress_Launcher.cjs') $compatibilityLauncher
  return $devDirectory
}

function Write-InstalledReadme {
  param([string]$RootPath)
  $content = @'
# MnP Suite 개발 환경

이 폴더에는 Git 저장소 세 개가 서로 독립된 형제 폴더로 설치되어 있습니다.

```text
MindNProgress/
AionUi/
AionCore/
workspace-pool/
  common/MULTI_WORKSPACE.md
  knowledge-inbox/
  knowledge-applied/
  workspaces.json
dev/
UNITY_MCP_AND_FORK_GUIDE.md
```

## 실행

- 전체 실행: `dev\Start-All-Dev.bat`
- MindNProgress만 실행: `dev\Start-MindNProgress-Dev.bat`
- AionUi만 실행: `dev\Start-AionUi-Dev.bat`
- AionCore 다시 빌드: `dev\Rebuild-AionCore-Release.bat`
- MindNProgress 강제 중지: `dev\Stop-MindNProgress-Dev.bat`
- MindNProgress 데이터 백업: `dev\Backup-MindNProgress-Data.bat`
- MindNProgress 데이터 복원: `dev\Restore-MindNProgress-Data.bat <backup.zip>`

루트의 `MindNProgress_Launcher.cjs`와 `MindNProgress_Stop.bat`은 기존 백업·복원 스크립트가 Suite 실행 상태를 중지하고 복구할 수 있도록 연결하는 호환 실행 파일입니다.

MindNProgress 주소는 `http://127.0.0.1:4175/`입니다. AionUi는 Electron 창으로 열리며 로컬 `AionCore\target\release\aioncore.exe`를 사용합니다.

## AionUi의 MindNProgress MCP

AionUi Dev 런처는 설치된 MCP 엔트리 경로를 전달합니다. AionUi는 백엔드가 준비되면 다음 서버를 자동 등록하고 활성 상태 및 경로를 현재 설치 위치에 맞춥니다.

```text
이름: MindNProgress
전송 방식: stdio
명령: node
인수: <이 설치 루트>\MindNProgress\mcp\server.mjs
```

MnP의 `AI 대화 시작` 창을 다시 열면 `MindNProgress · 필수`로 표시됩니다. MCP 설정과 Assistant 기본값 변경은 새 대화부터 적용될 수 있으며 현재 열려 있는 대화에 소급 적용되지 않습니다.

## Claude Code와 Codex 전역 스킬

설치기는 현재 Windows 사용자에게 다음 구성을 적용합니다.

- 필수: `mnp-dooray`
- 선택: 설치 중 선택한 `unity-work`
- Codex: `.codex\skills`와 `.codex\AGENTS.md`
- Claude Code: `.claude\skills`와 `.claude\CLAUDE.md`

Claude Code 또는 Codex의 전역 구성 폴더가 아직 없어도 필요한 폴더와 파일을 생성합니다. 기존 전역 지침은 유지하고 MnP Suite 표식 사이의 관리 블록만 추가·갱신합니다. 최초 변경 전 원문이 있으면 같은 위치에 `.mnp-suite.preinstall.bak` 백업을 한 번 만듭니다. 같은 이름의 사용자 소유 스킬이 있으면 덮어쓰지 않고 설치를 중단합니다. 실제 적용 경로와 선택 스킬은 `installation-manifest.json`에서 확인할 수 있습니다.

## Unity MCP와 Fork

Unity 프로젝트 연결, 여러 Unity Editor의 안전한 구분, AionUi·AionCore 소스 fork와 Unity worker 작업공간의 차이는 `UNITY_MCP_AND_FORK_GUIDE.md`를 확인하세요.

설치 시 `workspace-pool\workspaces.json`과 공용 폴더가 생성됩니다. 예시 integration·worker 항목은 안전을 위해 비활성 상태입니다. 실제 Unity Git clone의 절대 경로, `Assets` 경로, 인스턴스 해시와 원격 주소를 입력한 뒤 필요한 항목만 `enabled=true`로 바꾸고 MindNProgress를 다시 시작하세요.

## 저장소 업데이트

각 저장소의 변경 상태와 브랜치를 확인한 뒤 개별적으로 업데이트합니다. 작업 파일이 있는 상태에서 설치 스크립트를 업데이트 모드로 다시 실행하지 마세요. AionCore가 바뀌면 `Rebuild-AionCore-Release.bat`을 실행하고 AionUi를 다시 시작해야 합니다.

## 데이터

MindNProgress 운영 데이터는 `MindNProgress\server\data`에 저장됩니다. Git 소스 업데이트와 별도로 백업해야 하며 다른 PC 설치와 자동 동기화되지 않습니다.
'@
  Write-Utf8File (Join-Path $RootPath 'README_FIRST.md') $content
}

function Copy-UserGuides {
  param([string]$RootPath)
  $sourcePath = Join-Path $PSScriptRoot 'UNITY_MCP_AND_FORK_GUIDE.md'
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "설치 패키지의 Unity MCP 및 Fork 가이드가 없습니다: $sourcePath"
  }
  $destinationPath = Join-Path $RootPath 'UNITY_MCP_AND_FORK_GUIDE.md'
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
  return $destinationPath
}

function New-DesktopShortcut {
  param(
    [string]$Name,
    [string]$TargetPath,
    [string]$WorkingDirectory,
    [string]$DesktopPath = ''
  )
  $shell = New-Object -ComObject WScript.Shell
  $desktop = $DesktopPath
  if (-not $desktop) {
    $desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
  }
  if (-not $desktop) {
    $desktop = [string]$shell.SpecialFolders.Item('Desktop')
  }
  if (-not $desktop -or -not (Test-Path -LiteralPath $desktop -PathType Container)) {
    throw "바탕화면 경로를 사용할 수 없습니다: $desktop"
  }
  $shortcutPath = Join-Path $desktop "$Name.lnk"
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Description = 'MnP Suite development launcher'
  $shortcut.Save()
  return $shortcutPath
}

function Get-RepositoryManifest {
  param([string]$Name, [string]$Path, [string]$ExpectedBranch, [string]$ExpectedOrigin)
  $commit = (& git -C $Path rev-parse HEAD).Trim()
  $branch = (& git -C $Path branch --show-current).Trim()
  $origin = (& git -C $Path remote get-url origin).Trim()
  return [ordered]@{
    name = $Name
    path = $Path
    origin = $origin
    expectedOrigin = $ExpectedOrigin
    branch = $branch
    expectedBranch = $ExpectedBranch
    commit = $commit
  }
}

function Invoke-SelfTest {
  $temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("mnp suite installer test " + [Guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    $workspacePool = Write-WorkspacePoolScaffold $temporaryRoot
    $dev = Write-DevLaunchers $temporaryRoot
    Write-InstalledReadme $temporaryRoot
    $guide = Copy-UserGuides $temporaryRoot
    $expected = @(
      'Start-MindNProgress-Dev.bat',
      'Stop-MindNProgress-Dev.bat',
      'Rebuild-AionCore-Release.bat',
      'Backup-MindNProgress-Data.bat',
      'Restore-MindNProgress-Data.bat',
      'Start-AionUi-Dev.bat',
      'Start-All-Dev.bat'
    )
    foreach ($file in $expected) {
      $path = Join-Path $dev $file
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "생성 파일 누락: $file" }
      $text = Get-Content -LiteralPath $path -Raw
      if ($text -match '(?i)[A-Z]:\\Git\\') { throw "하드코딩된 Git 경로 발견: $file" }
      if ($text -notmatch '%~dp0') { throw "상대 설치 루트 해석 누락: $file" }
    }
    $compatibilityStop = Join-Path $temporaryRoot 'MindNProgress_Stop.bat'
    $compatibilityLauncher = Join-Path $temporaryRoot 'MindNProgress_Launcher.cjs'
    foreach ($path in @($compatibilityStop, $compatibilityLauncher)) {
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "백업·복원 호환 실행 파일 누락: $path" }
    }
    & node --check $compatibilityLauncher
    if ($LASTEXITCODE -ne 0) { throw '백업·복원 호환 Node 실행 파일 구문 오류' }
    if (-not (Test-Path -LiteralPath $guide -PathType Leaf)) { throw 'Unity MCP 및 Fork 가이드 복사 실패' }
    $registryText = Get-Content -LiteralPath $workspacePool.Registry -Raw
    $registry = $registryText | ConvertFrom-Json
    if (@($registry.workspaces).Count -lt 2) { throw 'integration과 worker 작업공간 예시 누락' }
    if (@($registry.workspaces | Where-Object { $_.enabled -ne $false }).Count -ne 0) { throw '작업공간 예시는 비활성 상태여야 함' }
    if (-not (Test-Path -LiteralPath $workspacePool.Rules -PathType Leaf)) { throw '작업공간 공통 규칙 생성 실패' }
    $mindNProgressLauncher = Get-Content -LiteralPath (Join-Path $dev 'Start-MindNProgress-Dev.bat') -Raw
    if ($mindNProgressLauncher -notmatch 'MNP_WORKSPACE_POOL_REGISTRY=%SUITE_ROOT%\\workspace-pool\\workspaces\.json') {
      throw 'MindNProgress 런처의 작업공간 구성 연결 누락'
    }
    $aionUiLauncher = Get-Content -LiteralPath (Join-Path $dev 'Start-AionUi-Dev.bat') -Raw
    if ($aionUiLauncher -notmatch 'MINDNPROGRESS_MCP_ENTRY=%SUITE_ROOT%\\MindNProgress\\mcp\\server\.mjs') {
      throw 'AionUi 런처의 MindNProgress MCP bootstrap 경로 누락'
    }
    $overlayPath = Join-Path $PSScriptRoot 'overlays\AionUi-MindNProgress-Mcp.patch'
    $overlayText = Get-Content -LiteralPath $overlayPath -Raw
    if ($overlayText -notmatch 'buildMindNProgressMcpServer' -or $overlayText -notmatch 'MINDNPROGRESS_MCP_ENTRY') {
      throw 'AionUi MindNProgress MCP bootstrap overlay 누락 또는 손상'
    }
    $installedReadme = Read-Utf8File (Join-Path $temporaryRoot 'README_FIRST.md')
    if ($installedReadme -notmatch 'UNITY_MCP_AND_FORK_GUIDE\.md') { throw '설치 안내의 추가 가이드 참조 누락' }
    if ($installedReadme -notmatch 'mnp-dooray') { throw '설치 안내의 사용자 전역 스킬 설명 누락' }

    $agentCases = @(
      [pscustomobject]@{ Name = 'neither-exists'; CodexExists = $false; ClaudeExists = $false },
      [pscustomobject]@{ Name = 'codex-only'; CodexExists = $true; ClaudeExists = $false },
      [pscustomobject]@{ Name = 'claude-only'; CodexExists = $false; ClaudeExists = $true },
      [pscustomobject]@{ Name = 'both-exist'; CodexExists = $true; ClaudeExists = $true }
    )
    foreach ($agentCase in $agentCases) {
      $caseRoot = Join-Path $temporaryRoot ("agent-case-" + $agentCase.Name)
      $testCodexHome = Join-Path $caseRoot '.codex'
      $testClaudeHome = Join-Path $caseRoot '.claude'
      $codexOriginal = "CODEX_EXISTING_GUIDANCE 한글 보존: $($agentCase.Name)"
      $claudeOriginal = "CLAUDE_EXISTING_GUIDANCE 한글 보존: $($agentCase.Name)"
      if ($agentCase.CodexExists) {
        Write-Utf8File (Join-Path $testCodexHome 'AGENTS.md') $codexOriginal
      }
      if ($agentCase.ClaudeExists) {
        Write-Utf8File (Join-Path $testClaudeHome 'CLAUDE.md') $claudeOriginal
      }

      $agentResult = Install-MnPSuiteAgentConfiguration $testCodexHome $testClaudeHome $true
      foreach ($platform in $agentResult.Platforms) {
        if (-not (Test-Path -LiteralPath $platform.Instructions -PathType Leaf)) {
          throw "전역 지침 생성 실패 ($($agentCase.Name)): $($platform.Instructions)"
        }
        $instructionText = Read-Utf8File $platform.Instructions
        if ([regex]::Matches($instructionText, [regex]::Escape($script:AgentGuidanceStartMarker)).Count -ne 1) {
          throw "전역 지침 관리 블록 개수 오류 ($($agentCase.Name)): $($platform.Instructions)"
        }
        foreach ($skillName in @('mnp-dooray', 'unity-work')) {
          if (-not (Test-MnPSuiteManagedSkill $platform.SkillsRoot $skillName)) {
            throw "전역 스킬 설치 검증 실패 ($($agentCase.Name)): $($platform.Name) $skillName"
          }
        }
      }
      if ($agentCase.CodexExists) {
        if ((Read-Utf8File (Join-Path $testCodexHome 'AGENTS.md')) -notmatch [regex]::Escape($codexOriginal)) {
          throw "Codex 기존 지침 보존 실패: $($agentCase.Name)"
        }
        if ((Read-Utf8File (Join-Path $testCodexHome 'AGENTS.md.mnp-suite.preinstall.bak')) -ne $codexOriginal) {
          throw "Codex 기존 지침 백업 검증 실패: $($agentCase.Name)"
        }
      }
      if ($agentCase.ClaudeExists) {
        if ((Read-Utf8File (Join-Path $testClaudeHome 'CLAUDE.md')) -notmatch [regex]::Escape($claudeOriginal)) {
          throw "Claude 기존 지침 보존 실패: $($agentCase.Name)"
        }
        if ((Read-Utf8File (Join-Path $testClaudeHome 'CLAUDE.md.mnp-suite.preinstall.bak')) -ne $claudeOriginal) {
          throw "Claude 기존 지침 백업 검증 실패: $($agentCase.Name)"
        }
      }

      Install-MnPSuiteAgentConfiguration $testCodexHome $testClaudeHome $true | Out-Null
      foreach ($instructionsPath in @((Join-Path $testCodexHome 'AGENTS.md'), (Join-Path $testClaudeHome 'CLAUDE.md'))) {
        $instructionText = Read-Utf8File $instructionsPath
        if ([regex]::Matches($instructionText, [regex]::Escape($script:AgentGuidanceStartMarker)).Count -ne 1) {
          throw "전역 지침 재설치 멱등성 검증 실패 ($($agentCase.Name)): $instructionsPath"
        }
      }
    }

    $requiredOnlyRoot = Join-Path $temporaryRoot 'agent-case-required-only'
    $requiredOnlyCodex = Join-Path $requiredOnlyRoot '.codex'
    $requiredOnlyClaude = Join-Path $requiredOnlyRoot '.claude'
    $requiredOnlyResult = Install-MnPSuiteAgentConfiguration $requiredOnlyCodex $requiredOnlyClaude $false
    foreach ($platform in $requiredOnlyResult.Platforms) {
      if (-not (Test-MnPSuiteManagedSkill $platform.SkillsRoot 'mnp-dooray')) { throw '필수 mnp-dooray 설치 실패' }
      if (Test-Path -LiteralPath (Join-Path $platform.SkillsRoot 'unity-work')) { throw '선택하지 않은 unity-work가 설치됨' }
      $instructionText = Read-Utf8File $platform.Instructions
      if ($instructionText -match '## Unity 작업') { throw '선택하지 않은 unity-work 전역 지침이 추가됨' }
      if ($instructionText -notmatch '## MindNProgress·Dooray 작업') { throw '필수 mnp-dooray 전역 지침이 누락됨' }
    }

    $conflictRoot = Join-Path $temporaryRoot 'agent-case-conflict'
    $conflictCodex = Join-Path $conflictRoot '.codex'
    $conflictSkill = Join-Path $conflictCodex 'skills\mnp-dooray'
    Write-Utf8File (Join-Path $conflictSkill 'SKILL.md') 'USER_OWNED_SKILL'
    $conflictDetected = $false
    try {
      Assert-MnPSuiteAgentConfigurationTargets $conflictCodex (Join-Path $conflictRoot '.claude') $false
    } catch {
      $conflictDetected = $true
    }
    if (-not $conflictDetected) { throw '사용자 소유 스킬 충돌을 감지하지 못함' }
    if ((Read-Utf8File (Join-Path $conflictSkill 'SKILL.md')) -ne 'USER_OWNED_SKILL') {
      throw '충돌한 사용자 소유 스킬이 변경됨'
    }

    $brokenGuidancePath = Join-Path $temporaryRoot 'agent-case-broken-markers\AGENTS.md'
    Write-Utf8File $brokenGuidancePath ($script:AgentGuidanceEndMarker + "`n" + $script:AgentGuidanceStartMarker)
    $brokenMarkersDetected = $false
    try {
      Assert-MnPSuiteManagedBlockTarget $brokenGuidancePath
    } catch {
      $brokenMarkersDetected = $true
    }
    if (-not $brokenMarkersDetected) { throw '손상된 전역 지침 관리 블록을 감지하지 못함' }

    $testDesktop = Join-Path $temporaryRoot 'Desktop'
    New-Item -ItemType Directory -Path $testDesktop -Force | Out-Null
    $shortcutPath = New-DesktopShortcut 'MnP-Suite-Dev-Start' (Join-Path $dev 'Start-All-Dev.bat') $temporaryRoot $testDesktop
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { throw 'ASCII 바탕화면 바로가기 생성 실패' }
    & $env:ComSpec /d /c "`"$compatibilityStop`""
    if ($LASTEXITCODE -ne 0) { throw "경로 공백을 포함한 중지 배치 실행 실패 (exit $LASTEXITCODE)" }
    Write-Host '[SelfTest] Dev launcher template validation passed.' -ForegroundColor Green
  } finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
      Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
  }
}

if ($SelfTest) {
  Invoke-SelfTest
  exit 0
}

$resolvedRoot = ''
try {
  Write-Host '============================================================' -ForegroundColor DarkCyan
  Write-Host ' MnP + AionUi + AionCore Git 개발 환경 설치' -ForegroundColor Cyan
  Write-Host '============================================================' -ForegroundColor DarkCyan

  $resolvedRoot = Resolve-InstallRoot
  Assert-SafeInstallRoot $resolvedRoot

  $agentHomes = Get-MnPSuiteAgentHomes
  $codexSkillsRoot = Join-Path $agentHomes.CodexHome 'skills'
  $claudeSkillsRoot = Join-Path $agentHomes.ClaudeHome 'skills'
  $installUnityWork = [bool]$IncludeUnityWorkSkill -or
    (Test-MnPSuiteManagedSkill $codexSkillsRoot 'unity-work') -or
    (Test-MnPSuiteManagedSkill $claudeSkillsRoot 'unity-work')
  if (-not $installUnityWork -and -not $NonInteractive) {
    $installUnityWork = Read-YesNo 'Unity MCP를 사용하는 사용자를 위한 unity-work 스킬을 설치할까요?' $false
  }
  Assert-MnPSuiteAgentConfigurationTargets $agentHomes.CodexHome $agentHomes.ClaudeHome $installUnityWork

  Write-Host ''
  Write-Host '설치 계획' -ForegroundColor Cyan
  Write-Info "설치 루트    : $resolvedRoot"
  Write-Info "MindNProgress: $MindNProgressRepository ($MindNProgressBranch)"
  Write-Info "AionUi       : $AionUiRepository ($AionUiBranch)"
  Write-Info "AionCore     : $AionCoreRepository ($AionCoreBranch)"
  Write-Info 'Dev 실행 파일: <설치 루트>\dev'
  Write-Info '작업공간 구성: <설치 루트>\workspace-pool\workspaces.json (초기 비활성)'
  Write-Info '필수 전역 스킬: mnp-dooray (Claude Code + Codex)'
  Write-Info "Unity 전역 스킬: $(if ($installUnityWork) { 'unity-work 설치' } else { '설치 안 함' })"
  Write-Info "Codex 전역 구성: $($agentHomes.CodexHome)"
  Write-Info "Claude 전역 구성: $($agentHomes.ClaudeHome)"

  Write-Step 1 8 '필수 도구 확인'
  $prerequisites = @(Get-PrerequisiteState)
  Show-PrerequisiteState $prerequisites
  $missing = @($prerequisites | Where-Object { -not $_.Ready })

  if ($PlanOnly) {
    if ($missing.Count -gt 0) {
      Write-Warning "누락 또는 지원 범위 밖 도구: $($missing.Key -join ', ')"
    }
    Write-Host ''
    Write-Host '[PlanOnly] 파일과 시스템을 변경하지 않았습니다.' -ForegroundColor Green
    exit 0
  }

  if (-not $NonInteractive -and -not (Read-YesNo '이 계획으로 설치를 진행할까요?' $true)) {
    throw '사용자가 설치를 취소했습니다.'
  }

  New-Item -ItemType Directory -Path $resolvedRoot -Force | Out-Null
  $logDirectory = Join-Path $resolvedRoot 'install-logs'
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  $script:InstallLogPath = Join-Path $logDirectory ("install-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
  Start-Transcript -LiteralPath $script:InstallLogPath | Out-Null
  $script:TranscriptStarted = $true

  if ($missing.Count -gt 0) {
    $autoInstall = [bool]$InstallMissingPrerequisites
    if (-not $autoInstall -and -not $NonInteractive) {
      $autoInstall = Read-YesNo '누락 도구를 winget으로 설치할까요? 설치 프로그램이나 관리자 승인 창이 열릴 수 있습니다.' $true
    }
    if (-not $autoInstall) {
      throw "필수 도구가 준비되지 않았습니다: $($missing.Key -join ', ')"
    }
    Install-PrerequisitePackages $missing
    $prerequisites = @(Get-PrerequisiteState)
    Show-PrerequisiteState $prerequisites
    $missing = @($prerequisites | Where-Object { -not $_.Ready })
    if ($missing.Count -gt 0) {
      throw "도구 설치 후 현재 프로세스에서 확인되지 않는 항목이 있습니다: $($missing.Key -join ', '). Windows를 다시 시작하거나 새 터미널에서 설치 스크립트를 다시 실행하세요."
    }
  }

  Write-Step 2 8 'Git 저장소 준비'
  $mindNProgressPath = Join-Path $resolvedRoot 'MindNProgress'
  $aionUiPath = Join-Path $resolvedRoot 'AionUi'
  $aionCorePath = Join-Path $resolvedRoot 'AionCore'
  Assert-RepositoryUpdateSet @(
    [pscustomobject]@{ Name = 'MindNProgress'; Path = $mindNProgressPath; Origin = $MindNProgressRepository; Branch = $MindNProgressBranch },
    [pscustomobject]@{ Name = 'AionUi'; Path = $aionUiPath; Origin = $AionUiRepository; Branch = $AionUiBranch },
    [pscustomobject]@{ Name = 'AionCore'; Path = $aionCorePath; Origin = $AionCoreRepository; Branch = $AionCoreBranch }
  )
  Install-GitRepository 'MindNProgress' $mindNProgressPath $MindNProgressRepository '' $MindNProgressBranch
  Install-GitRepository 'AionUi' $aionUiPath $AionUiRepository 'https://github.com/iOfficeAI/AionUi.git' $AionUiBranch
  Install-GitRepository 'AionCore' $aionCorePath $AionCoreRepository 'https://github.com/iOfficeAI/AionCore.git' $AionCoreBranch
  $aionUiMcpBootstrap = Ensure-AionUiMindNProgressBootstrap $aionUiPath

  Write-Step 3 8 'JavaScript 의존성 설치'
  if ($SkipDependencyInstall) {
    Write-Warning 'SkipDependencyInstall이 지정되어 npm/bun 의존성 설치를 생략했습니다.'
  } else {
    Invoke-NativeCommand 'npm' @('ci') $mindNProgressPath 'MindNProgress npm ci'
    Invoke-NativeCommand 'bun' @('install', '--frozen-lockfile') $aionUiPath 'AionUi bun install --frozen-lockfile'
  }

  Write-Step 4 8 'AionCore release 빌드'
  if ($SkipAionCoreBuild) {
    Write-Warning 'SkipAionCoreBuild가 지정되어 AionCore 빌드를 생략했습니다.'
  } else {
    Invoke-NativeCommand 'cargo' @('build', '--release', '--locked', '--bin', 'aioncore') $aionCorePath 'AionCore cargo release build'
  }

  Write-Step 5 8 '작업공간 템플릿과 Dev 실행 배치 생성'
  $workspacePool = Write-WorkspacePoolScaffold $resolvedRoot
  $devDirectory = Write-DevLaunchers $resolvedRoot
  Write-InstalledReadme $resolvedRoot
  $unityMcpGuidePath = Copy-UserGuides $resolvedRoot
  Write-Success "Dev 실행 파일 생성: $devDirectory"
  Write-Success "작업공간 템플릿 생성: $($workspacePool.Registry)"
  Write-Success "Unity MCP 및 Fork 가이드 복사: $unityMcpGuidePath"

  Write-Step 6 8 'Claude Code와 Codex 사용자 전역 구성'
  $agentConfiguration = Install-MnPSuiteAgentConfiguration $agentHomes.CodexHome $agentHomes.ClaudeHome $installUnityWork
  foreach ($platform in $agentConfiguration.Platforms) {
    Write-Success "$($platform.Name) 지침 병합: $($platform.Instructions)"
    Write-Success "$($platform.Name) 스킬 설치: $($agentConfiguration.Skills -join ', ')"
  }

  Write-Step 7 8 '설치 결과 검증'
  $requiredFiles = @(
    (Join-Path $mindNProgressPath 'package.json'),
    (Join-Path $aionUiPath 'package.json'),
    (Join-Path $aionCorePath 'Cargo.toml'),
    (Join-Path $devDirectory 'Start-All-Dev.bat'),
    (Join-Path $devDirectory 'Backup-MindNProgress-Data.bat'),
    (Join-Path $devDirectory 'Restore-MindNProgress-Data.bat'),
    (Join-Path $resolvedRoot 'MindNProgress_Stop.bat'),
    (Join-Path $resolvedRoot 'MindNProgress_Launcher.cjs'),
    (Join-Path $resolvedRoot 'README_FIRST.md'),
    $workspacePool.Registry,
    $workspacePool.Rules,
    $unityMcpGuidePath
  )
  foreach ($platform in $agentConfiguration.Platforms) {
    $requiredFiles += $platform.Instructions
    foreach ($skill in $platform.Skills) {
      $requiredFiles += Join-Path $skill.Path 'SKILL.md'
      $requiredFiles += Get-MnPSuiteManagedSkillMarker $skill.Path
    }
  }
  if (-not $SkipAionCoreBuild) {
    $requiredFiles += Join-Path $aionCorePath 'target\release\aioncore.exe'
  }
  foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
      throw "설치 검증 파일이 없습니다: $requiredFile"
    }
  }

  $manifest = [ordered]@{
    schemaVersion = 2
    installedAt = (Get-Date).ToString('o')
    installRoot = $resolvedRoot
    repositories = @(
      (Get-RepositoryManifest 'MindNProgress' $mindNProgressPath $MindNProgressBranch $MindNProgressRepository),
      (Get-RepositoryManifest 'AionUi' $aionUiPath $AionUiBranch $AionUiRepository),
      (Get-RepositoryManifest 'AionCore' $aionCorePath $AionCoreBranch $AionCoreRepository)
    )
    launchers = @(
      'dev\Start-All-Dev.bat',
      'dev\Start-MindNProgress-Dev.bat',
      'dev\Stop-MindNProgress-Dev.bat',
      'dev\Start-AionUi-Dev.bat',
      'dev\Rebuild-AionCore-Release.bat',
      'dev\Backup-MindNProgress-Data.bat',
      'dev\Restore-MindNProgress-Data.bat',
      'MindNProgress_Stop.bat',
      'MindNProgress_Launcher.cjs'
    )
    guides = @(
      'README_FIRST.md',
      'UNITY_MCP_AND_FORK_GUIDE.md'
    )
    workspacePool = [ordered]@{
      root = 'workspace-pool'
      registry = 'workspace-pool\workspaces.json'
      enabledByDefault = $false
    }
    aionUiMindNProgressMcpBootstrap = [ordered]@{
      source = $aionUiMcpBootstrap.Source
      overlayApplied = [bool]$aionUiMcpBootstrap.Applied
      environmentVariable = 'MINDNPROGRESS_MCP_ENTRY'
      enabled = $true
    }
    agentConfiguration = [ordered]@{
      scope = 'user-global'
      requiredSkills = @('mnp-dooray')
      selectedOptionalSkills = @($agentConfiguration.Skills | Where-Object { $_ -ne 'mnp-dooray' })
      platforms = @($agentConfiguration.Platforms | ForEach-Object {
        [ordered]@{
          name = $_.Name
          instructions = $_.Instructions
          instructionsBackup = $_.InstructionsBackup
          skillsRoot = $_.SkillsRoot
          skills = @($_.Skills | ForEach-Object { [ordered]@{ name = $_.Name; path = $_.Path } })
        }
      })
    }
    dependencyInstallSkipped = [bool]$SkipDependencyInstall
    aionCoreBuildSkipped = [bool]$SkipAionCoreBuild
  }
  Write-Utf8File (Join-Path $resolvedRoot 'installation-manifest.json') ($manifest | ConvertTo-Json -Depth 6)
  Write-Success '저장소, 실행 배치와 설치 manifest 검증 완료'

  Write-Step 8 8 '설치 완료'
  $createShortcutsNow = [bool]$CreateDesktopShortcuts
  if (-not $createShortcutsNow -and -not $NonInteractive) {
    $createShortcutsNow = Read-YesNo '바탕화면에 전체 Dev 실행과 MnP 중지 바로가기를 만들까요?' $true
  }
  if ($createShortcutsNow) {
    try {
      New-DesktopShortcut 'MnP-Suite-Dev-Start' (Join-Path $devDirectory 'Start-All-Dev.bat') $resolvedRoot | Out-Null
      New-DesktopShortcut 'MindNProgress-Dev-Stop' (Join-Path $devDirectory 'Stop-MindNProgress-Dev.bat') $resolvedRoot | Out-Null
      Write-Success '바탕화면 바로가기 생성'
    } catch {
      Write-Warning "바탕화면 바로가기를 만들지 못했습니다. 설치는 완료 상태로 유지됩니다: $($_.Exception.Message)"
    }
  }

  $summary = @"
설치가 완료되었습니다.

설치 위치: $resolvedRoot
전체 실행: $devDirectory\Start-All-Dev.bat
MnP 주소: http://127.0.0.1:4175/
안내 문서: $resolvedRoot\README_FIRST.md
Unity 가이드: $unityMcpGuidePath
작업공간 구성: $($workspacePool.Registry) (초기 비활성)
전역 스킬: $($agentConfiguration.Skills -join ', ')
Codex 지침: $($agentHomes.CodexHome)\AGENTS.md
Claude 지침: $($agentHomes.ClaudeHome)\CLAUDE.md
설치 기록: $script:InstallLogPath

AionUi를 처음 열면 MindNProgress MCP가 자동 등록됩니다. MnP의 AI 대화 시작 창을 다시 열어 `MindNProgress · 필수` 표시를 확인하세요.
"@
  Write-Host ''
  Write-Host $summary -ForegroundColor Green
  Show-InstallerMessage $summary 'MnP Suite 설치 완료' 'Information'

  if (-not $NoLaunchPrompt -and -not $NonInteractive -and (Read-YesNo '지금 MnP와 AionUi Dev를 실행할까요?' $true)) {
    Start-Process -FilePath (Join-Path $devDirectory 'Start-All-Dev.bat') -WorkingDirectory $resolvedRoot
  }
} catch {
  $message = $_.Exception.Message
  Write-Host ''
  Write-Host "[설치 실패] $message" -ForegroundColor Red
  if ($script:InstallLogPath) { Write-Host "설치 기록: $script:InstallLogPath" -ForegroundColor Yellow }
  Show-InstallerMessage "$message`n`n설치 기록: $script:InstallLogPath" 'MnP Suite 설치 실패' 'Error'
  exit 1
} finally {
  if ($script:TranscriptStarted) {
    Stop-Transcript | Out-Null
    $script:TranscriptStarted = $false
  }
}

exit 0
