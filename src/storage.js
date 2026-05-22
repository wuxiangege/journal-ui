const LEGACY_AUTH_KEY = 'rizhi-auth'
const LEGACY_THEME_KEY = 'rizhi-theme'

export const AUTH_KEY = 'journal-auth'
export const TOKEN_KEY = 'journal-token'
export const USER_KEY = 'journal-user'
export const THEME_KEY = 'journal-theme'

function migrateSessionKey(legacyKey, key) {
  const value = sessionStorage.getItem(legacyKey)
  if (value == null || sessionStorage.getItem(key) != null) return
  sessionStorage.setItem(key, value)
  sessionStorage.removeItem(legacyKey)
}

function migrateLocalKey(legacyKey, key) {
  const value = localStorage.getItem(legacyKey)
  if (value == null || localStorage.getItem(key) != null) return
  localStorage.setItem(key, value)
  localStorage.removeItem(legacyKey)
}

/** 将旧版 rizhi-* 存储键迁移到 journal-*，避免改名后丢失登录与主题 */
export function migrateLegacyStorageKeys() {
  migrateSessionKey(LEGACY_AUTH_KEY, AUTH_KEY)
  migrateLocalKey(LEGACY_THEME_KEY, THEME_KEY)
}
