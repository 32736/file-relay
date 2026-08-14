<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import FileList from './components/FileList.vue'
import IncomingUpload from './components/IncomingUpload.vue'
import UploadZone from './components/UploadZone.vue'

type AuthState = 'loading' | 'anonymous' | 'owner'
const auth = ref<AuthState>('loading')
const listVersion = ref(0)

// Public incoming-upload pages live at /u/<token>; the owner workspace is the
// default. No router is introduced in this phase.
const incomingMatch = /^\/u\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname)
const incomingToken = incomingMatch?.[1] ?? null
const isIncomingPage = computed(() => incomingToken !== null)

onMounted(async () => {
  try {
    const response = await fetch('/api/auth/me')
    auth.value = response.ok ? 'owner' : 'anonymous'
  } catch {
    auth.value = 'anonymous'
  }
})

function refresh(): void {
  listVersion.value++
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
        v-if="!isIncomingPage"
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
    </section>

    <IncomingUpload
      v-if="isIncomingPage"
      :token="incomingToken ?? ''"
    />

    <section
      v-else-if="auth === 'owner'"
      class="workspace"
      aria-label="文件工作区"
    >
      <UploadZone @uploaded="refresh" />
      <FileList
        :key="listVersion"
        @shared="refresh"
      />
    </section>

    <footer>
      <code>GET /api/health</code>
      <span>drop.28207.cc</span>
    </footer>
  </main>
</template>
