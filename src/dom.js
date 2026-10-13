// Index open shadow roots once per component query, not once per field.
export function deepQuery(root) {
  const roots = [root]
  const expanded = new Set()
  function* scopes() {
    for (let index = 0; index < roots.length; index++) {
      const current = roots[index]
      yield current
      // Most components are found immediately in their parent. Descend only
      // when needed, caching discovered roots for the remaining field queries.
      if (expanded.has(current)) continue
      expanded.add(current)
      const document = current.ownerDocument || current
      const walker = document.createTreeWalker(current, 1)
      let element
      while ((element = walker.nextNode())) {
        if (element.shadowRoot) roots.push(element.shadowRoot)
      }
    }
  }
  return {
    one: (selector) => {
      for (const current of scopes()) {
        const match = current.querySelector(selector)
        if (match) return match
      }
      return null
    },
    all: (selector) =>
      [...scopes()].flatMap((current) => [
        ...current.querySelectorAll(selector),
      ]),
  }
}
