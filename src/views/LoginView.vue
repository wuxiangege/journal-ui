<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { login } from '../api/client'
import { AUTH_KEY, TOKEN_KEY, USER_KEY } from '../auth'

const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const showPassword = ref(false)
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  if (!username.value.trim()) {
    error.value = '请输入账号'
    return
  }
  busy.value = true
  try {
    const { token } = await login(username.value.trim(), password.value)
    sessionStorage.setItem(TOKEN_KEY, token)
    sessionStorage.setItem(USER_KEY, username.value.trim())
    sessionStorage.setItem(AUTH_KEY, '1')
    const r = route.query.redirect
    const redirect = typeof r === 'string' && r.startsWith('/') ? r : '/'
    router.replace(redirect)
  } catch (e) {
    error.value = e?.message || '登录失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <aside class="login-poem" aria-hidden="true">
      <div class="login-poem-couplet">
        <p class="login-poem-line">云深不知处，</p>
        <p class="login-poem-line">山水自有情。</p>
      </div>
      <div class="login-poem-couplet">
        <p class="login-poem-line">一纸一世界，</p>
        <p class="login-poem-line">静待故人归。</p>
      </div>
    </aside>

    <div class="login-card surface-card">
      <header class="login-head">
        <h1 class="login-title">日记管理系统</h1>
        <p class="login-sub">登录后可使用日记本</p>
      </header>

      <form class="login-form" @submit.prevent="submit">
        <label class="field">
          <span class="label">账号</span>
          <input
            v-model.trim="username"
            class="input"
            type="text"
            name="username"
            autocomplete="username"
            placeholder="邮箱或用户名"
          />
        </label>
        <label class="field">
          <span class="label">密码</span>
          <div class="password-wrap">
            <input
              v-model="password"
              class="input input--password"
              :type="showPassword ? 'text' : 'password'"
              name="password"
              autocomplete="current-password"
              placeholder="请输入密码"
            />
            <button
              type="button"
              class="password-toggle"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              @click="showPassword = !showPassword"
            >
              <svg
                v-if="showPassword"
                class="password-toggle-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-6.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                />
                <line
                  x1="1"
                  y1="1"
                  x2="23"
                  y2="23"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                />
              </svg>
              <svg v-else class="password-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="3"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                />
              </svg>
            </button>
          </div>
        </label>
        <p v-if="error" class="login-error" role="alert">{{ error }}</p>
        <button type="submit" class="btn-submit" :disabled="busy">
          <span v-if="busy" class="btn-spinner" aria-hidden="true"></span>
          <span>{{ busy ? '登录中…' : '登录' }}</span>
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  position: relative;
  overflow: hidden;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(16px, 4vw, 32px);
  box-sizing: border-box;
  background:
    linear-gradient(90deg, rgba(250, 247, 242, 0.54), rgba(40, 27, 20, 0.22)),
    url('../assets/time-ink-landscape.png') center / cover no-repeat;
}

.login-page::before {
  position: absolute;
  inset: 0;
  content: '';
  background:
    linear-gradient(90deg, rgba(255, 252, 243, 0.24), transparent 38%, rgba(20, 13, 9, 0.28)),
    radial-gradient(circle at 44% 52%, transparent 0 36%, rgba(18, 13, 9, 0.28) 78%);
  pointer-events: none;
}

.login-poem {
  position: absolute;
  z-index: 1;
  top: clamp(2.75rem, 8vh, 4.25rem);
  right: clamp(2rem, 8vw, 5rem);
  display: flex;
  flex-direction: row-reverse;
  align-items: flex-start;
  gap: clamp(1rem, 2vw, 1.55rem);
  pointer-events: none;
}

.login-poem-couplet {
  display: flex;
  flex-direction: row-reverse;
  gap: 0.48rem;
}

.login-poem-line {
  margin: 0;
  writing-mode: vertical-rl;
  text-orientation: upright;
  font-family: 'Noto Serif SC', serif;
  font-size: clamp(0.88rem, 1vw, 1rem);
  font-weight: 400;
  letter-spacing: 0.4em;
  line-height: 1.85;
  color: rgba(255, 244, 225, 0.7);
  text-shadow:
    0 0 16px rgba(24, 16, 10, 0.38),
    0 1px 2px rgba(24, 16, 10, 0.32);
}

.surface-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 400px;
  background: rgba(255, 254, 251, 0.86);
  border-radius: 16px;
  border: 1px solid rgba(255, 245, 223, 0.52);
  box-shadow: 0 22px 64px rgba(20, 13, 9, 0.28);
  backdrop-filter: blur(18px);
}

.login-head {
  padding: 1.35rem 1.5rem 1rem;
  border-bottom: 1px solid rgba(28, 25, 23, 0.08);
  text-align: center;
}

.login-title {
  margin: 0;
  font-family: 'Noto Serif SC', serif;
  font-size: 1.35rem;
  font-weight: 600;
  color: #1c1917;
  letter-spacing: 0.02em;
}

.login-sub {
  margin: 0.45rem 0 0;
  font-size: 0.8rem;
  color: #78716c;
  line-height: 1.45;
}

.login-form {
  padding: 1.25rem 1.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  text-align: left;
}

.label {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #a8a29e;
}

.input {
  border: 1px solid rgba(28, 25, 23, 0.12);
  border-radius: 10px;
  padding: 0.55rem 0.75rem;
  font-size: 0.95rem;
  background: #fff;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.input:focus {
  border-color: #ea580c;
  box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.12);
}

.password-wrap {
  position: relative;
}

.input--password {
  width: 100%;
  padding-right: 2.5rem;
}

.password-toggle {
  position: absolute;
  top: 50%;
  right: 0.45rem;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.2rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #a8a29e;
  cursor: pointer;
  transform: translateY(-50%);
  transition: color 0.15s;
}

.password-toggle:hover {
  color: #78716c;
}

.password-toggle-icon {
  width: 1.1rem;
  height: 1.1rem;
}

.login-error {
  margin: 0;
  font-size: 0.8rem;
  color: #b91c1c;
}

.btn-submit {
  margin-top: 0.25rem;
  border: none;
  border-radius: 10px;
  padding: 0.6rem 1rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: #fff;
  background: #c2410c;
  border: 1px solid #9a3412;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
}

.btn-submit:hover:not(:disabled) {
  background: #ea580c;
}

.btn-submit:active:not(:disabled) {
  transform: scale(0.99);
}

.btn-submit:disabled {
  opacity: 0.7;
  cursor: wait;
}

.btn-spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid rgba(255, 255, 255, 0.42);
  border-top-color: #fff;
  border-radius: 999px;
  animation: spin 0.75s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .login-poem {
    top: clamp(2rem, 6.5vh, 3.25rem);
    right: clamp(1.25rem, 4vw, 2rem);
    gap: 0.85rem;
  }

  .login-poem-line {
    font-size: 0.82rem;
    letter-spacing: 0.32em;
  }
}

@media (max-width: 560px) {
  .login-poem {
    display: none;
  }
}
</style>
