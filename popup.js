// popup script with enhanced UI and state management
let currentState = 'loading'
let currentTab = null

// UI Elements
const statusDot = document.getElementById('status-dot')
const statusText = document.getElementById('status-text')
const downloadButton = document.getElementById('download-csv-order')
const buttonSpinner = document.getElementById('button-spinner')
const buttonText = document.getElementById('button-text')
const errorMessage = document.getElementById('error-message')
const successMessage = document.getElementById('success-message')
const pageInfo = document.getElementById('page-info')

// State management
function updateState(state, message = '') {
    currentState = state

    // Update status indicator
    statusDot.className = `status-dot ${state}`
    statusText.textContent = message

    // Update button state
    if (state === 'loading') {
        downloadButton.disabled = true
        buttonText.textContent = 'Loading...'
    } else if (state === 'loaded') {
        downloadButton.disabled = false
        buttonText.textContent = 'Download CSV'
    } else if (state === 'error') {
        downloadButton.disabled = true
        buttonText.textContent = 'Page Error'
    }

    hideMessages()
}

function showError(message) {
    errorMessage.textContent = message
    errorMessage.style.display = 'block'
    successMessage.style.display = 'none'
}

function showSuccess(message) {
    successMessage.textContent = message
    successMessage.style.display = 'block'
    errorMessage.style.display = 'none'
}

function hideMessages() {
    errorMessage.style.display = 'none'
    successMessage.style.display = 'none'
}

function setButtonLoading(loading) {
    if (loading) {
        buttonSpinner.style.display = 'block'
        buttonText.textContent = 'Downloading...'
        downloadButton.disabled = true
    } else {
        buttonSpinner.style.display = 'none'
        buttonText.textContent = 'Download CSV'
        downloadButton.disabled = currentState !== 'loaded'
    }
}

function updatePageInfo(url) {
    if (url) {
        const urlObj = new URL(url)
        const orderId = urlObj.searchParams.get('orderId')
        if (orderId) {
            pageInfo.textContent = `Order ID: ${orderId}`
        } else {
            pageInfo.textContent = 'No order ID found'
        }
    } else {
        pageInfo.textContent = 'No page information'
    }
}

// Download functionality
function downloadExcel(data) {
    const csvContent = convertToCSV(data.dataRows)
    const csvWithBOM = '\uFEFF' + csvContent

    const blob = new Blob([csvWithBOM], { type: 'text/csv;charset=utf-8' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `${data.sellerName}_${data.orderSuffix}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    showSuccess(`Downloaded: ${data.sellerName}_${data.orderSuffix}.csv`)
}

function convertToCSV(data) {
    const headers = [
        'Thumbnail',
        'Description',
        'Price',
        'Quantity',
        'Discount',
    ]
    const csvRows = [headers.join(',')]

    data.forEach((row) => {
        const values = [
            `"${row.thumbnail || ''}"`,
            `"${(row.description || '').replace(/"/g, '""')}"`,
            row.price || '0',
            row.quantity || '0',
            row.discount || '0',
        ]
        csvRows.push(values.join(','))
    })

    return csvRows.join('\n')
}

function checkIfContentScriptLoaded(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
            if (chrome.runtime.lastError) {
                resolve(false)
            } else {
                resolve(true)
            }
        })
    })
}

function injectContentScript(tabId) {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript(
            {
                target: { tabId: tabId },
                files: ['content.js'],
            },
            (results) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError)
                } else {
                    resolve(results)
                }
            }
        )
    })
}

async function checkPageState() {
    try {
        updateState('loading', 'Checking page...')

        // Get the current tab
        const tabs = await new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, resolve)
        })

        currentTab = tabs[0]

        if (!currentTab) {
            updateState('error', 'No active tab found')
            showError('Could not access current tab')
            return
        }

        updatePageInfo(currentTab.url)

        // Check if we're on a supported page
        const supportedUrls = [
            'https://trade.1688.com/order/new_step_order_detail.htm',
            'https://air.1688.com/app/ctf-page/trade-order-detail/index.html',
        ]

        const isSupported = supportedUrls.some(
            (url) => currentTab.url && currentTab.url.includes(url)
        )

        if (!isSupported) {
            updateState('error', 'Unsupported page')
            showError('Please navigate to a 1688.com order detail page')
            return
        }

        updateState('loading', 'Checking content script...')

        // Check if content script is loaded
        const isLoaded = await checkIfContentScriptLoaded(currentTab.id)

        if (!isLoaded) {
            updateState('loading', 'Loading content script...')
            try {
                await injectContentScript(currentTab.id)
                await new Promise((resolve) => setTimeout(resolve, 2000))

                const isLoadedAfterInjection = await checkIfContentScriptLoaded(
                    currentTab.id
                )
                if (!isLoadedAfterInjection) {
                    throw new Error('Content script failed to load')
                }
            } catch (error) {
                updateState('error', 'Script loading failed')
                showError(
                    'Failed to load content script. Please refresh the page.'
                )
                return
            }
        }

        updateState('loaded', 'Page ready')
    } catch (error) {
        console.error('Error checking page state:', error)
        updateState('error', 'Check failed')
        showError('An error occurred while checking the page')
    }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
    // Check page state on popup open
    checkPageState()

    // Download button click handler
    downloadButton.addEventListener('click', async () => {
        if (currentState !== 'loaded' || !currentTab) {
            showError('Page not ready for download')
            return
        }

        setButtonLoading(true)
        hideMessages()

        try {
            chrome.tabs.sendMessage(
                currentTab.id,
                { action: 'extractData' },
                (response) => {
                    setButtonLoading(false)

                    if (chrome.runtime.lastError) {
                        showError(
                            'Failed to extract data. Please refresh the page.'
                        )
                        return
                    }

                    if (response && response.data) {
                        downloadExcel(response.data)
                    } else if (response && response.error) {
                        showError('Error extracting data: ' + response.error)
                    } else {
                        showError(
                            'No data found. Make sure the page is fully loaded.'
                        )
                    }
                }
            )
        } catch (error) {
            setButtonLoading(false)
            showError('An error occurred during download')
        }
    })
})
