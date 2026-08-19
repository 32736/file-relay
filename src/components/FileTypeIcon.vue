<script setup lang="ts">
defineProps<{ mime: string | null }>()

function kind(mime: string | null): string {
  if (!mime) return 'other'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  if (/(zip|gzip|tar|rar|7z|x-compressed)/.test(mime)) return 'archive'
  if (/(javascript|json|xml|html|css|typescript|python|java|shell|sql)/.test(mime)) return 'code'
  if (mime.startsWith('text/')) return 'text'
  return 'other'
}
</script>

<template>
  <span
    class="file-icon"
    :class="kind(mime)"
    aria-hidden="true"
  >
    <!-- image -->
    <svg
      v-if="kind(mime) === 'image'"
      viewBox="0 0 24 24"
      fill="none"
    >
      <rect
        x="3.5"
        y="4.5"
        width="17"
        height="15"
        rx="3"
        stroke="currentColor"
        stroke-width="1.8"
      />
      <circle
        cx="9"
        cy="10"
        r="1.8"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <path
        d="m6 17 4.5-4.5 3 3L17 12l3 3"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <!-- video -->
    <svg
      v-else-if="kind(mime) === 'video'"
      viewBox="0 0 24 24"
      fill="none"
    >
      <rect
        x="3.5"
        y="5.5"
        width="17"
        height="13"
        rx="3"
        stroke="currentColor"
        stroke-width="1.8"
      />
      <path
        d="m10 9.5 4.5 2.5-4.5 2.5z"
        fill="currentColor"
      />
    </svg>
    <!-- audio -->
    <svg
      v-else-if="kind(mime) === 'audio'"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M9 18V6l9-2v11"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle
        cx="6.5"
        cy="18"
        r="2.5"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <circle
        cx="15.5"
        cy="15"
        r="2.5"
        stroke="currentColor"
        stroke-width="1.6"
      />
    </svg>
    <!-- pdf -->
    <svg
      v-else-if="kind(mime) === 'pdf'"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M7 3.5h7L18 7.5v13H7z"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <path
        d="M14 3.5V7.5h4M10 12h4m-4 3h4"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
    <!-- archive -->
    <svg
      v-else-if="kind(mime) === 'archive'"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M4.5 9h15v10a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19z"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <path
        d="M4.5 9 6 4.5h12L19.5 9M9 12.5h6"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
    <!-- code -->
    <svg
      v-else-if="kind(mime) === 'code'"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="m8.5 8-4 4 4 4m7-8 4 4-4 4m-3-9-3 10"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <!-- text / other -->
    <svg
      v-else
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M7 3.5h7L18 7.5v13H7z"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <path
        d="M14 3.5V7.5h4M10 12h4m-4 3h4"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  </span>
</template>

<style scoped>
.file-icon {
  display: inline-grid;
  place-items: center;
  width: 1.8rem;
  height: 1.8rem;
  flex: none;
  color: var(--drop-ink-3);
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface);
  transition: color var(--drop-dur-base) linear;
}
.file-icon svg {
  width: 1.35rem;
  height: 1.35rem;
}
.file-icon.image {
  color: var(--drop-brand);
  border-color: var(--drop-brand);
}
.file-icon.video,
.file-icon.audio,
.file-icon.pdf,
.file-icon.archive,
.file-icon.code {
  color: var(--drop-ink);
}
</style>
