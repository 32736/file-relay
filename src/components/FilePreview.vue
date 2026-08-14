<script setup lang="ts">
import { computed } from 'vue'

import type { FileItem } from './FileList.vue'

const props = defineProps<{ file: FileItem }>()
const emit = defineEmits<{ close: [] }>()

// Only these types preview inline; everything else (HTML/SVG included) is a
// plain download. Matches the server-side whitelist.
const PREVIEWABLE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const isImage = computed(() => props.file.mimeType !== null && PREVIEWABLE_IMAGES.has(props.file.mimeType))
const isPdf = computed(() => props.file.mimeType === 'application/pdf')

const downloadUrl = computed(() => `/api/files/${props.file.id}/download`)
</script>

<template>
  <div
    class="overlay"
    @click.self="emit('close')"
  >
    <div
      class="dialog"
      role="dialog"
      aria-label="文件预览"
    >
      <div class="head">
        <h3>{{ file.name }}</h3>
        <button
          type="button"
          class="ghost"
          @click="emit('close')"
        >
          ×
        </button>
      </div>

      <div class="body">
        <img
          v-if="isImage"
          :src="downloadUrl"
          :alt="file.name"
          class="preview"
        >
        <iframe
          v-else-if="isPdf"
          :src="downloadUrl"
          class="preview"
          title="PDF 预览"
        />
        <p
          v-else
          class="note"
        >
          此类型不支持内联预览，请下载查看。
        </p>
      </div>

      <div class="foot">
        <a
          class="download"
          :href="downloadUrl"
        >
          下载
        </a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.dialog {
  background: #fff;
  border-radius: 10px;
  width: 92%;
  max-width: 46rem;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border, #eee);
}
.head h3 {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.head button {
  border: none;
  background: none;
  font-size: 1.2rem;
  cursor: pointer;
  color: #666;
}
.body {
  flex: 1;
  overflow: auto;
  min-height: 12rem;
  background: #f7f7f7;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
}
.preview {
  max-width: 100%;
  max-height: 60vh;
  border: none;
}
.preview img {
  display: block;
}
.note {
  color: #777;
}
.foot {
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--border, #eee);
  text-align: right;
}
.download {
  display: inline-block;
  padding: 0.4rem 1rem;
  border-radius: 5px;
  background: var(--accent, #3b82f6);
  color: #fff;
  text-decoration: none;
}
</style>
