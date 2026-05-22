import { createRouter, createWebHistory } from 'vue-router'
import { AUTH_KEY, TOKEN_KEY } from '../auth'
import LoginView from '../views/LoginView.vue'
import JournalApp from '../views/JournalApp.vue'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'diary', component: JournalApp, meta: { requiresAuth: true } },
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const ok = sessionStorage.getItem(AUTH_KEY) === '1' && !!sessionStorage.getItem(TOKEN_KEY)
  if (to.meta.public) {
    if (ok && to.name === 'login') return { name: 'diary' }
    return true
  }
  if (to.meta.requiresAuth && !ok) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})
