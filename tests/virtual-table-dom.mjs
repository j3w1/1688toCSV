/** LinkeDOM has no layout or animation frames; supply only the virtual table boundary. */
export function virtualTableDom(t, window) {
  const frames = new Map(),
    previous = new Map(),
    tops = new WeakMap()
  let nextFrame = 0,
    active = window.document.body
  for (const [key, value] of Object.entries({
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    },
    cancelAnimationFrame: (frame) => frames.delete(frame),
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  }
  Object.defineProperty(window.document, 'activeElement', {
    configurable: true,
    get: () => active,
  })
  const prototype = window.HTMLElement.prototype,
    properties = new Map()
  const replacements = {
    clientWidth: { get: () => 800 },
    clientHeight: { get: () => 300 },
    clientTop: { get: () => 0 },
    scrollTop: {
      get() {
        return tops.get(this) || 0
      },
      set(value) {
        tops.set(this, value)
      },
    },
    getBoundingClientRect: {
      value() {
        const scroll = this.closest('.vocabulary-scroll')
        return {
          top: this.localName === 'tbody' ? -(scroll?.scrollTop || 0) : 0,
          left: 0,
          width: 800,
          height: this.localName === 'tr' ? 44 : 300,
        }
      },
    },
    focus: {
      value() {
        const previous = active
        active = this
        if (previous && previous !== this) {
          const event = new window.Event('focusout', { bubbles: true })
          Object.defineProperty(event, 'relatedTarget', { value: this })
          previous.dispatchEvent(event)
        }
      },
    },
  }
  for (const [key, descriptor] of Object.entries(replacements)) {
    properties.set(key, Object.getOwnPropertyDescriptor(prototype, key))
    Object.defineProperty(prototype, key, { ...descriptor, configurable: true })
  }
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    for (const [key, descriptor] of properties) {
      if (descriptor) Object.defineProperty(prototype, key, descriptor)
      else delete prototype[key]
    }
  })
  return () => {
    for (let pass = 0; frames.size && pass < 20; pass++) {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback()
    }
  }
}
