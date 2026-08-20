<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { api, getUserErrorMessage } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { COPY, getShareStatusLabel } from '../lib/copy'
import { formatDate } from '../lib/format'
import { buildPaginationItems } from '../lib/pagination'
import { loadShareUrls } from '../lib/share-urls'
import { toast } from '../lib/toast'

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

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const
const shares = ref<ShareItem[]>([])
const total = ref(0)
const nextCursor = ref<string | null>(null)
const page = ref(1)
const pageCursors = ref<Array<string | null>>([null])
const pageSize = ref<number>(PAGE_SIZE_OPTIONS[0])
const loading = ref(false)
const error = ref<string | null>(null)
const busyId = ref<string | null>(null)
const copiedId = ref<string | null>(null)
const shareUrls = ref<Record<string, string>>({})
const query = ref('')
const jumpPage = ref('')

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const paginationItems = computed(() => buildPaginationItems(page.value, pageCount.value))

async function loadPage(targetPage: number): Promise<void> {
  if (loading.value) return
  const cursor = targetPage > 1
    ? pageCursors.value[targetPage - 1] ?? String((targetPage - 1) * pageSize.value)
    : null

  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ limit: String(pageSize.value) })
    if (query.value.trim()) params.set('q', query.value.trim())
    if (cursor) params.set('cursor', cursor)
    const body = await api<{ shares: ShareItem[]; total?: number; nextCursor: string | null }>(
      `/api/shares?${params.toString()}`,
    )
    shares.value = body.shares
    total.value = body.total ?? (body.nextCursor
      ? (targetPage + 1) * pageSize.value
      : (targetPage - 1) * pageSize.value + body.shares.length)
    page.value = targetPage
    nextCursor.value = body.nextCursor
    if (body.nextCursor) pageCursors.value[targetPage] = body.nextCursor
    else pageCursors.value = pageCursors.value.slice(0, targetPage)
    // Server URL first (cross-device); the local cache only backs up legacy
    // shares created before server-side link recovery existed.
    const urls = loadShareUrls()
    for (const share of body.shares) {
      if (share.url) urls[share.id] = share.url
    }
    shareUrls.value = urls
  } catch (cause) {
    error.value = getUserErrorMessage(cause, COPY.errors.shareList)
  } finally {
    loading.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(searchTimer))
function onSearch(): void {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void load(true), 250)
}

async function copyUrl(id: string): Promise<void> {
  const url = shareUrls.value[id]
  if (!url) return
  try {
    await copyText(url)
    toast(COPY.feedback.linkCopied, 'success')
    copiedId.value = id
    setTimeout(() => (copiedId.value = null), 1500)
  } catch (cause) {
    toast(getUserErrorMessage(cause, COPY.errors.copy), 'error')
  }
}

async function load(reset = true): Promise<void> {
  if (reset) {
    page.value = 1
    pageCursors.value = [null]
    await loadPage(1)
    return
  }
  await nextPage()
}

async function previousPage(): Promise<void> {
  if (page.value <= 1) return
  await loadPage(page.value - 1)
}

async function nextPage(): Promise<void> {
  if (!nextCursor.value) return
  await loadPage(page.value + 1)
}

function onPageSizeChange(): void {
  page.value = 1
  jumpPage.value = ''
  pageCursors.value = [null]
  void loadPage(1)
}

function goToPage(targetPage: number): void {
  if (loading.value || targetPage < 1 || targetPage > pageCount.value || targetPage === page.value) return
  void loadPage(targetPage)
}

function jumpToPage(): void {
  const targetPage = Number.parseInt(jumpPage.value, 10)
  if (!Number.isFinite(targetPage)) return
  goToPage(Math.min(pageCount.value, Math.max(1, targetPage)))
  jumpPage.value = ''
}

async function revoke(id: string): Promise<void> {
  busyId.value = id
  try {
    await api(`/api/shares/${id}`, { method: 'DELETE' })
    toast(COPY.feedback.shareRevoked, 'success')
    await load(true)
  } catch (cause) {
    error.value = getUserErrorMessage(cause, COPY.errors.shareRevoke)
    toast(error.value, 'error')
  } finally {
    busyId.value = null
  }
}

function stateLabel(share: ShareItem): string {
  return getShareStatusLabel(share)
}

onMounted(() => {
  void load()
  // Focus the list search control when the desktop workspace is ready.
})
defineExpose({ load })
</script>

<template>
  <section
    class="share-list"
    aria-labelledby="share-management-title"
    :aria-busy="loading"
  >
    <div class="toolbar">
      <h2
        id="share-management-title"
        class="sr-only"
      >
        {{ COPY.shares.management }}
      </h2>
      <input
        v-model="query"
        class="search"
        type="search"
        :placeholder="COPY.shares.searchPlaceholder"
        aria-label="搜索分享文件"
        @input="onSearch"
      >
    </div>

    <p
      v-if="error"
      class="error"
      role="alert"
      aria-atomic="true"
    >
      {{ error }}
    </p>
    <div
      v-if="loading && shares.length > 0"
      class="list-loading"
      role="status"
      :aria-label="COPY.common.loading"
      aria-live="polite"
    >
      {{ COPY.common.loading }}
    </div>
    <div
      v-if="loading && shares.length === 0"
      class="skeleton-list"
      role="status"
      :aria-label="COPY.common.loading"
      aria-live="polite"
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
      role="status"
      aria-live="polite"
    >
      {{ query.trim() ? COPY.shares.noResults : COPY.shares.empty }}
    </p>

    <div
      v-else-if="shares.length > 0"
      class="table-scroll"
    >
      <table>
        <caption class="sr-only">
          {{ COPY.shares.list }}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              文件
            </th>
            <th scope="col">
              状态
            </th>
            <th scope="col">
              {{ COPY.shares.columnDownloads }}
            </th>
            <th scope="col">
              {{ COPY.shares.columnValidity }}
            </th>
            <th scope="col">
              操作
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="share in shares"
            :key="share.id"
          >
            <td class="name">
              {{ share.fileName || '未命名文件' }}
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
            <td>{{ share.expiresAt ? formatDate(share.expiresAt) : COPY.shares.permanent }}</td>
            <td class="actions">
              <button
                v-if="shareUrls[share.id]"
                class="icon-btn"
                :title="copiedId === share.id ? '已复制' : '复制链接'"
                :aria-label="copiedId === share.id ? '已复制' : '复制链接'"
                type="button"
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
                type="button"
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
    </div>

    <nav
      v-if="shares.length > 0 || page > 1 || nextCursor"
      class="pagination"
      aria-label="分享列表分页"
    >
      <span
        class="pagination-total"
        aria-live="polite"
      >
        共 {{ total }} 项
      </span>
      <label class="pagination-size">
        <span>每页</span>
        <select
          v-model.number="pageSize"
          :disabled="loading"
          aria-label="分享列表每页条数"
          @change="onPageSizeChange"
        >
          <option
            v-for="size in PAGE_SIZE_OPTIONS"
            :key="size"
            :value="size"
          >
            {{ size }}
          </option>
        </select>
        <span>条</span>
      </label>
      <div class="pagination-center">
        <button
          class="ghost pagination-arrow"
          :disabled="page <= 1 || loading"
          type="button"
          aria-label="上一页"
          @click="previousPage"
        >
          ‹
        </button>
        <template
          v-for="(item, index) in paginationItems"
          :key="typeof item === 'number' ? item : `ellipsis-${index}`"
        >
          <button
            v-if="typeof item === 'number'"
            class="pagination-page"
            :class="{ current: item === page }"
            :aria-current="item === page ? 'page' : undefined"
            :disabled="item === page || loading"
            type="button"
            @click="goToPage(item)"
          >
            {{ item }}
          </button>
          <span
            v-else
            class="pagination-ellipsis"
            aria-hidden="true"
          >…</span>
        </template>
        <button
          class="ghost pagination-arrow"
          :disabled="page >= pageCount || !nextCursor || loading"
          type="button"
          aria-label="下一页"
          @click="nextPage"
        >
          ›
        </button>
      </div>
      <label class="pagination-jump">
        <span>跳转到</span>
        <input
          v-model="jumpPage"
          inputmode="numeric"
          pattern="[0-9]*"
          type="text"
          :aria-label="`跳转到第 ${pageCount} 页以内`"
          @keydown.enter.prevent="jumpToPage"
        >
      </label>
    </nav>
  </section>
</template>

<style scoped>
/* All colours use drop-* tokens so the inline desktop panel stays coherent
   with the light/dark themes and the rest of the industrial UI. */
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
.search:focus-visible {
  outline: 2px solid var(--drop-brand);
  outline-offset: 2px;
}
.table-scroll {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--drop-ink);
  background: var(--drop-surface);
}
table {
  width: 100%;
  border-collapse: collapse;
}
.table-scroll > table {
  display: flex;
  flex-direction: column;
  min-width: 100%;
  height: 100%;
  min-height: 0;
}
.table-scroll thead {
  display: table;
  flex: none;
  width: 100%;
  table-layout: fixed;
}
.table-scroll tbody {
  display: block;
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.table-scroll tbody tr {
  display: table;
  width: 100%;
  table-layout: fixed;
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
  table-layout: fixed;
  background: var(--drop-surface);
  border: 0;
  border-radius: 0;
  overflow: hidden;
}
.share-list th:nth-child(1),
.share-list td:nth-child(1) { width: 34%; }
.share-list th:nth-child(2),
.share-list td:nth-child(2) { width: 16%; }
.share-list th:nth-child(3),
.share-list td:nth-child(3) { width: 13%; }
.share-list th:nth-child(4),
.share-list td:nth-child(4) { width: 17%; }
.share-list th:nth-child(5),
.share-list td:nth-child(5) { width: 20%; }
.share-list { min-height: 0; display: flex; flex-direction: column; padding: 1rem; }
.pagination {
  flex: none;
  display: grid;
  grid-template-columns: auto auto auto auto;
  align-items: center;
  justify-content: flex-end;
  gap: .5rem;
  margin-top: .75rem;
  padding-top: .75rem;
  border-top: 1px solid var(--drop-line);
}
.pagination-total {
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: .72rem;
  white-space: nowrap;
}
.pagination-center {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .35rem;
  padding: 0 .25rem;
}
.pagination-arrow { font-size: 1.1rem; line-height: 1; }
.pagination-page,
.pagination-ellipsis {
  min-width: 1.85rem;
  min-height: 2.25rem;
  display: inline-grid;
  place-items: center;
  padding: 0 .25rem;
  border: 1px solid transparent;
  background: transparent;
  color: var(--drop-ink-2);
  font-family: var(--font-micro);
  font-size: .72rem;
  font-weight: 700;
}
.pagination-page:not(:disabled):hover,
.pagination-page.current {
  border-color: var(--drop-brand);
  background: var(--drop-brand-tint);
  color: var(--drop-brand);
}
.pagination-page.current { cursor: default; }
.pagination-size {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: .72rem;
  white-space: nowrap;
}
.pagination-jump {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: .72rem;
  white-space: nowrap;
}
.pagination-jump input {
  width: 3rem;
  min-height: 2.25rem;
  padding: .25rem .4rem;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink);
  font: inherit;
  text-align: center;
}
.pagination-size select {
  width: 3.9rem;
  min-height: 2.25rem;
  padding: .25rem .45rem;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink);
  font: inherit;
  font-weight: 700;
  text-align: center;
}
.pagination button.ghost {
  min-width: 2.25rem;
  min-height: 2.25rem;
  padding: .4rem .65rem;
}
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
.state.下载次数已用完 {
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
  opacity: 1;
}
.share-list tbody tr { border-bottom: 1px solid var(--drop-line); }
.share-list tbody td { border-bottom: 0; }
.icon-btn {
  position: relative;
  width: auto;
  height: 2.25rem;
  aspect-ratio: 1;
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
  color: var(--drop-background);
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
