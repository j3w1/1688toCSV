import { mountPopup } from '../../src/popup.js'

// Only active-tab selection is adapted. Messaging and script injection use
// real extension APIs; downloads use the page link on the isolated localhost tab.
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
  },
  document,
  { pollMs: 25, timeoutMs: 500 }
)
