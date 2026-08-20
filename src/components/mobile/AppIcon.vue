<script setup lang="ts">
/**
 * Inline stroke icon set for the mobile shell (drop-mobile prototype uses
 * Lucide; these are hand-drawn equivalents in the same 24×24 stroke style so
 * the app keeps zero runtime icon dependencies).
 */
const props = defineProps<{ name: IconName }>()

type IconName =
  | 'user'
  | 'search'
  | 'search-x'
  | 'x'
  | 'plus'
  | 'more'
  | 'chevron-right'
  | 'chevron-left'
  | 'folder'
  | 'folder-open'
  | 'share'
  | 'download'
  | 'trash'
  | 'link'
  | 'copy'
  | 'check'
  | 'check-circle'
  | 'loader'
  | 'log-out'
  | 'upload-cloud'
  | 'image'
  | 'film'
  | 'qr-code'
  | 'clock'

const PATHS: Record<IconName, string[]> = {
  user: [
    'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    'M4.5 20.5a7.5 7.5 0 0 1 15 0',
  ],
  search: [
    'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15',
    'M16 16l5 5',
  ],
  'search-x': [
    'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15',
    'M16 16l5 5',
    'M8 8l5 5',
    'M13 8l-5 5',
  ],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  'chevron-right': ['M9 5l7 7-7 7'],
  'chevron-left': ['M15 5l-7 7 7 7'],
  folder: [
    'M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z',
  ],
  'folder-open': [
    'M3.5 19V6.5A1.5 1.5 0 0 1 5 5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5V10',
    'M3.5 19l2.3-8.5h16.2L19.7 19z',
  ],
  share: [
    'M6 14.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8',
    'M17.5 8.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8',
    'M17.5 20.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8',
    'M8.2 10.8l7-3.4',
    'M8.2 13.2l7 3.4',
  ],
  download: [
    'M12 4v11',
    'M12 15l4.5-4.5',
    'M12 15l-4.5-4.5',
    'M5 19h14',
  ],
  trash: [
    'M4 7h16',
    'M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7',
    'M6.5 7l1 12a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2l1-12',
    'M10 11v6',
    'M14 11v6',
  ],
  link: [
    'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5',
    'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5',
  ],
  copy: [
    'M9 9.5h9.5a.5.5 0 0 1 .5.5v9.5a.5.5 0 0 1-.5.5H9a.5.5 0 0 1-.5-.5V10a.5.5 0 0 1 .5-.5z',
    'M15 9.5V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h3.5',
  ],
  check: ['M5 12.5l4.5 4.5L19 7'],
  'check-circle': [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
    'M8 12.5l2.7 2.7L16.5 9',
  ],
  loader: [
    'M21 12a9 9 0 1 1-9-9',
    'M12 3v3',
  ],
  'log-out': [
    'M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3',
    'M16 8l4 4-4 4',
    'M20 12H9',
  ],
  'upload-cloud': [
    'M7.5 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.7 10a4 4 0 0 1-.7 8h-3',
    'M12 21v-9',
    'M12 12l-3.5 3.5',
    'M12 12l3.5 3.5',
  ],
  image: [
    'M5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5z',
    'M6.5 17l4-4 2.5 2.5 3-3 3.5 3.5',
    'M9.5 9.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4',
  ],
  film: [
    'M4.5 6h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-15a1.5 1.5 0 0 1-1.5-1.5v-9a1.5 1.5 0 0 1 1.5-1.5z',
    'M11 9l5 3-5 3',
  ],
  'qr-code': [
    'M4.5 4.5h5v5h-5z',
    'M14.5 4.5h5v5h-5z',
    'M4.5 14.5h5v5h-5z',
    'M14.5 14.5h2v2h-2z',
    'M18.5 14.5h1',
    'M14.5 18.5h1',
    'M17.5 18.5h2',
  ],
  clock: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
    'M12 7v5l3 2',
  ],
}
</script>

<template>
  <svg
    class="app-icon"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      v-for="(d, index) in PATHS[props.name]"
      :key="index"
      :d="d"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.app-icon {
  display: inline-block;
  width: 1.25rem;
  height: 1.25rem;
  flex: none;
  vertical-align: middle;
}
.app-icon.spin {
  animation: app-icon-spin 1s linear infinite;
}
@keyframes app-icon-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
