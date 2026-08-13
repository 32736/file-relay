import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import App from '../src/App.vue'

describe('App', () => {
  it('renders the Phase 00 service foundation', () => {
    const wrapper = mount(App)

    expect(wrapper.get('h1').text()).toBe('Drop')
    expect(wrapper.get('[role="status"]').text()).toContain(
      'Phase 00 foundation ready',
    )
    expect(wrapper.text()).toContain('Private R2')
  })
})
