export type UiTheme = 'light' | 'dark'

export const UI_THEME_STORAGE_KEY = 'mindnprogress-ui-theme'

function isUiTheme(value: string | null): value is UiTheme {
  return value === 'light' || value === 'dark'
}

export function initialUiTheme(): UiTheme {
  try {
    const savedTheme = localStorage.getItem(UI_THEME_STORAGE_KEY)
    if (isUiTheme(savedTheme)) return savedTheme
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  return import.meta.env.MODE === 'dark' ? 'dark' : 'light'
}

export function appliedUiTheme(): UiTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function applyUiTheme(theme: UiTheme, persist = false) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme

  let themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!themeColor) {
    themeColor = document.createElement('meta')
    themeColor.name = 'theme-color'
    document.head.append(themeColor)
  }
  themeColor.content = theme === 'dark' ? '#0f1118' : '#f8f7fb'

  if (!persist) return
  try {
    localStorage.setItem(UI_THEME_STORAGE_KEY, theme)
  } catch {
    // The active theme still applies even when persistence is unavailable.
  }
}

export function storedUiTheme(value: string | null): UiTheme | null {
  return isUiTheme(value) ? value : null
}
