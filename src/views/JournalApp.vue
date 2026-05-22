<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { useRouter } from 'vue-router'
import { createJournalPost, deleteJournalPost, listJournalPosts, updateJournalPost } from '../api/client.js'
import { AUTH_KEY, TOKEN_KEY, USER_KEY } from '../auth.js'
import { THEME_KEY } from '../storage.js'

const router = useRouter()
const editorHost = ref(null)
const dateInput = ref(null)
let vditor = null
let vditorReady = false
let pendingEditorValue = null
let syncingEditor = false

function logout() {
  sessionStorage.removeItem(AUTH_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(USER_KEY)
  router.push('/login')
}

const currentUser = computed(() => sessionStorage.getItem(USER_KEY) ?? '')

const moods = [
  { id: 'great', label: '很好', emoji: '🌤', prompt: '今天状态很好，想把这份能量留给未来的自己：' },
  { id: 'good', label: '不错', emoji: '🙂', prompt: '今天整体不错，有几件小事值得记下来：' },
  { id: 'calm', label: '平静', emoji: '🌿', prompt: '今天心情平静，想记录一下让我安定的瞬间：' },
  { id: 'low', label: '低落', emoji: '🌧', prompt: '今天有些低落，先允许自己慢慢写下真实感受：' },
]

const allTags = ['生活', '工作', '随想', '旅行']

const journalPosts = ref([])
const loading = ref(true)
const saveTimers = new Map()
/** 丢弃过期的保存响应，避免并发 PUT 把 updatedAt 写回旧值 */
const saveGenerations = new Map()

/** 列表每页条数（纯前端分页） */
const LIST_PAGE_SIZE = 3

const selectedId = ref(journalPosts.value[0]?.id ?? null)
const searchQuery = ref('')
const tagFilter = ref(null)
const moodFilter = ref('all')
const dateFilter = ref('all')
const sidebarCollapsed = ref(false)
const activePanel = ref('diary')
const theme = ref(localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light')
const isDarkTheme = computed(() => theme.value === 'dark')

watch(theme, (value) => {
  localStorage.setItem(THEME_KEY, value)
})

function toggleTheme() {
  theme.value = isDarkTheme.value ? 'light' : 'dark'
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

function collapseSidebar() {
  sidebarCollapsed.value = true
}

function openStatsPanel() {
  activePanel.value = 'stats'
}

const filteredJournalPosts = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const now = new Date()
  return journalPosts.value
    .filter((e) => {
      if (tagFilter.value && !e.tags.includes(tagFilter.value)) return false
      if (moodFilter.value !== 'all' && e.mood !== moodFilter.value) return false
      if (dateFilter.value !== 'all') {
        const postTime = new Date(`${e.date}T00:00:00`).getTime()
        const days = dateFilter.value === 'week' ? 7 : 30
        const from = new Date(now)
        from.setDate(now.getDate() - days + 1)
        from.setHours(0, 0, 0, 0)
        if (postTime < from.getTime()) return false
      }
      if (!q) return true
      const moodText = moodLabel(e.mood).toLowerCase()
      return (
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)) ||
        moodText.includes(q)
      )
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.date.localeCompare(a.date)
    })
})

const listPage = ref(1)

const totalListPages = computed(() =>
  Math.max(1, Math.ceil(filteredJournalPosts.value.length / LIST_PAGE_SIZE)),
)

const pagedFilteredJournalPosts = computed(() => {
  const list = filteredJournalPosts.value
  const start = (listPage.value - 1) * LIST_PAGE_SIZE
  return list.slice(start, start + LIST_PAGE_SIZE)
})

/** 页码按钮：总数较少时全展示，多页时缩略 */
const pagerSlots = computed(() => {
  const cur = listPage.value
  const total = totalListPages.value
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const set = new Set([1, total, cur, cur - 1, cur + 1, cur - 2, cur + 2])
  const sorted = [...set].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('…')
    out.push(sorted[i])
  }
  return out
})

function goListPage(p) {
  listPage.value = Math.min(totalListPages.value, Math.max(1, p))
}

function prevListPage() {
  goListPage(listPage.value - 1)
}

function nextListPage() {
  goListPage(listPage.value + 1)
}

watch([searchQuery, tagFilter, moodFilter, dateFilter], () => {
  listPage.value = 1
})

watch(
  () => filteredJournalPosts.value.length,
  () => {
    if (listPage.value > totalListPages.value) {
      listPage.value = totalListPages.value
    }
  },
)

const current = computed(() => journalPosts.value.find((e) => e.id === selectedId.value) ?? null)

const currentMood = computed(() => moods.find((m) => m.id === current.value?.mood) ?? moods[2])

const todayPrompt = computed(() => {
  if (!current.value) return ''
  return `${currentMood.value.prompt}\n\n## 今天最想记住的是\n\n- 一个细节：\n- 明天可以试着：`
})

function setEditorValue(value) {
  const next = value || ''
  if (!vditor || !vditorReady) {
    pendingEditorValue = next
    return
  }
  syncingEditor = true
  vditor.setValue(next, true)
  window.requestAnimationFrame(() => {
    syncingEditor = false
  })
}

async function loadJournalPosts() {
  loading.value = true
  try {
    const res = await listJournalPosts({ pageSize: 500 })
    journalPosts.value = res?.list ?? []
    if (!selectedId.value && journalPosts.value.length) {
      selectedId.value = journalPosts.value[0].id
    }
  } catch (e) {
    console.error('加载日记失败', e)
  } finally {
    loading.value = false
  }
}

function scheduleSave(post) {
  if (!post?.id) return
  const prev = saveTimers.get(post.id)
  if (prev) clearTimeout(prev)
  saveTimers.set(
    post.id,
    window.setTimeout(() => persistJournalPost(post), 600),
  )
}

function flushPendingSave(post) {
  if (!post?.id) return
  const prev = saveTimers.get(post.id)
  if (prev) {
    clearTimeout(prev)
    saveTimers.delete(post.id)
  }
}

function syncEditorContentToCurrent() {
  if (!current.value || !vditor || !vditorReady) return
  const value = vditor.getValue()
  if (current.value.content !== value) {
    current.value.content = value
  }
}

async function saveCurrentJournalPost() {
  if (activePanel.value !== 'diary' || !current.value) return
  syncEditorContentToCurrent()
  syncSmartTitle()
  bumpUpdatedAt()
  flushPendingSave(current.value)
  await persistJournalPost(current.value)
}

function handleGlobalKeydown(event) {
  const isSaveKey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's'
  if (!isSaveKey || activePanel.value !== 'diary' || !current.value) return
  event.preventDefault()
  void saveCurrentJournalPost()
}

async function persistJournalPost(post) {
  if (!post?.id) return
  const generation = (saveGenerations.get(post.id) ?? 0) + 1
  saveGenerations.set(post.id, generation)
  try {
    const updated = await updateJournalPost(post.id, {
      title: post.title,
      content: post.content,
      date: post.date,
      mood: post.mood,
      tags: post.tags,
      pinned: post.pinned,
    })
    if (saveGenerations.get(post.id) !== generation) return
    const idx = journalPosts.value.findIndex((e) => e.id === post.id)
    if (idx >= 0) {
      journalPosts.value[idx] = {
        ...journalPosts.value[idx],
        ...updated,
        updatedAt: updated.updatedAt ?? journalPosts.value[idx].updatedAt,
      }
    }
  } catch (e) {
    if (saveGenerations.get(post.id) === generation) {
      console.error('保存失败', e)
    }
  }
}

onMounted(async () => {
  await loadJournalPosts()
  if (!editorHost.value) return
  vditor = new Vditor(editorHost.value, {
    cache: { enable: false },
    height: '100%',
    minHeight: 260,
    mode: 'ir',
    placeholder: todayPrompt.value,
    value: current.value?.content ?? '',
    toolbarConfig: {
      pin: true,
    },
    after() {
      vditorReady = true
      if (pendingEditorValue !== null) {
        setEditorValue(pendingEditorValue)
        pendingEditorValue = null
      }
    },
    input(value) {
      if (syncingEditor || !current.value || current.value.content === value) return
      current.value.content = value
      handleContentInput()
    },
    blur() {
      syncSmartTitle()
    },
  })
  window.addEventListener('keydown', handleGlobalKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown, true)
  for (const timer of saveTimers.values()) clearTimeout(timer)
  saveTimers.clear()
  saveGenerations.clear()
  vditor?.destroy()
  vditor = null
  vditorReady = false
  pendingEditorValue = null
})

watch(
  () => current.value?.id,
  async () => {
    await nextTick()
    setEditorValue(current.value?.content ?? '')
  },
)

const monthJournalPosts = computed(() => {
  const now = new Date()
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return journalPosts.value.filter((post) => post.date.startsWith(prefix))
})

const totalWords = computed(() => journalPosts.value.reduce((sum, post) => sum + wordCount(post), 0))

const averageWords = computed(() => {
  if (!journalPosts.value.length) return 0
  return Math.round(totalWords.value / journalPosts.value.length)
})

const topTag = computed(() => {
  const counts = new Map()
  for (const post of journalPosts.value) {
    for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '暂无'
})

function selectJournalPost(id) {
  selectedId.value = id
  activePanel.value = 'diary'
}

async function newJournalPost() {
  const today = new Date()
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const d = String(today.getDate()).padStart(2, '0')
  try {
    const created = await createJournalPost({
      title: `${m}-${d} 今日记录`,
      content: '',
      date: `${y}-${m}-${d}`,
      mood: 'calm',
      tags: [],
      pinned: false,
    })
    journalPosts.value.unshift(created)
    selectedId.value = created.id
    activePanel.value = 'diary'
    listPage.value = 1
  } catch (e) {
    console.error('新建失败', e)
  }
}

async function removeCurrent() {
  if (!current.value) return
  const ok = window.confirm('确定删除这篇日记吗？')
  if (!ok) return
  const id = current.value.id
  try {
    await deleteJournalPost(id)
    const idx = journalPosts.value.findIndex((e) => e.id === id)
    journalPosts.value.splice(idx, 1)
    if (listPage.value > totalListPages.value) {
      listPage.value = totalListPages.value
    }
    selectedId.value = filteredJournalPosts.value[0]?.id ?? null
  } catch (e) {
    console.error('删除失败', e)
  }
}

function togglePin() {
  if (!current.value) return
  current.value.pinned = !current.value.pinned
  touchUpdated()
}

function setMood(id) {
  if (!current.value) return
  current.value.mood = id
  touchUpdated()
}

function handleContentInput() {
  syncSmartTitle()
  touchUpdated()
}

function normalizeTitle() {
  if (!current.value) return
  const next = generateTitle(current.value)
  if (!current.value.title.trim()) current.value.title = next
  touchUpdated()
}

function syncSmartTitle() {
  if (!current.value) return
  const title = current.value.title.trim()
  if (title && !title.startsWith('未命名') && !/^\d{2}-\d{2} 今日记录$/.test(title)) return
  current.value.title = generateTitle(current.value)
}

function generateTitle(post) {
  const line = post.content
    .split('\n')
    .map((text) => text.trim().replace(/^[-#>*\s]+/, ''))
    .find(Boolean)
  if (line) {
    return line.replace(/[。！？!?，,；;：:]$/, '').slice(0, 22)
  }
  return `${post.date.slice(5)} ${moodLabel(post.mood) || '今日'}日记`
}

function toggleTagOnJournalPost(tag) {
  if (!current.value) return
  const set = new Set(current.value.tags)
  if (set.has(tag)) set.delete(tag)
  else set.add(tag)
  current.value.tags = [...set]
  touchUpdated()
}

function formatUpdatedAt(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function bumpUpdatedAt() {
  if (!current.value) return
  current.value.updatedAt = formatUpdatedAt()
}

function touchUpdated() {
  bumpUpdatedAt()
  scheduleSave(current.value)
}

function moodLabel(id) {
  return moods.find((m) => m.id === id)?.label ?? ''
}

function moodEmoji(id) {
  return moods.find((m) => m.id === id)?.emoji ?? ''
}

function formatDateSlash(date) {
  return date ? date.replaceAll('-', '/') : ''
}

function openDatePicker() {
  const input = dateInput.value
  if (!input) return
  if (typeof input.showPicker === 'function') {
    input.showPicker()
    return
  }
  input.focus()
  input.click()
}

function wordCount(post) {
  return post.content.replace(/\s+/g, '').length
}
</script>

<template>
  <div class="shell" :class="{ 'shell--collapsed': sidebarCollapsed, 'theme-dark': isDarkTheme }">
    <aside class="rail" aria-hidden="false">
      <div class="rail-brand" aria-label="日记">
        <div class="rail-seal" aria-hidden="true">
          <img class="rail-seal-img" src="../assets/diary-seal.png" alt="" />
        </div>
      </div>
      <button
        type="button"
        class="rail-toggle rail-icon-slot"
        :aria-expanded="!sidebarCollapsed"
        aria-controls="diary-sidebar"
        :aria-label="sidebarCollapsed ? '展开日记列表' : '收起日记列表'"
        @click="toggleSidebar"
      >
        <svg v-if="sidebarCollapsed" class="rail-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect
            x="4"
            y="5"
            width="16"
            height="14"
            rx="2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          />
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M10 5v14M13 9l3 3-3 3"
          />
        </svg>
        <svg v-else class="rail-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect
            x="4"
            y="5"
            width="16"
            height="14"
            rx="2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          />
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M10 5v14M16 9l-3 3 3 3"
          />
        </svg>
      </button>
      <div class="rail-icon-slots" aria-label="预留功能入口">
        <button
          type="button"
          class="rail-icon-slot rail-theme"
          :title="isDarkTheme ? '切换到白天模式' : '切换到暗黑模式'"
          :aria-label="isDarkTheme ? '切换到白天模式' : '切换到暗黑模式'"
          @click="toggleTheme"
        >
          <span class="rail-theme-icon" aria-hidden="true">{{ isDarkTheme ? '☀' : '☾' }}</span>
          <span class="rail-theme-text">{{ isDarkTheme ? '白天' : '暗黑' }}</span>
        </button>
        <button
          type="button"
          class="rail-icon-slot rail-stats"
          :class="{ on: activePanel === 'stats' }"
          title="查看统计"
          aria-label="查看统计"
          @click="openStatsPanel"
        >
          <svg class="rail-stats-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M5 19V9m7 10V5m7 14v-7"
            />
          </svg>
          <span class="rail-theme-text">统计</span>
        </button>
        <button
          v-for="slot in 2"
          :key="slot"
          type="button"
          class="rail-icon-slot"
          :aria-label="`预留功能入口 ${slot + 3}`"
        >
          <span class="rail-slot-mark" aria-hidden="true"></span>
        </button>
      </div>
      <div class="rail-spacer" />
      <p v-if="currentUser" class="rail-user" :title="currentUser">{{ currentUser }}</p>
      <button
        type="button"
        class="rail-logout"
        title="退出登录"
        aria-label="退出登录"
        @click="logout"
      >
        <span class="rail-logout-text" aria-hidden="true">
          <span class="rail-logout-col">登录</span>
          <span class="rail-logout-col">退出</span>
        </span>
      </button>
    </aside>

    <aside
      id="diary-sidebar"
      class="sidebar"
      :aria-hidden="sidebarCollapsed"
    >
      <div class="sidebar-panel surface-card">
        <header class="sidebar-head surface-card__head">
          <div class="sidebar-head-main">
            <button
              type="button"
              class="sidebar-collapse-btn"
              title="收起侧栏"
              aria-label="收起侧栏"
              @click="collapseSidebar"
            >
              <svg class="sidebar-collapse-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15 6l-6 6 6 6"
                />
              </svg>
            </button>
            <div class="brand-wrap">
              <h1 class="brand">日记本</h1>
            </div>
          </div>
          <div class="sidebar-head-actions">
            <button type="button" class="btn primary" @click="newJournalPost">＋ 新建</button>
          </div>
        </header>

        <div class="search-wrap">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input
            v-model="searchQuery"
            class="search"
            type="search"
            placeholder="全文 / 标签 / 心情搜索…"
            autocomplete="off"
          />
        </div>

        <div class="filter-grid" aria-label="高级筛选">
          <label class="filter-field">
            <span>心情</span>
            <select v-model="moodFilter">
              <option value="all">全部心情</option>
              <option v-for="m in moods" :key="m.id" :value="m.id">{{ m.emoji }} {{ m.label }}</option>
            </select>
          </label>
          <label class="filter-field">
            <span>时间</span>
            <select v-model="dateFilter">
              <option value="all">全部时间</option>
              <option value="week">近 7 天</option>
              <option value="month">近 30 天</option>
            </select>
          </label>
        </div>

        <div class="tag-bar" role="group" aria-label="按标签筛选">
          <button
            type="button"
            class="chip"
            :class="{ on: tagFilter === null }"
            @click="tagFilter = null"
          >
            全部
          </button>
          <button
            v-for="t in allTags"
            :key="t"
            type="button"
            class="chip"
            :class="{ on: tagFilter === t }"
            @click="tagFilter = tagFilter === t ? null : t"
          >
            {{ t }}
          </button>
        </div>

        <ul class="journal-post-list">
          <li v-if="filteredJournalPosts.length === 0" class="empty-list">没有匹配的日记</li>
          <li v-for="post in pagedFilteredJournalPosts" :key="post.id">
            <button
              type="button"
              class="journal-post-card"
              :class="{ active: post.id === selectedId }"
              @click="selectJournalPost(post.id)"
            >
              <div class="journal-post-top">
                <span v-if="post.pinned" class="pin" title="置顶">📌</span>
                <span class="journal-post-title">{{ post.title }}</span>
              </div>
              <div class="journal-post-meta">
                <span>{{ post.date }}</span>
                <span class="dot">·</span>
                <span>{{ moodEmoji(post.mood) }} {{ moodLabel(post.mood) }}</span>
                <span class="dot">·</span>
                <span>{{ wordCount(post) }} 字</span>
              </div>
              <p class="journal-post-snippet">{{ post.content.replace(/\s+/g, ' ').slice(0, 56) }}{{ post.content.length > 56 ? '…' : '' }}</p>
              <div class="journal-post-extra">
                <span>编辑 {{ post.updatedAt }}</span>
              </div>
              <div v-if="post.tags.length" class="journal-post-tags">
                <span v-for="t in post.tags" :key="t" class="mini-tag">{{ t }}</span>
              </div>
            </button>
          </li>
        </ul>

        <footer class="sidebar-foot card-foot">
          <div class="sidebar-foot-meta">
            <span v-if="searchQuery.trim() || tagFilter" class="sidebar-foot-filter">
              显示 {{ filteredJournalPosts.length }} 条
            </span>
          </div>
          <div v-if="filteredJournalPosts.length > 0" class="sidebar-foot-pager" role="navigation" aria-label="列表分页">
            <button
              type="button"
              class="pager-nav"
              :disabled="listPage <= 1"
              @click="prevListPage"
            >
              上一页
            </button>
            <div class="pager-nums">
              <template v-for="(slot, idx) in pagerSlots" :key="'pg-' + idx">
                <span v-if="slot === '…'" class="pager-ellipsis" aria-hidden="true">…</span>
                <button
                  v-else
                  type="button"
                  class="pager-num"
                  :class="{ on: slot === listPage }"
                  @click="goListPage(slot)"
                >
                  {{ slot }}
                </button>
              </template>
            </div>
            <button
              type="button"
              class="pager-nav"
              :disabled="listPage >= totalListPages"
              @click="nextListPage"
            >
              下一页
            </button>
            <span class="pager-total" aria-live="polite">共 {{ totalListPages }} 页</span>
          </div>
        </footer>
      </div>
    </aside>

    <main class="main">
      <section
        v-if="activePanel === 'stats'"
        class="stats-page surface-card"
        aria-label="日记统计"
      >
        <header class="stats-page-head surface-card__head">
          <div>
            <p class="stats-eyebrow">统计</p>
            <h2 class="stats-title">日记概览</h2>
          </div>
          <button type="button" class="btn ghost" @click="activePanel = 'diary'">返回编辑</button>
        </header>
        <div class="stats-page-body">
          <section class="stats-strip stats-strip--page" aria-label="日记统计">
            <div class="stat-card">
              <span>本月</span>
              <strong>{{ monthJournalPosts.length }}</strong>
              <small>篇日记</small>
            </div>
            <div class="stat-card">
              <span>平均</span>
              <strong>{{ averageWords }}</strong>
              <small>字 / 篇</small>
            </div>
            <div class="stat-card">
              <span>常用标签</span>
              <strong>{{ topTag }}</strong>
              <small>记录偏好</small>
            </div>
          </section>
        </div>
      </section>
      <template v-if="current">
        <div v-show="activePanel === 'diary'" class="editor-card surface-card">
          <header class="main-toolbar surface-card__head">
            <div class="toolbar-left">
              <input
                v-model="current.title"
                class="title-input"
                type="text"
                maxlength="80"
                @input="touchUpdated"
                @blur="normalizeTitle"
              />
              <span class="title-updated">上次编辑 {{ current.updatedAt }}</span>
            </div>
            <div class="toolbar-right">
              <button type="button" class="btn danger" @click="removeCurrent">谨慎删除</button>
            </div>
          </header>

          <div class="meta-row" aria-label="日记编辑信息">
            <label class="edit-date-control" @click="openDatePicker">
              <input
                ref="dateInput"
                v-model="current.date"
                class="date-native"
                type="date"
                @change="touchUpdated"
              />
              <span class="date-display">{{ formatDateSlash(current.date) }} 📅</span>
            </label>
            <div class="meta-group">
              <span class="meta-label">心情</span>
              <div class="segmented-row">
                <button
                  v-for="m in moods"
                  :key="m.id"
                  type="button"
                  class="mood"
                  :class="{ on: current.mood === m.id }"
                  @click="setMood(m.id)"
                >
                  <span class="m-emoji">{{ m.emoji }}</span>
                  {{ m.label }}
                </button>
              </div>
            </div>
            <div class="meta-group">
              <span class="meta-label">标签</span>
              <div class="segmented-row">
                <button
                  v-for="t in allTags"
                  :key="t"
                  type="button"
                  class="mood tag-toggle"
                  :class="{ on: current.tags.includes(t) }"
                  @click="toggleTagOnJournalPost(t)"
                >
                  {{ t }}
                </button>
              </div>
            </div>
          </div>

          <div ref="editorHost" class="vditor-host" />
        </div>
      </template>

      <div v-else-if="activePanel === 'diary'" class="empty-main surface-card">
        <p class="empty-title">还没有日记</p>
        <p class="empty-desc">点击左侧「新建」写一篇，或调整筛选条件。</p>
        <button type="button" class="btn primary" @click="newJournalPost">＋ 新建第一篇</button>
      </div>
    </main>
  </div>
</template>

<style scoped>
.shell {
  /* 页边距：四边与「顶」一致 */
  --layout-pad: clamp(16px, 2.5vw, 24px);
  --layout-gap: clamp(1px, 0.2vw, 2px);
  --card-pad-x: 1.25rem;
  --panel-foot-gap: 0.7rem;
  --editor-edge-gap: 1.1rem;
  --editor-edge-inset: 0.35rem;
  --surface-card-radius: 10px;
  --editor-inner-radius: 14px;
  --editor-tail-radius: max(4px, calc(var(--surface-card-radius) - var(--editor-edge-inset)));
  --editor-frame-border: rgba(28, 25, 23, 0.1);
  --panel-foot-min-height: 3.35rem;

  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 72px minmax(260px, 300px) 1fr;
  grid-template-rows: minmax(0, 1fr);
  align-items: stretch;
  column-gap: var(--layout-gap);
  row-gap: 0;
  max-width: 1440px;
  margin: 0 auto;
  padding: var(--layout-pad);
  background: linear-gradient(165deg, #faf7f2 0%, #ebe4d8 100%);
  box-shadow: 0 0 0 1px rgba(28, 25, 23, 0.06);
  transition: grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    column-gap 0.25s ease;
}

.shell.theme-dark {
  color-scheme: dark;
  color: #e7e5e4;
  background: linear-gradient(165deg, #171412 0%, #2b211c 100%);
  box-shadow: 0 0 0 1px rgba(255, 247, 237, 0.08);
}

.shell--collapsed {
  grid-template-columns: 72px 0px 1fr;
  column-gap: 0;
}

.shell--collapsed .main {
  padding-left: var(--layout-gap);
}

.surface-card {
  background: #fffefb;
  border-radius: var(--surface-card-radius);
  border: 1px solid rgba(28, 25, 23, 0.08);
  box-shadow: 0 12px 40px rgba(28, 25, 23, 0.06);
}

.theme-dark .surface-card {
  background: #221c18;
  border-color: rgba(255, 247, 237, 0.1);
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.28);
}

.theme-dark .rail {
  background: rgba(34, 28, 24, 0.94);
  color: #d6d3d1;
  border-color: rgba(255, 247, 237, 0.1);
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.22);
}

.theme-dark .rail-toggle,
.theme-dark .rail-theme,
.theme-dark .rail-logout {
  color: #a8a29e;
}

.theme-dark .rail-theme,
.theme-dark .rail-logout,
.theme-dark .rail-kpi {
  background: rgba(41, 37, 36, 0.86);
  box-shadow: inset 0 0 0 1px rgba(255, 247, 237, 0.08);
}

.theme-dark .rail-toggle:hover,
.theme-dark .rail-theme:hover,
.theme-dark .rail-logout:hover {
  color: #fed7aa;
  background: rgba(249, 115, 22, 0.13);
}

.theme-dark .rail-kpi {
  color: #f5f5f4;
}

.theme-dark .rail-kpi span {
  color: #a8a29e;
}

.theme-dark .rail-icon-slot {
  border-color: rgba(255, 247, 237, 0.16);
  background: rgba(28, 25, 23, 0.24);
}

.theme-dark .rail-slot-mark {
  background: rgba(255, 247, 237, 0.08);
}

.theme-dark .rail-icon-slot:hover {
  border-color: rgba(251, 146, 60, 0.36);
  background: rgba(249, 115, 22, 0.1);
}

.theme-dark .rail-icon-slot.on {
  border-color: rgba(251, 146, 60, 0.45);
  background: rgba(249, 115, 22, 0.16);
  color: #fed7aa;
}

.theme-dark .rail-seal {
  background: rgba(67, 20, 7, 0.34);
  box-shadow:
    0 0 0 1px rgba(251, 146, 60, 0.16),
    0 6px 16px rgba(0, 0, 0, 0.2);
}

.theme-dark .rail-brand {
  border-bottom-color: rgba(255, 247, 237, 0.1);
}

.surface-card__head {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  row-gap: 0.5rem;
  min-height: 4.375rem;
  padding: 0.875rem var(--card-pad-x);
  border-bottom: 1px solid rgba(28, 25, 23, 0.08);
  flex-shrink: 0;
}

.rail {
  background: rgba(255, 254, 251, 0.92);
  color: #57534e;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 0 0.65rem;
  gap: 0.25rem;
  font-family: 'Noto Serif SC', serif;
  min-height: 0;
  height: 100%;
  border-radius: 12px;
  border: 1px solid rgba(28, 25, 23, 0.08);
  box-shadow: 0 10px 30px rgba(28, 25, 23, 0.06);
  box-sizing: border-box;
  overflow: hidden;
  align-self: stretch;
}

.rail-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 4.375rem;
  padding: 0;
  border-bottom: 1px solid rgba(28, 25, 23, 0.08);
  flex-shrink: 0;
  box-sizing: border-box;
}

.rail-spacer {
  flex: 1;
  min-height: 1rem;
}

.rail-user {
  flex-shrink: 0;
  width: 3.35rem;
  margin: 0 auto 0.35rem;
  padding: 0 0.25rem;
  font-size: 0.58rem;
  line-height: 1.25;
  text-align: center;
  color: #a8a29e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-logout {
  flex-shrink: 0;
  width: 3.35rem;
  height: 3.1rem;
  margin: 1.8rem auto -0.15rem;
  padding: 0;
  border: none;
  background: rgba(250, 250, 249, 0.86);
  color: #78716c;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.65rem;
  line-height: 1.2;
  transition: color 0.15s, background 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}

.rail-logout:hover {
  color: #9a3412;
  background: #fff7ed;
}

.rail-theme {
  flex-shrink: 0;
  width: 3.35rem;
  height: 3.35rem;
  margin: 0;
  padding: 0.35rem 0.2rem;
  border-radius: 8px;
  background: rgba(250, 250, 249, 0.86);
  color: #78716c;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.12rem;
  font-family: inherit;
  transition: color 0.15s, background 0.15s;
}

.rail-theme:hover {
  color: #9a3412;
  background: #fff7ed;
}

.rail-theme-icon {
  font-size: 0.95rem;
  line-height: 1;
}

.rail-theme-text {
  font-size: 0.62rem;
  line-height: 1.1;
}

.rail-stats {
  flex-direction: column;
  gap: 0.18rem;
}

.rail-stats-icon {
  width: 1.25rem;
  height: 1.25rem;
}

.rail-icon-slot.on {
  border-color: rgba(234, 88, 12, 0.45);
  background: rgba(234, 88, 12, 0.12);
  color: #9a3412;
}

.rail-logout-text {
  display: grid;
  grid-template-columns: repeat(2, max-content);
  column-gap: 0.04rem;
  align-items: center;
  justify-items: center;
  width: max-content;
  height: 100%;
}

.rail-logout-col {
  writing-mode: vertical-rl;
  text-orientation: upright;
  letter-spacing: 0;
}

.rail-logout-col:first-child {
  grid-column: 1;
}

.rail-logout-col:last-child {
  grid-column: 2;
}

.rail-toggle {
  width: 100%;
  margin: 0;
  padding: 0.35rem 0 0.65rem;
  border: none;
  background: transparent;
  color: #a8a29e;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
}

.rail-toggle:hover {
  color: #9a3412;
  background: rgba(234, 88, 12, 0.08);
}

.rail-toggle-icon {
  width: 20px;
  height: 20px;
  display: block;
}

.rail-kpi {
  width: 3.35rem;
  min-height: 2.45rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.02rem;
  border-radius: 9px;
  background: #fafaf9;
  color: #292524;
  box-shadow: inset 0 0 0 1px rgba(28, 25, 23, 0.08);
  flex-shrink: 0;
}

.rail-kpi strong {
  font-size: 1rem;
  line-height: 1;
}

.rail-kpi span {
  font-size: 0.58rem;
  color: #78716c;
}

.rail-icon-slots {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.9rem;
  padding: 0.8rem 0 0;
  flex-shrink: 0;
}

.rail-icon-slot {
  width: 3.35rem;
  height: 3.35rem;
  padding: 0;
  border: 1px dashed rgba(28, 25, 23, 0.16);
  border-radius: 8px;
  background: transparent;
  color: #a8a29e;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, background 0.15s;
}

.rail-slot-mark {
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 5px;
  background: rgba(28, 25, 23, 0.06);
}

.rail-icon-slot:hover {
  border-color: rgba(234, 88, 12, 0.34);
  background: rgba(234, 88, 12, 0.06);
}

.rail-seal {
  width: 3.2rem;
  height: 3.2rem;
  overflow: hidden;
  border-radius: 4px;
  background: #fff7ed;
  box-shadow:
    0 0 0 1px rgba(154, 52, 18, 0.14),
    0 6px 16px rgba(120, 53, 15, 0.12);
}

.rail-seal-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  opacity: 1;
  transition: opacity 0.22s ease;
  padding: 0;
  box-sizing: border-box;
  align-self: stretch;
}

.shell--collapsed .sidebar {
  opacity: 0;
  pointer-events: none;
}

.sidebar-panel {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-head-main {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  flex: 1;
}

.brand-wrap {
  min-width: 0;
}

.sidebar-head-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.btn-tiny {
  padding: 0.35rem 0.55rem;
  font-size: 0.75rem;
}

.sidebar-collapse-btn {
  flex-shrink: 0;
  padding: 0.35rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #a8a29e;
  line-height: 0;
  transition: color 0.15s, background 0.15s;
}

.sidebar-collapse-btn:hover {
  color: #57534e;
  background: rgba(28, 25, 23, 0.06);
}

.sidebar-collapse-icon {
  width: 18px;
  height: 18px;
  display: block;
}

.brand {
  margin: 0;
  font-family: 'Noto Serif SC', serif;
  font-size: 1.35rem;
  font-weight: 600;
  color: #1c1917;
  letter-spacing: 0.02em;
}

.btn {
  border: 1px solid rgba(28, 25, 23, 0.12);
  background: #fff;
  border-radius: 10px;
  padding: 0.45rem 0.85rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #44403c;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
}

.btn:active {
  transform: scale(0.98);
}

.btn.primary {
  background: #c2410c;
  border-color: #9a3412;
  color: #fff;
}

.btn.primary:hover {
  background: #ea580c;
  border-color: #c2410c;
}

.btn.ghost {
  background: transparent;
}

.btn.ghost.on {
  background: #fff7ed;
  border-color: #fdba74;
  color: #9a3412;
}

.btn.danger {
  color: #b91c1c;
  border-color: rgba(185, 28, 28, 0.35);
  background: #fff;
}

.btn.danger:hover {
  background: #fef2f2;
}

.search-wrap {
  margin: 0.75rem var(--card-pad-x) 0.6rem;
  position: relative;
  flex-shrink: 0;
}

.search-icon {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 1rem;
  color: #a8a29e;
  pointer-events: none;
}

.search {
  width: 100%;
  border: 1px solid rgba(28, 25, 23, 0.1);
  border-radius: 10px;
  padding: 0.55rem 0.75rem 0.55rem 2rem;
  background: rgba(255, 255, 255, 0.9);
  outline: none;
}

.search:focus {
  border-color: #ea580c;
  box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.15);
}

.filter-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.45rem;
  padding: 0 var(--card-pad-x) 0.65rem;
  flex-shrink: 0;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.filter-field span {
  font-size: 0.65rem;
  font-weight: 700;
  color: #a8a29e;
  letter-spacing: 0.04em;
}

.filter-field select {
  width: 100%;
  border: 1px solid rgba(28, 25, 23, 0.1);
  border-radius: 9px;
  padding: 0.42rem 0.5rem;
  background: #fff;
  color: #57534e;
  font-size: 0.75rem;
  outline: none;
}

.filter-field select:focus {
  border-color: #ea580c;
  box-shadow: 0 0 0 3px rgba(234, 88, 12, 0.12);
}

.tag-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0 var(--card-pad-x) 0.65rem;
  flex-shrink: 0;
}

.chip {
  border: 1px solid rgba(28, 25, 23, 0.1);
  background: rgba(255, 255, 255, 0.6);
  border-radius: 999px;
  padding: 0.2rem 0.65rem;
  font-size: 0.75rem;
  color: #57534e;
}

.chip.on {
  background: #1c1917;
  color: #fafaf9;
  border-color: #1c1917;
}

.journal-post-list {
  list-style: none;
  margin: 0;
  padding: 0 calc(var(--card-pad-x) - 2px) 0.35rem;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.card-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.55rem var(--card-pad-x) 0.65rem;
  border-top: 1px dashed rgba(28, 25, 23, 0.1);
  font-size: 0.7rem;
  color: #78716c;
}

.sidebar-foot-filter {
  color: #a8a29e;
}

.sidebar-foot {
  margin-top: auto;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-end;
  min-height: var(--panel-foot-min-height);
  box-sizing: border-box;
  border-top: none;
}

.sidebar-foot::before {
  content: '';
  display: block;
  flex-shrink: 0;
  height: var(--panel-foot-gap);
  border-bottom: 1px dashed rgba(28, 25, 23, 0.1);
  margin-bottom: 0.45rem;
}

.sidebar-foot-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.sidebar-foot-pager {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
  gap: 0.35rem;
  width: 100%;
  min-width: 0;
}

.pager-nav {
  flex: 0 0 auto;
  white-space: nowrap;
  border: 1px solid rgba(28, 25, 23, 0.12);
  background: #fff;
  border-radius: 8px;
  padding: 0.25rem 0.5rem;
  font-size: 0.68rem;
  font-weight: 600;
  color: #44403c;
  transition: opacity 0.15s, border-color 0.15s, background 0.15s;
}

.pager-nav:hover:not(:disabled) {
  border-color: rgba(234, 88, 12, 0.45);
  background: #fff7ed;
}

.pager-nav:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.pager-nums {
  display: inline-flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
}

.pager-nums::-webkit-scrollbar {
  height: 4px;
}

.pager-nums::-webkit-scrollbar-thumb {
  background: rgba(28, 25, 23, 0.15);
  border-radius: 4px;
}

.pager-num {
  flex: 0 0 auto;
  min-width: 1.65rem;
  padding: 0.22rem 0.35rem;
  border: 1px solid rgba(28, 25, 23, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.75);
  font-size: 0.68rem;
  font-weight: 600;
  color: #57534e;
  line-height: 1.2;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.pager-num:hover {
  border-color: rgba(234, 88, 12, 0.4);
}

.pager-num.on {
  background: #1c1917;
  border-color: #1c1917;
  color: #fafaf9;
}

.pager-ellipsis {
  flex: 0 0 auto;
  padding: 0 0.1rem;
  font-size: 0.68rem;
  color: #a8a29e;
  user-select: none;
  line-height: 1.2;
}

.pager-total {
  flex: 0 0 auto;
  font-size: 0.68rem;
  color: #78716c;
  white-space: nowrap;
}

.empty-list {
  padding: 1.5rem 1rem;
  text-align: center;
  color: #a8a29e;
  font-size: 0.875rem;
}

.journal-post-card {
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 0.75rem 0.85rem;
  margin-bottom: 0.35rem;
  background: rgba(250, 250, 249, 0.85);
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.journal-post-card:hover {
  background: #fafaf9;
  border-color: rgba(28, 25, 23, 0.08);
}

.journal-post-card.active {
  background: #fff;
  border-color: #ea580c;
  box-shadow: 0 4px 14px rgba(234, 88, 12, 0.12);
}

.journal-post-top {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.pin {
  font-size: 0.65rem;
  flex-shrink: 0;
}

.journal-post-title {
  font-family: 'Noto Serif SC', serif;
  font-weight: 600;
  font-size: 0.9rem;
  color: #292524;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.journal-post-meta {
  margin-top: 0.25rem;
  font-size: 0.7rem;
  color: #78716c;
  display: flex;
  align-items: center;
  gap: 0.2rem;
}

.dot {
  opacity: 0.5;
}

.journal-post-snippet {
  margin: 0.4rem 0 0;
  font-size: 0.75rem;
  color: #a8a29e;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.journal-post-extra {
  margin-top: 0.35rem;
  font-size: 0.66rem;
  color: #a8a29e;
}

.journal-post-tags {
  margin-top: 0.45rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.mini-tag {
  font-size: 0.65rem;
  padding: 0.1rem 0.4rem;
  border-radius: 6px;
  background: rgba(234, 88, 12, 0.1);
  color: #9a3412;
}

.main {
  padding: 0;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  align-self: stretch;
}

.main > .editor-card,
.main > .stats-page,
.main > .empty-main {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
  min-width: 0;
}

.muted {
  font-size: 0.75rem;
  color: #78716c;
}

.editor-card {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  padding: 0;
  overflow: hidden;
}

.editor-card > *:not(.main-toolbar):not(.editor-foot) {
  padding-left: var(--card-pad-x);
  padding-right: var(--card-pad-x);
}

.editor-card > .vditor-host {
  padding-left: var(--editor-edge-inset);
  padding-right: var(--editor-edge-inset);
  padding-bottom: var(--editor-edge-inset);
}

.stats-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.stats-page-head {
  align-items: flex-end;
}

.stats-eyebrow {
  margin: 0 0 0.15rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #a8a29e;
}

.stats-title {
  margin: 0;
  font-family: 'Noto Serif SC', serif;
  font-size: 1.45rem;
  font-weight: 600;
  color: #1c1917;
}

.stats-page-body {
  padding: var(--card-pad-x);
  overflow: auto;
}

.stats-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
  margin-top: 0.8rem;
}

.stats-strip--page {
  margin: 0;
  gap: 1rem;
}

.stat-card {
  border: 1px solid rgba(28, 25, 23, 0.08);
  border-radius: 13px;
  padding-right: 0.6rem;
  padding-left: 0.6rem;
  padding-top: 0.65rem;
  padding-bottom: 0.65rem;
  background: rgba(250, 250, 249, 0.72);
}

.stats-strip--page .stat-card {
  min-height: 8rem;
  padding: 1.1rem 1.2rem;
  border-radius: 18px;
}

.stat-card span,
.stat-card small {
  display: block;
  font-size: 0.68rem;
  color: #a8a29e;
}

.stats-strip--page .stat-card span,
.stats-strip--page .stat-card small {
  font-size: 0.86rem;
}

.stat-card strong {
  display: block;
  margin: 0.15rem 0;
  color: #292524;
  font-size: 1.15rem;
  line-height: 1.15;
}

.stats-strip--page .stat-card strong {
  margin: 0.35rem 0;
  font-size: clamp(2rem, 5vw, 3.2rem);
}

.title-input {
  border: none;
  background: transparent;
  font-family: 'Noto Serif SC', serif;
  font-size: 1.5rem;
  font-weight: 600;
  color: #1c1917;
  flex: 1 1 auto;
  min-width: 0;
  width: auto;
  outline: none;
  margin: 0;
  padding: 0;
}

.title-updated {
  flex: 0 0 auto;
  font-size: 0.7rem;
  color: #a8a29e;
  white-space: nowrap;
}

.title-input::placeholder {
  color: #d6d3d1;
}

.meta-row {
  align-self: stretch;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: center;
  gap: clamp(1.75rem, 4vw, 3.75rem);
  width: 100%;
  max-width: 100%;
  margin-top: 0.95rem;
  margin-bottom: calc(var(--editor-edge-gap) - var(--editor-edge-inset));
  padding: 0;
}

.edit-date-control {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 0 8.9rem;
  width: 8.9rem;
  min-height: 2.25rem;
  padding: 0;
  overflow: hidden;
}

.meta-group::before,
.meta-group::after {
  content: '';
  flex: 0 0 auto;
  width: 1px;
  height: 1.65rem;
  margin-left: 0;
  background: rgba(28, 25, 23, 0.12);
}

.date-native {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  opacity: 0;
  cursor: pointer;
}

.date-display {
  pointer-events: none;
  display: block;
  width: 100%;
  font-weight: 700;
  font-size: 1rem;
  color: #292524;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
  white-space: nowrap;
}

.meta-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.meta-group::before {
  margin-right: 0.15rem;
  margin-left: 0;
}

.meta-group::after {
  margin-left: 0.15rem;
}

.meta-label {
  flex: 0 0 auto;
  font-size: 0.82rem;
  color: #78716c;
  white-space: nowrap;
}

.segmented-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.mood {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  box-sizing: border-box;
  height: 2.2rem;
  min-width: 4.45rem;
  border: 1px solid rgba(28, 25, 23, 0.08);
  border-radius: 7px;
  padding: 0 0.8rem;
  font-size: 0.78rem;
  font-weight: 600;
  line-height: 1;
  background: rgba(255, 255, 255, 0.72);
  color: #57534e;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.62);
  transition: border-color 0.15s, background 0.15s, color 0.15s, box-shadow 0.15s;
}

.mood:hover {
  border-color: rgba(234, 88, 12, 0.4);
}

.mood.on {
  background: linear-gradient(180deg, #f59e0b 0%, #d97706 100%);
  border-color: rgba(146, 64, 14, 0.72);
  color: #fff7ed;
  box-shadow:
    0 0 0 1px rgba(251, 146, 60, 0.26),
    0 6px 14px rgba(217, 119, 6, 0.22),
    inset 0 1px 0 rgba(255, 237, 213, 0.26);
}

.m-emoji {
  font-size: 0.95rem;
  line-height: 1;
}

.tag-toggle {
  min-width: 3.95rem;
}

.vditor-host {
  flex: 1 1 auto;
  min-height: 0;
  margin-top: var(--editor-edge-inset);
  margin-bottom: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.vditor-host::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  border: 1px solid var(--editor-frame-border);
  border-radius:
    var(--editor-inner-radius)
    var(--editor-inner-radius)
    var(--editor-tail-radius)
    var(--editor-tail-radius);
}

.vditor-host :deep(.vditor) {
  flex: 1 1 auto;
  height: 100% !important;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-color: transparent;
  border-radius:
    var(--editor-inner-radius)
    var(--editor-inner-radius)
    var(--editor-tail-radius)
    var(--editor-tail-radius);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.66);
}

.vditor-host :deep(.vditor-content) {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-bottom-left-radius: var(--editor-tail-radius);
  border-bottom-right-radius: var(--editor-tail-radius);
}

.vditor-host :deep(.vditor-ir) {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(255, 254, 251, 0.72);
  border-bottom-left-radius: var(--editor-tail-radius);
  border-bottom-right-radius: var(--editor-tail-radius);
}

.vditor-host :deep(.vditor-ir pre.vditor-reset) {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
  overflow: hidden;
  border-bottom-left-radius: var(--editor-tail-radius);
  border-bottom-right-radius: var(--editor-tail-radius);
}

.vditor-host :deep(.vditor-toolbar) {
  border-bottom-color: rgba(28, 25, 23, 0.08);
  background: rgba(250, 250, 249, 0.86);
}

.vditor-host :deep(.vditor-reset),
.vditor-host :deep(.vditor-ir pre.vditor-reset) {
  font-family: 'Noto Serif SC', 'Noto Serif', Georgia, serif;
  color: #44403c;
}

.vditor-host :deep(.vditor-ir pre.vditor-reset::after) {
  height: 10px;
}

.editor-foot {
  margin-top: auto;
  border-top: none;
  padding: 0.55rem 0.35rem 0.65rem;
  min-height: var(--panel-foot-min-height);
  box-sizing: border-box;
  align-items: center;
}

.editor-foot::before {
  content: '';
  display: block;
  margin: -0.55rem 0 0.45rem;
  border-bottom: 1px dashed rgba(28, 25, 23, 0.1);
}

.hint {
  font-size: 0.7rem;
  color: #a8a29e;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.empty-main {
  flex: 1;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem;
  border: 1px dashed rgba(28, 25, 23, 0.18);
}

.empty-title {
  margin: 0 0 0.35rem;
  font-family: 'Noto Serif SC', serif;
  font-size: 1.25rem;
  color: #44403c;
}

.empty-desc {
  margin: 0 0 1.25rem;
  font-size: 0.875rem;
  color: #78716c;
  max-width: 22rem;
}

.theme-dark .surface-card__head,
.theme-dark .card-foot {
  border-color: rgba(255, 247, 237, 0.1);
}

.theme-dark .editor-foot::before,
.theme-dark .sidebar-foot::before {
  border-bottom-color: rgba(255, 247, 237, 0.1);
}

.theme-dark .brand,
.theme-dark .journal-post-title,
.theme-dark .title-input,
.theme-dark .stats-title,
.theme-dark .stat-card strong,
.theme-dark .empty-title {
  color: #f5f5f4;
}

.theme-dark .title-updated,
.theme-dark .label,
.theme-dark .muted,
.theme-dark .journal-post-meta,
.theme-dark .journal-post-extra,
.theme-dark .journal-post-snippet,
.theme-dark .hint,
.theme-dark .filter-field span,
.theme-dark .empty-desc,
.theme-dark .sidebar-foot-filter {
  color: #a8a29e;
}

.theme-dark .btn {
  border-color: rgba(255, 247, 237, 0.14);
  background: #2d2722;
  color: #e7e5e4;
}

.theme-dark .btn.primary {
  background: #ea580c;
  border-color: #fb923c;
  color: #fff7ed;
}

.theme-dark .btn.ghost.on {
  background: rgba(234, 88, 12, 0.18);
  border-color: #fb923c;
  color: #fed7aa;
}

.theme-dark .mood.on {
  background: linear-gradient(180deg, #f59e0b 0%, #d97706 100%);
  border-color: rgba(251, 146, 60, 0.56);
  color: #fff7ed;
  box-shadow:
    0 0 0 1px rgba(251, 146, 60, 0.22),
    0 6px 16px rgba(0, 0, 0, 0.24),
    inset 0 1px 0 rgba(255, 237, 213, 0.25);
}

.theme-dark .btn.danger {
  background: #2d1c1c;
  border-color: rgba(248, 113, 113, 0.4);
  color: #fca5a5;
}

.theme-dark .btn.danger:hover {
  background: #3b1f1f;
}

.theme-dark .search,
.theme-dark .filter-field select,
.theme-dark .mood {
  border-color: rgba(255, 247, 237, 0.14);
  background: rgba(41, 37, 36, 0.92);
  color: #e7e5e4;
}

.theme-dark .search::placeholder,
.theme-dark .title-input::placeholder {
  color: #78716c;
}

.theme-dark .chip,
.theme-dark .pager-nav,
.theme-dark .pager-num {
  border-color: rgba(255, 247, 237, 0.12);
  background: rgba(41, 37, 36, 0.72);
  color: #d6d3d1;
}

.theme-dark .chip.on,
.theme-dark .pager-num.on {
  background: #f97316;
  border-color: #fb923c;
  color: #fff7ed;
}

.theme-dark .journal-post-card {
  background: rgba(41, 37, 36, 0.72);
}

.theme-dark .journal-post-card:hover {
  background: rgba(68, 64, 60, 0.72);
  border-color: rgba(255, 247, 237, 0.1);
}

.theme-dark .journal-post-card.active {
  background: #312a25;
  border-color: #fb923c;
  box-shadow: 0 4px 18px rgba(249, 115, 22, 0.18);
}

.theme-dark .mini-tag {
  background: rgba(249, 115, 22, 0.16);
  color: #fed7aa;
}

.theme-dark .stat-card {
  border-color: rgba(255, 247, 237, 0.1);
  background: rgba(41, 37, 36, 0.64);
}

.theme-dark .meta-row {
  background: transparent;
  box-shadow: none;
}

.theme-dark .date-display {
  color: #f5f5f4;
}

.theme-dark .meta-label {
  color: #a8a29e;
}

.theme-dark .edit-date-control::after,
.theme-dark .meta-group::before,
.theme-dark .meta-group::after {
  background: rgba(255, 255, 255, 0.11);
}

.theme-dark .empty-main {
  border-color: rgba(255, 247, 237, 0.14);
}

.theme-dark .vditor-host {
  --editor-frame-border: rgba(255, 247, 237, 0.12);
}

.theme-dark .vditor-host :deep(.vditor) {
  border-color: transparent;
  background: rgba(41, 37, 36, 0.8);
}

.theme-dark .vditor-host :deep(.vditor-toolbar) {
  border-bottom-color: rgba(255, 247, 237, 0.1);
  background: #2d2722;
}

.theme-dark .vditor-host :deep(.vditor-ir),
.theme-dark .vditor-host :deep(.vditor-reset),
.theme-dark .vditor-host :deep(.vditor-ir pre.vditor-reset) {
  background: #221c18;
  color: #e7e5e4;
}

.theme-dark .vditor-host :deep(.vditor-toolbar svg) {
  color: #d6d3d1;
}

@media (max-width: 900px) {
  .shell {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    transition: none;
    column-gap: 0;
    row-gap: 0;
    padding: var(--layout-pad);
  }

  .shell--collapsed {
    grid-template-columns: unset;
  }

  .shell--collapsed .main {
    padding-left: 0;
  }

  .rail {
    flex-direction: row;
    justify-content: center;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 1rem;
    width: 100%;
    min-height: unset;
  }

  .rail-brand {
    order: 0;
    flex-direction: row;
    align-items: center;
    width: auto;
    min-height: unset;
    padding: 0;
    border-bottom: none;
  }

  .rail-spacer {
    flex: 1;
    min-height: 0;
    order: 6;
  }

  .rail-toggle {
    order: 1;
    width: 2.45rem;
    height: 2.45rem;
    padding: 0;
    border-radius: 8px;
  }

  .rail-kpi {
    order: 2;
    width: 2.45rem;
    min-height: 2.45rem;
  }

  .rail-icon-slots {
    order: 3;
    width: auto;
    flex-direction: row;
    gap: 0.35rem;
    padding: 0;
  }

  .rail-icon-slot {
    width: 2.45rem;
    height: 2.45rem;
  }

  .rail-icon-slot span {
    width: 0.9rem;
    height: 0.9rem;
  }

  .rail-theme {
    order: 4;
    width: 2.45rem;
    height: 2.45rem;
    min-height: unset;
    margin: 0;
  }

  .rail-logout {
    order: 5;
    width: 2.8rem;
    height: 3.1rem;
    margin: 0 0.15rem;
  }

  .rail-seal {
    width: 2.45rem;
    height: 2.45rem;
    min-height: 2.35rem;
  }

  .rail-logout-text {
    display: grid;
  }

  .sidebar {
    border-right: none;
    min-height: auto;
    max-height: min(62dvh, 32rem);
    width: 100%;
    opacity: 1;
    pointer-events: auto;
    padding: 0.65rem 0 0;
    transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease,
      border-color 0.25s ease, margin 0.25s ease;
  }

  .journal-post-list {
    flex: 1 1 auto;
    max-height: min(42dvh, 20rem);
  }

  .sidebar-panel {
    max-height: 100%;
  }

  .shell--collapsed .sidebar {
    max-height: 0;
    min-height: 0;
    opacity: 0;
    pointer-events: none;
    overflow: hidden;
    padding: 0;
    margin-bottom: 0;
  }

  .main {
    flex: 1;
    min-height: 0;
    padding: 0.5rem 0 var(--layout-pad);
  }

  .meta-row {
    grid-template-columns: 1fr;
    align-items: center;
  }

  .stats-strip--page {
    grid-template-columns: 1fr;
  }

  .date-field,
  .input {
    width: 100%;
  }
}
</style>
