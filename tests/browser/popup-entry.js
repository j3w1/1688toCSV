import { mountPopup } from '../../src/popup.js'

// Only active-tab selection is adapted. Messaging, script injection, and file
// downloads are the real extension APIs against the isolated localhost tab.
const parameters = new URLSearchParams(location.search)
const tabId = Number(parameters.get('fixtureTab'))
const metadataUrl = parameters.has('unsupported')
  ? 'http://127.0.0.1/fixture.html'
  : 'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1234567890123456789'

mountPopup(
  {
    tabs: {
      query: async () => [{ id: tabId, url: metadataUrl }],
      sendMessage: chrome.tabs.sendMessage.bind(chrome.tabs),
    },
    scripting: chrome.scripting,
    downloads: chrome.downloads,
  },
  document,
  { pollMs: 25, timeoutMs: 500 }
)
