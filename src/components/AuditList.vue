<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

import { api, getUserErrorMessage } from '../lib/api'
import { COPY } from '../lib/copy'
import { formatBytes, formatDate } from '../lib/format'
import { buildPaginationItems } from '../lib/pagination'

interface AuditEntry {
  id: string
  action: string
  targetType: string
  targetId: string | null
  metadata: Record<string, unknown> | null
  createdAt: number
}

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const
const entries = ref<AuditEntry[]>([])
const total = ref(0)
const nextCursor = ref<string | null>(null)
const page = ref(1)
const pageCursors = ref<Array<string | null>>([null])
const pageSize = ref<number>(PAGE_SIZE_OPTIONS[0])
const jumpPage = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const auditTitle = ref<HTMLHeadingElement | null>(null)

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const paginationItems = computed(() => buildPaginationItems(page.value, pageCount.value))

function description(entry: AuditEntry): string {
  const metadata = entry.metadata
  if (metadata?.count) return `${metadata.count} 个文件`
  if (typeof metadata?.size === 'number') return formatBytes(metadata.size)
  const targetType = COPY.audit.targets[entry.targetType as keyof typeof COPY.audit.targets] ?? entry.targetType
  return entry.targetId ? `${targetType} · ${entry.targetId.slice(0, 8)}` : targetType
}

function actionLabel(action: string): string {
  return COPY.audit.actions[action as keyof typeof COPY.audit.actions] ?? action
}

async function loadPage(targetPage: number): Promise<void> {
  if (loading.value) return
  if (targetPage < 1 || targetPage > pageCount.value) return
  const cursor = targetPage > 1
    ? pageCursors.value[targetPage - 1] ?? String((targetPage - 1) * pageSize.value)
    : null

  loading.value = true
  error.value = null
  try {
    const query = new URLSearchParams({ limit: String(pageSize.value) })
    if (cursor) query.set('cursor', cursor)
    const body = await api<{ entries: AuditEntry[]; total?: number; nextCursor: string | null }>(
      `/api/audit?${query.toString()}`,
    )
    entries.value = body.entries
    total.value = body.total ?? (body.nextCursor
      ? (targetPage + 1) * pageSize.value
      : (targetPage - 1) * pageSize.value + body.entries.length)
    page.value = targetPage
    nextCursor.value = body.nextCursor
    if (body.nextCursor) pageCursors.value[targetPage] = body.nextCursor
    else pageCursors.value = pageCursors.value.slice(0, targetPage)
  } catch (cause) {
    error.value = getUserErrorMessage(cause, COPY.errors.auditList)
  } finally {
    loading.value = false
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
  pageCursors.value = [null]
  jumpPage.value = ''
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

onMounted(() => {
  void load()
  void nextTick(() => auditTitle.value?.focus())
})

defineExpose({ load })
</script>

<template>
  <section
    class="audit-list"
    aria-labelledby="audit-title"
    :aria-busy="loading"
  >
    <header class="audit-head">
      <div>
        <p class="audit-kicker">
          /// ACTIVITY LOG
        </p>
        <h2
          id="audit-title"
          ref="auditTitle"
          tabindex="-1"
        >
          {{ COPY.audit.title }}
        </h2>
      </div>
    </header>
    <p
      v-if="error"
      class="audit-error"
      role="alert"
      aria-atomic="true"
    >
      {{ error }}
    </p>
    <div
      v-else-if="loading && entries.length === 0"
      class="audit-empty"
      role="status"
      aria-live="polite"
    >
      {{ COPY.audit.loading }}
    </div>
    <div
      v-else-if="entries.length === 0"
      class="audit-empty"
      role="status"
      aria-live="polite"
    >
      {{ COPY.audit.empty }}
    </div>
    <div
      v-else
      class="table-scroll"
    >
      <table>
        <caption class="sr-only">
          操作记录列表
        </caption>
        <thead>
          <tr>
            <th scope="col">
              时间
            </th>
            <th scope="col">
              操作
            </th>
            <th scope="col">
              说明
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in entries"
            :key="entry.id"
          >
            <td class="audit-time">
              {{ formatDate(entry.createdAt) }}
            </td>
            <td class="audit-action">
              {{ actionLabel(entry.action) }}
            </td>
            <td class="audit-description">
              {{ description(entry) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <nav
      v-if="entries.length > 0 || page > 1 || nextCursor"
      class="pagination"
      aria-label="操作记录分页"
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
          aria-label="操作记录每页条数"
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
          :key="`${item}-${index}`"
        >
          <button
            v-if="item !== 'ellipsis'"
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
          >
            …
          </span>
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
        <span>跳至</span>
        <input
          v-model="jumpPage"
          inputmode="numeric"
          type="text"
          aria-label="跳转到页码"
          @keyup.enter="jumpToPage"
        >
        <span>页</span>
      </label>
    </nav>
  </section>
</template>

<style scoped>
.audit-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.audit-head {
  display: flex;
  flex: none;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.9rem;
  border-bottom: 2px solid var(--drop-ink);
}
.audit-kicker {
  margin: 0 0 0.2rem;
  color: var(--drop-brand);
  font-family: var(--font-micro);
  font-size: 0.68rem;
  letter-spacing: 0.14em;
}
.audit-head h2 {
  margin: 0;
  color: var(--drop-ink);
  font-family: var(--font-macro);
  font-size: 1.35rem;
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
.table-scroll > table {
  display: flex;
  flex-direction: column;
  min-width: 100%;
  width: 100%;
  height: 100%;
  min-height: 0;
  border-collapse: collapse;
  table-layout: fixed;
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
  padding: 0.75rem 0.7rem;
  border-bottom: 1px solid var(--drop-line);
  color: var(--drop-ink-2);
  text-align: left;
  font-family: var(--font-micro);
  font-size: 0.78rem;
}
th {
  color: var(--drop-ink);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-bottom: 2px solid var(--drop-ink);
  background: var(--drop-surface-2);
}
th:nth-child(1),
td:nth-child(1) { width: 30%; }
th:nth-child(2),
td:nth-child(2) { width: 25%; }
th:nth-child(3),
td:nth-child(3) { width: 45%; }
.audit-time {
  color: var(--drop-ink-3);
  font-variant-numeric: tabular-nums;
}
.audit-action {
  color: var(--drop-ink);
  font-weight: 700;
}
.audit-description {
  overflow: hidden;
  color: var(--drop-ink-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.audit-empty,
.audit-error {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 2.5rem 0;
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  text-align: center;
}
.audit-error { color: var(--drop-state-error); }
.pagination {
  flex: none;
  display: grid;
  grid-template-columns: auto auto auto auto;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--drop-line);
}
.pagination-total {
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: 0.72rem;
  white-space: nowrap;
}
.pagination-center {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0 0.25rem;
}
.pagination-size {
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: 0.72rem;
  white-space: nowrap;
}
.pagination-arrow {
  min-width: 2.25rem;
  font-size: 1.1rem;
  line-height: 1;
}
.pagination-page,
.pagination-ellipsis {
  min-width: 1.85rem;
  min-height: 2.25rem;
  display: inline-grid;
  place-items: center;
  padding: 0 0.25rem;
  border: 1px solid transparent;
  background: transparent;
  color: var(--drop-ink-2);
  font-family: var(--font-micro);
  font-size: 0.72rem;
  font-weight: 700;
}
.pagination-page:not(:disabled):hover,
.pagination-page.current {
  border-color: var(--drop-brand);
  background: var(--drop-brand-tint);
  color: var(--drop-brand);
}
.pagination-page.current { cursor: default; }
.pagination-jump {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: 0.72rem;
  white-space: nowrap;
}
.pagination-jump input {
  width: 3rem;
  min-height: 2.25rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink);
  font: inherit;
  text-align: center;
}
.pagination-size {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.pagination-size select {
  width: 3.9rem;
  min-height: 2.25rem;
  padding: 0.25rem 0.45rem;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink);
  font: inherit;
  font-weight: 700;
  text-align: center;
}
button.ghost {
  min-height: 2.25rem;
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink);
  cursor: pointer;
  font-family: var(--font-micro);
}
.pagination button.ghost {
  min-width: 2.25rem;
  min-height: 2.25rem;
  padding: 0.4rem 0.65rem;
}
button.ghost:disabled {
  opacity: 0.55;
  cursor: default;
}
@media (max-width: 620px) {
  .audit-head { align-items: flex-start; }
  th,
  td { padding: 0.6rem 0.45rem; }
  .pagination,
  .pagination-center { gap: 0.4rem; }
}
</style>
