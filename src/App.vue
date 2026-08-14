<script setup lang="ts">
import { onMounted, ref } from 'vue'

import FileList from './components/FileList.vue'
import UploadZone from './components/UploadZone.vue'

type AuthState = 'loading' | 'anonymous' | 'owner'
const auth = ref<AuthState>('loading')
const listVersion = ref(0)

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
        >Sign in with GitHub</a>
        <span v-else-if="auth === 'owner'">Signed in as owner</span>
        <span v-else>Checking session…</span>
      </div>
    </section>

    <section
      v-if="auth === 'owner'"
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
