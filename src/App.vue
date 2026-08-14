<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import FileList from './components/FileList.vue'
import ShareList from './components/ShareList.vue'
import SharePage from './components/SharePage.vue'
import UploadZone from './components/UploadZone.vue'

import { api } from './lib/api'
import { formatBytes } from './lib/format'
import { clearSharePayload, readSharePayload } from './lib/share-target'

type AuthState = 'loading' | 'anonymous' | 'owner'
type WorkspaceTab = 'files' | 'shares'

const auth = ref<AuthState>('loading')
const tab = ref<WorkspaceTab>('files')
const fileList = ref<InstanceType<typeof FileList> | null>(null)
const uploadZone = ref<InstanceType<typeof UploadZone> | null>(null)
const stats = ref<{ fileCount: number; totalBytes: number } | null>(null)
const sharedNotice = ref(false)

// Public pages are routed by pathname (no router in this phase):
//   /s/<token>  → public share page
// otherwise the owner workspace.
const shareMatch = /^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname)
const shareToken = shareMatch?.[1] ?? null
const isPublicPage = computed(() => shareToken !== null)

onMounted(async () => {
  try {
    const response = await fetch('/api/auth/me')
    auth.value = response.ok ? 'owner' : 'anonymous'
    if (auth.value === 'owner') {
      void loadStats()
      void consumeShareTarget()
    }
  } catch {
    auth.value = 'anonymous'
  }
})

// Web Share Target: the service worker stashed shared files in IndexedDB and
// redirected here with ?shared=1; feed them into the upload queue.
async function consumeShareTarget(): Promise<void> {
  if (window.location.search !== '?shared=1') return
  try {
    const payload = await readSharePayload()
    if (payload && payload.files.length > 0) {
      uploadZone.value?.addFiles(payload.files)
      sharedNotice.value = true
      setTimeout(() => (sharedNotice.value = false), 4000)
    }
    await clearSharePayload()
  } catch {
    // Ignore storage failures; the payload simply won't be imported.
  }
}

async function loadStats(): Promise<void> {
  try {
    stats.value = await api<{ fileCount: number; totalBytes: number }>('/api/stats')
  } catch {
    stats.value = null
  }
}

// Refresh the file list and stats in place (no remount) so open dialogs and
// the current tab survive uploads and share creation.
function refresh(): void {
  void fileList.value?.load(true)
  void loadStats()
}

function switchTab(next: WorkspaceTab): void {
  tab.value = next
  if (next === 'files') void loadStats()
}
</script>

<template>
  <main class="shell">
    <section
      class="hero"
      aria-labelledby="page-title"
    >
      <p class="eyebrow">
        Private file transfer
      </p>
      <div
        class="mark"
        aria-hidden="true"
      >
        ↗
      </div>
      <h1 id="page-title">
        Drop
      </h1>

      <p class="summary">
        A focused, owner-operated handoff point for files across your devices.
      </p>

      <div
        v-if="!isPublicPage"
        class="status"
        role="status"
      >
        <span
          class="status-dot"
          aria-hidden="true"
        />
        <a
          v-if="auth === 'anonymous'"
          href="/api/auth/github"
        >
          Sign in with GitHub
        </a>
        <span v-else-if="auth === 'owner'">Signed in as owner</span>
        <span v-else>Checking session…</span>
      </div>

      <p
        v-if="auth === 'owner' && stats"
        class="stats"
        role="status"
      >
        {{ stats.fileCount }} 个文件 · 已用 {{ formatBytes(stats.totalBytes) }}
      </p>
    </section>

    <SharePage
      v-if="shareToken"
      :token="shareToken"
    />

    <section
      v-else-if="auth === 'owner'"
      class="workspace"
      aria-label="文件工作区"
    >
      <nav
        class="tabs"
        aria-label="工作区导航"
      >
        <button
          :class="{ active: tab === 'files' }"
          type="button"
          @click="switchTab('files')"
        >
          文件
        </button>
        <button
          :class="{ active: tab === 'shares' }"
          type="button"
          @click="switchTab('shares')"
        >
          分享
        </button>
      </nav>

      <template v-if="tab === 'files'">
        <p
          v-if="sharedNotice"
          class="shared-notice"
          role="status"
        >
          已收到分享的文件，正在加入上传队列
        </p>
        <UploadZone
          ref="uploadZone"
          @uploaded="refresh"
        />
        <FileList
          ref="fileList"
          @shared="refresh"
        />
      </template>
      <ShareList v-else-if="tab === 'shares'" />
    </section>

    <footer>
      <code>GET /api/health</code>
      <span>drop.28207.cc</span>
    </footer>
  </main>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border, #eee);
}
.tabs button {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 0.5rem 1rem;
  cursor: pointer;
  font-size: 0.95rem;
  color: #666;
}
.tabs button.active {
  color: var(--accent, #3b82f6);
  border-bottom-color: var(--accent, #3b82f6);
  font-weight: 600;
}
.stats {
  margin-top: 0.4rem;
  color: #888;
  font-size: 0.85rem;
}
.shared-notice {
  color: #16a34a;
  margin-bottom: 0.6rem;
}
</style>
