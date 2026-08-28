---
name: pptx
description: >
  pptx 파일 내용을 확인하거나 pptx에 담긴 기획 내용을 정리할 때 사용한다.
  PowerPoint COM을 1순위 렌더러로 사용하고, COM을 사용할 수 없는 PC에서는 AionUi에 기본
  포함된 officecli의 HTML 렌더러로 모든 슬라이드를 PNG로 저장한다. 추출한 텍스트·표 구조와 이미지를 함께
  보고 판단하며 렌더러 차이와 PowerPoint 직접 확인 필요 여부를 기록한다.
  pptx, ppt, 파워포인트, 발표 자료, 기획서 슬라이드를 읽어야 할 때 읽는다.
---

# pptx 확인 절차

텍스트 추출만으로 판단하면 도형 배치·표 병합·이미지 안의 글자를 놓친다. 이미지와 텍스트를 항상 함께 본다.

## 렌더러 우선순위

1. `pptx-mcp`의 `export_slides_to_images`를 먼저 사용한다. Windows에서는 PowerPoint COM으로 렌더링되며, 성공 응답의 `renderer`가 `powerpoint-com`인지 확인한다.
2. PowerPoint 미설치, COM 등록 없음, `pywin32` 없음처럼 **COM을 사용할 수 없다는 오류**가 발생한 경우에만 AionUi 기본 `officecli` HTML 렌더러로 전환한다.
3. 파일 손상, 암호 보호, 잘못된 슬라이드 번호처럼 COM 가용성과 무관한 오류는 fallback으로 숨기지 말고 원인을 보고한다.
4. 한 번 fallback으로 전환한 작업에서는 같은 파일에 COM 내보내기를 반복하지 않는다.

## 확인 순서

1. `pptx-mcp`로 파일을 연다.
2. `pptx-mcp`로 슬라이드 텍스트와 표 구조를 추출한다.
3. 위 렌더러 우선순위에 따라 모든 슬라이드를 PNG 이미지로 저장한다.
4. 저장된 PNG 이미지를 이미지 확인 도구로 모두 열어 시각적으로 확인한다.
5. 이미지와 텍스트를 함께 보고 기획 내용을 정리한다.
6. 사용한 렌더러를 결과에 기록한다.
7. 이미지와 추출 구조가 다르면 차이를 기록하고 PowerPoint에서 직접 확인할 필요가 있는지 명시한다.

## officecli fallback

PowerPoint COM을 사용할 수 없을 때만 다음 PowerShell 흐름을 사용한다. `--render html`을 명시해 Office 네이티브 렌더러를 다시 시도하지 않는다. 작성자가 지정한 슬라이드 가로 크기를 150 DPI 기준 픽셀로 환산해 `--screenshot-width`로 전달한다. 높이 계산과 최대 변 1920px 상한 내 비례 축소는 OfficeCLI에 맡긴다.

```powershell
$deckPath = 'C:\path\to\presentation.pptx'
$outputDirectory = 'C:\path\to\rendered-slides'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

function Convert-OfficeCliLengthToEmu {
  param([Parameter(Mandatory)][string]$Length)

  if ($Length -notmatch '^\s*(?<value>\d+(?:\.\d+)?)\s*(?<unit>emu|cm|mm|in|pt|px)\s*$') {
    throw "지원하지 않는 슬라이드 크기 형식입니다: $Length"
  }

  $value = [double]::Parse($Matches.value, [Globalization.CultureInfo]::InvariantCulture)
  switch ($Matches.unit.ToLowerInvariant()) {
    'emu' { return $value }
    'cm'  { return $value * 360000 }
    'mm'  { return $value * 36000 }
    'in'  { return $value * 914400 }
    'pt'  { return $value * 12700 }
    'px'  { return $value * 9525 }
  }
}

$presentation = officecli get $deckPath / --depth 0 --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'officecli 슬라이드 크기 확인 실패' }
$slideFormat = $presentation.data.results[0].format
$slideWidthEmu = Convert-OfficeCliLengthToEmu $slideFormat.slideWidth
if ($slideWidthEmu -le 0) { throw '유효하지 않은 슬라이드 가로 크기입니다.' }

$renderDpi = 150
$renderWidth = [int][Math]::Round(
  $slideWidthEmu * $renderDpi / 914400,
  0,
  [MidpointRounding]::ToEven
)
if ($renderWidth -lt 1) { throw '유효하지 않은 렌더 너비입니다.' }

$stats = officecli view $deckPath stats --json | ConvertFrom-Json
$slideCount = [int]$stats.data.slides
if ($slideCount -lt 1) { throw '렌더링할 슬라이드가 없습니다.' }

for ($slideNumber = 1; $slideNumber -le $slideCount; $slideNumber++) {
  $fileName = 'slide_{0:D3}.png' -f $slideNumber
  $outputPath = Join-Path $outputDirectory $fileName
  officecli view $deckPath screenshot --render html --page $slideNumber `
    --screenshot-width $renderWidth -o $outputPath --json
  if ($LASTEXITCODE -ne 0) { throw "officecli 슬라이드 렌더링 실패: $slideNumber" }
}
```

- 먼저 `officecli --version`으로 AionUi가 제공하는 실행 파일을 사용할 수 있는지 확인한다.
- 150 DPI는 슬라이드의 실제 가로 크기를 목표 픽셀로 환산하는 기준이다. OfficeCLI는 원본 비율로 높이를 자동 계산하고 최대 변이 1920px를 넘으면 두 변을 함께 축소한다. HTML 렌더러가 만든 PNG의 메타데이터 DPI는 96으로 남을 수 있다.
- HTML 렌더링은 PowerPoint와 폰트 대체, SmartArt, 차트, 효과 배치가 달라질 수 있다. 결과에 `officecli-html`을 사용했다고 명시한다.
- `officecli`도 사용할 수 없으면 텍스트만으로 내용을 확정하지 말고 AionUi 실행 환경 이상 또는 PowerPoint가 있는 PC에서의 확인 필요성을 사용자에게 알린다.
