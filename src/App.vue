<script setup lang="ts">
import { onMounted, ref } from 'vue'

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
  <div class="shell">
    <!-- Public share page: slim header + download card -->
    <template v-if="shareToken">
      <header class="public-header">
        <span
          class="mark"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="1.5"
              y="1.5"
              width="21"
              height="21"
              rx="6.5"
              fill="var(--primary)"
            />
            <path
              d="M8.5 12h6.5m0 0-2.6-2.6M15 12l-2.6 2.6"
              stroke="#fff"
              stroke-width="2.1"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <h1 class="wordmark">
          Dr<span class="o">o</span>p
        </h1>
      </header>
      <main class="shell">
        <SharePage :token="shareToken" />
        <footer>
          <span>Drop · drop.28207.cc</span>
        </footer>
      </main>
    </template>

    <!-- Signed-out: calm brand panel -->
    <template v-else-if="auth !== 'owner'">
      <main class="shell">
        <section
          class="brand-panel"
          aria-labelledby="page-title"
        >
          <span
            class="mark"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="1.5"
                y="1.5"
                width="21"
                height="21"
                rx="6.5"
                fill="var(--primary)"
              />
              <path
                d="M8.5 12h6.5m0 0-2.6-2.6M15 12l-2.6 2.6"
                stroke="#fff"
                stroke-width="2.1"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <h1
            id="page-title"
            class="wordmark"
          >
            Dr<span class="o">o</span>p
          </h1>
          <p class="promise">
            Drop a file, pick it up anywhere. A private handoff point for your devices.
          </p>
          <span
            v-if="auth === 'loading'"
            class="promise"
            role="status"
          >
            Checking session…
          </span>
          <a
            v-else
            class="signin"
            href="/api/auth/github"
          >
            Sign in with GitHub
          </a>
        </section>
        <footer>
          <span>Drop · drop.28207.cc</span>
        </footer>
      </main>
    </template>

    <!-- Owner workspace: compact top bar + tabs -->
    <template v-else>
      <header class="topbar">
        <span
          class="mark"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="1.5"
              y="1.5"
              width="21"
              height="21"
              rx="6.5"
              fill="var(--primary)"
            />
            <path
              d="M8.5 12h6.5m0 0-2.6-2.6M15 12l-2.6 2.6"
              stroke="#fff"
              stroke-width="2.1"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <h1 class="wordmark">
          Dr<span class="o">o</span>p
        </h1>
        <span
          v-if="stats"
          class="stats"
          role="status"
        >
          {{ stats.fileCount }} 个文件 · 已用 {{ formatBytes(stats.totalBytes) }}
        </span>
      </header>

      <main class="shell">
        <nav
          class="tabs"
          aria-label="工作区导航"
        >
          <button
            :class="{ active: tab === 'files' }"
            :aria-current="tab === 'files' ? 'page' : undefined"
            type="button"
            @click="switchTab('files')"
          >
            文件
          </button>
          <button
            :class="{ active: tab === 'shares' }"
            :aria-current="tab === 'shares' ? 'page' : undefined"
            type="button"
            @click="switchTab('shares')"
          >
            分享
          </button>
        </nav>

        <section
          v-if="tab === 'files'"
          aria-label="文件工作区"
        >
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
        </section>
        <ShareList v-else-if="tab === 'shares'" />

        <footer>
          <span>Drop · drop.28207.cc</span>
        </footer>
      </main>
    </template>
  </div>
</template>

<style scoped>
.shared-notice {
  color: var(--success);
  margin-bottom: 0.6rem;
}
</style>
