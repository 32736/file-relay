<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../lib/api'
import { formatDate } from '../lib/format'
import { loadShareUrls } from '../lib/share-urls'

interface ShareItem {
  id: string
  fileId: string
  fileName: string | null
  createdAt: number
  expiresAt: number | null
  maxDownloads: number | null
  downloadCount: number
  deleteFileAfterExhausted: boolean
  revokedAt: number | null
  /** Server-recovered link (same account, any device); null for legacy shares. */
  url: string | null
}

const shares = ref<ShareItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const busyId = ref<string | null>(null)
const copiedId = ref<string | null>(null)
const shareUrls = ref<Record<string, string>>({})
const query = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const qs = query.value.trim() ? `?q=${encodeURIComponent(query.value.trim())}` : ''
    const body = await api<{ shares: ShareItem[] }>(`/api/shares${qs}`)
    shares.value = body.shares
    // Server URL first (cross-device); the local cache only backs up legacy
    // shares created before server-side link recovery existed.
    const urls = loadShareUrls()
    for (const share of body.shares) {
      if (share.url) urls[share.id] = share.url
    }
    shareUrls.value = urls
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch(): void {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void load(), 250)
}

async function copyUrl(id: string): Promise<void> {
  const url = shareUrls.value[id]
  if (!url) return
  await navigator.clipboard.writeText(url)
  copiedId.value = id
  setTimeout(() => (copiedId.value = null), 1500)
}

async function revoke(id: string): Promise<void> {
  busyId.value = id
  try {
    await api(`/api/shares/${id}`, { method: 'DELETE' })
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busyId.value = null
  }
}

function stateLabel(share: ShareItem): string {
  if (share.revokedAt !== null) return '已撤销'
  if (share.expiresAt !== null && share.expiresAt <= Math.floor(Date.now() / 1000)) return '已过期'
  return share.maxDownloads !== null && share.downloadCount >= share.maxDownloads
    ? '已耗尽'
    : '有效'
}

onMounted(() => void load())
defineExpose({ load })
</script>

<template>
  <section class="share-list">
    <div class="toolbar">
      <h2>分享管理</h2>
      <input
        v-model="query"
        class="search"
        type="search"
        placeholder="搜索分享文件…"
        aria-label="搜索分享文件"
        @input="onSearch"
      >
    </div>

    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>
    <div
      v-if="loading && shares.length > 0"
      class="list-loading"
      role="status"
      aria-label="加载中"
    >
      加载中
    </div>
    <div
      v-if="loading && shares.length === 0"
      class="skeleton-list"
      role="status"
      aria-label="加载中"
    >
      <div
        v-for="n in 3"
        :key="n"
        class="skeleton-row"
      >
        <span
          class="skeleton-block"
          style="width: 40%"
        />
        <span
          class="skeleton-block"
          style="width: 14%"
        />
        <span
          class="skeleton-block"
          style="width: 10%"
        />
      </div>
    </div>
    <p
      v-else-if="shares.length === 0"
      class="empty"
    >
      {{ query.trim() ? '未找到相关分享' : '还没有分享链接。' }}
    </p>

    <table v-else>
      <thead>
        <tr>
          <th>文件</th>
          <th>状态</th>
          <th>下载</th>
          <th>有效期</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="share in shares"
          :key="share.id"
        >
          <td class="name">
            {{ share.fileName ?? share.fileId }}
          </td>
          <td>
            <span
              class="state"
              :class="stateLabel(share).toLowerCase()"
            >
              {{ stateLabel(share) }}
            </span>
          </td>
          <td>
            {{ share.downloadCount }}{{ share.maxDownloads !== null ? ` / ${share.maxDownloads}` : '' }}
          </td>
          <td>{{ share.expiresAt ? formatDate(share.expiresAt) : '永久' }}</td>
          <td class="actions">
            <button
              v-if="shareUrls[share.id]"
              class="icon-btn"
              :title="copiedId === share.id ? '已复制' : '复制链接'"
              :aria-label="copiedId === share.id ? '已复制' : '复制链接'"
              @click="copyUrl(share.id)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="9"
                  y="9"
                  width="11"
                  height="11"
                  rx="3"
                  stroke="currentColor"
                  stroke-width="2"
                />
                <path
                  d="M15 9V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h3"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
              <span
                v-if="copiedId === share.id"
                class="copied-tag"
              >已复制</span>
            </button>
            <button
              v-if="share.revokedAt === null"
              class="icon-btn danger"
              :disabled="busyId === share.id"
              :title="busyId === share.id ? '撤销中…' : '撤销'"
              :aria-label="busyId === share.id ? '撤销中…' : '撤销'"
              @click="revoke(share.id)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M5 7h14M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2m-8 0 1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
/* All colours use drop-* tokens to survive both light/dark themes *and* the
   <dialog showModal> top-layer custom-property inheritance quirks. See note
   in styles.css under `.share-management-dialog`. */
.toolbar {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1rem;
}
.toolbar h2 {
  margin: 0;
  font-size: 1.35rem;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--drop-ink);
}
.toolbar h2::before {
  content: "[ ";
  color: var(--drop-brand);
}
.toolbar h2::after {
  content: " ]";
  color: var(--drop-brand);
}
.search {
  flex: 1;
  min-width: 0;
  min-height: 2.75rem;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink);
  font-family: var(--font-micro);
  font-size: 0.85rem;
}
.search::placeholder {
  color: var(--drop-ink-3);
}
.search:focus {
  outline: none;
  border: 2px solid var(--drop-brand);
  padding: calc(0.5rem - 1px) calc(0.875rem - 1px);
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 0.75rem 0.7rem;
  border-bottom: 1px solid var(--drop-line);
  color: var(--drop-ink-2);
}
th {
  color: var(--drop-ink);
  font-family: var(--font-micro);
  font-size: .72rem;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
  border-bottom: 2px solid var(--drop-ink);
  background: var(--drop-surface-2);
}
.share-list table {
  background: var(--drop-surface);
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  overflow: hidden;
}
.share-list { min-height: 100%; display: flex; flex-direction: column; }
.share-list > .empty {
  flex: 1;
  display: grid;
  place-items: center;
  margin: 0;
  text-align: center;
  font-family: var(--font-micro);
  font-size: .85rem;
  color: var(--drop-ink-3);
}
.share-list > .empty::before { content: "[ "; color: var(--drop-brand); }
.share-list > .empty::after { content: " ]"; color: var(--drop-brand); }
tbody tr:hover {
  background: var(--drop-surface-muted);
}
.name {
  max-width: 20rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--drop-ink);
}
td {
  font-family: var(--font-micro);
  font-size: 0.82rem;
}
.state {
  font-size: 0.72rem;
  padding: 0.15rem 0.5rem;
  border: 1px solid currentColor;
  border-radius: 0;
  font-family: var(--font-micro);
  font-weight: 700;
  letter-spacing: 0.06em;
}
.state.有效 {
  background: color-mix(in srgb, var(--drop-state-success) 16%, var(--drop-surface));
  color: var(--drop-state-success);
}
.state.已撤销,
.state.已过期,
.state.已耗尽 {
  background: color-mix(in srgb, var(--drop-state-error) 16%, var(--drop-surface));
  color: var(--drop-state-error);
}
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.5rem 0;
}
.skeleton-row {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 0.7rem 0.4rem;
  border-bottom: 1px solid var(--drop-line);
}
.skeleton-block {
  height: 0.9rem;
  border-radius: 0;
  background: var(--drop-surface-muted);
  animation: shimmer 1.2s steps(2, jump-none) infinite;
}
@keyframes shimmer {
  50% {
    opacity: 0.4;
  }
}
button.ghost {
  background: var(--drop-surface);
  color: var(--drop-ink);
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  padding: 0.45rem 0.7rem;
  cursor: pointer;
}
button.ghost:disabled {
  opacity: 0.55;
  cursor: default;
}
button.danger {
  color: var(--drop-brand);
}
.actions {
  display: flex;
  gap: 0.4rem;
}
.actions .icon-btn {
  opacity: 0;
}
tbody tr:hover .actions .icon-btn,
.actions .icon-btn:focus-visible {
  opacity: 1;
}
@media (max-width: 520px) {
  .actions .icon-btn {
    opacity: 1;
  }
}
.icon-btn {
  position: relative;
  width: 2.25rem;
  height: 2.25rem;
  display: inline-grid;
  place-items: center;
  background: transparent;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  color: var(--drop-ink-2);
  cursor: pointer;
  padding: 0;
}
.icon-btn svg {
  width: 1.05rem;
  height: 1.05rem;
}
.icon-btn:hover {
  background: var(--drop-ink);
  color: var(--drop-background);
  border-color: var(--drop-ink);
}
.icon-btn.danger:hover {
  background: var(--drop-brand);
  color: var(--drop-background);
  border-color: var(--drop-brand);
}
.copied-tag {
  position: absolute;
  right: -0.4rem;
  top: -0.6rem;
  font-size: 0.62rem;
  padding: 0.08rem 0.3rem;
  border-radius: 0;
  background: var(--drop-state-success);
  color: #0A0A0A;
  font-family: var(--font-micro);
  font-weight: 700;
}
.empty {
  color: var(--drop-ink-3);
}
.error {
  color: var(--drop-state-error);
  font-family: var(--font-micro);
  font-size: 0.85rem;
}
</style>
