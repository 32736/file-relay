<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

import FileList from './components/FileList.vue'
import ShareList from './components/ShareList.vue'
import SharePage from './components/SharePage.vue'
import UploadZone from './components/UploadZone.vue'

import { api } from './lib/api'
import { formatBytes } from './lib/format'
import { clearSharePayload, readSharePayload } from './lib/share-target'
import { useToasts } from './lib/toast'

type AuthState = 'loading' | 'anonymous' | 'owner'
type WorkspaceTab = 'files' | 'shares'

const auth = ref<AuthState>('loading')
const tab = ref<WorkspaceTab>('files')
const fileList = ref<InstanceType<typeof FileList> | null>(null)
const uploadZone = ref<InstanceType<typeof UploadZone> | null>(null)
const stats = ref<{ fileCount: number; totalBytes: number } | null>(null)
const hasFiles = ref(false)
const sharedNotice = ref(false)
const toasts = useToasts()
const workspaceRef = ref<HTMLElement | null>(null)
let motionCleanup: (() => void) | undefined

const canAnimate = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
if (canAnimate) gsap.registerPlugin(ScrollTrigger)

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

onMounted(() => {
  if (!canAnimate || !workspaceRef.value) return
  const context = gsap.context(() => {
    gsap.from('.intro-copy', {
      y: 36,
      opacity: 0,
      duration: 0.7,
      ease: 'power3.out',
    })
    gsap.from('.motion-panel', {
      y: 44,
      opacity: 0,
      duration: 0.7,
      stagger: 0.1,
      delay: 0.12,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: '.workspace-grid',
        start: 'top 88%',
        once: true,
      },
    })
    gsap.to('.handoff-dot', {
      x: 126,
      duration: 2.4,
      repeat: -1,
      ease: 'sine.inOut',
      yoyo: true,
    })
    gsap.to('.signal-card', {
      y: -10,
      duration: 1.8,
      stagger: 0.22,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    })
    ScrollTrigger.create({
      trigger: '.workspace-intro',
      start: 'top top+=96',
      end: '+=360',
      pin: '.intro-visual',
      pinSpacing: false,
      invalidateOnRefresh: true,
    })
  }, workspaceRef.value)
  motionCleanup = () => context.revert()
})

onBeforeUnmount(() => motionCleanup?.())

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
          ref="workspaceRef"
          aria-label="文件工作区"
        >
          <p
            v-if="sharedNotice"
            class="shared-notice"
            role="status"
          >
            已收到分享的文件，正在加入上传队列
          </p>
          <div class="workspace-intro">
            <div class="intro-copy">
              <p class="eyebrow">
                PRIVATE HANDOFF
              </p>
              <h2>Move a file from here to there.</h2>
              <p class="intro-lede">
                A quiet transfer desk for the files that need to arrive somewhere else.
              </p>
            </div>
            <div
              class="intro-visual"
              aria-hidden="true"
            >
              <div class="signal-card signal-card-origin">
                THIS DEVICE
              </div>
              <div class="handoff-rail">
                <span class="handoff-line" /><span class="handoff-dot" />
              </div>
              <div class="signal-card signal-card-destination">
                ANOTHER PLACE
              </div>
            </div>
          </div>
          <div class="workspace-grid">
            <article class="workspace-panel upload-panel motion-panel">
              <div class="panel-head">
                <div>
                  <span class="panel-kicker">TRANSFER QUEUE</span>
                  <h3>Send something forward</h3>
                </div>
                <span class="panel-limit">2 GB max</span>
              </div>
              <UploadZone
                ref="uploadZone"
                :compact="hasFiles"
                @uploaded="refresh"
              />
            </article>
            <article class="workspace-panel files-panel motion-panel">
              <div class="panel-head">
                <div>
                  <span class="panel-kicker">ON THE DESK</span>
                  <h3>Your files</h3>
                </div>
                <span class="panel-limit">stream-ready</span>
              </div>
              <FileList
                ref="fileList"
                @shared="refresh"
                @hasfiles="hasFiles = $event"
              />
            </article>
          </div>
        </section>
        <ShareList v-else-if="tab === 'shares'" />

        <footer>
          <span>Drop · drop.28207.cc</span>
        </footer>
      </main>
    </template>

    <!-- Global toasts -->
    <div
      v-if="toasts.length"
      class="toasts"
      aria-live="polite"
    >
      <div
        v-for="item in toasts"
        :key="item.id"
        class="toast"
        :class="item.kind"
        role="status"
      >
        {{ item.message }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.shared-notice {
  color: var(--success);
  margin-bottom: 0.6rem;
}
</style>
