<script setup lang="ts">
const foundations = ["Vue 3", "Cloudflare Worker", "D1 metadata", "Private R2"];
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
        Phase 00 foundation ready
      </div>

      <ul class="foundations" aria-label="Service foundations">
        <li v-for="foundation in foundations" :key="foundation">
          {{ foundation }}
        </li>
      </ul>
    </section>

    <footer>
      <code>GET /api/health</code>
      <span>drop.28207.cc</span>
    </footer>
  </main>
</template>
