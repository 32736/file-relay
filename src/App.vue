<script setup lang="ts">
import { onMounted, ref } from 'vue'

const foundations = ["Vue 3", "Cloudflare Worker", "D1 metadata", "Private R2"];

type AuthState = "loading" | "anonymous" | "owner";
const auth = ref<AuthState>("loading");

onMounted(async () => {
  try {
    const response = await fetch("/api/auth/me");
    auth.value = response.ok ? "owner" : "anonymous";
  } catch {
    auth.value = "anonymous";
  }
});
</script>

<template>
  <main class="shell">
    <section class="hero" aria-labelledby="page-title">
      <p class="eyebrow">Private file transfer</p>
      <div class="mark" aria-hidden="true">↗</div>
      <h1 id="page-title">Drop</h1>

      <p class="summary">
        A focused, owner-operated handoff point for files across your devices.
      </p>

      <div class="status" role="status">
        <span class="status-dot" aria-hidden="true"></span>
        Phase 01 auth ready
      </div>

      <ul class="foundations" aria-label="Service foundations">
        <li v-for="foundation in foundations" :key="foundation">
          {{ foundation }}
        </li>
      </ul>

      <div class="auth" role="status">
        <a v-if="auth === 'anonymous'" href="/api/auth/github">Sign in with GitHub</a>
        <span v-else-if="auth === 'owner'">Signed in as owner</span>
        <span v-else>Checking session…</span>
      </div>
    </section>

    <footer>
      <code>GET /api/health</code>
      <span>drop.28207.cc</span>
    </footer>
  </main>
</template>
