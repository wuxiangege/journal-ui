import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { migrateLegacyStorageKeys } from './storage.js'

migrateLegacyStorageKeys()

createApp(App).use(router).mount('#app')
