import { createApp } from 'vue'

import App from './App.vue'
import { registerServiceWorker } from './lib/pwa'
import './styles.css'

createApp(App).mount('#app')

registerServiceWorker()
