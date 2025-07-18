// Wrap everything in an immediately invoked function to avoid conflicts
;(function () {
  'use strict'

  // Function to recursively search for elements in shadow DOM
  function findElementInShadowDOM(root, selector) {
    // First check the root element itself
    const element = root.querySelector(selector)
    if (element) return element

    // Then check all shadow roots
    const elementsWithShadow = root.querySelectorAll('*')
    for (const el of elementsWithShadow) {
      if (el.shadowRoot) {
        const found = findElementInShadowDOM(el.shadowRoot, selector)
        if (found) return found
      }
    }

    return null
  }

  // Function to find all elements in shadow DOM
  function findAllElementsInShadowDOM(root, selector) {
    const results = []

    // Check the root element
    const elements = root.querySelectorAll(selector)
    results.push(...elements)

    // Then check all shadow roots
    const elementsWithShadow = root.querySelectorAll('*')
    for (const el of elementsWithShadow) {
      if (el.shadowRoot) {
        const found = findAllElementsInShadowDOM(el.shadowRoot, selector)
        results.push(...found)
      }
    }

    return results
  }

  // Function to wait for app-root and its shadow DOM content
  function waitForAppRootShadowDOM(timeout = 30000) {
    return new Promise((resolve, reject) => {
      // Added reject
      let attempts = 0
      const maxAttempts = timeout / 1000

      const checkInterval = setInterval(() => {
        attempts++

        try {
          const appRoot = document.querySelector('app-root')
          if (!appRoot || !appRoot.shadowRoot) {
            console.log(`Attempt ${attempts}: app-root or shadow DOM not ready`)
            if (attempts >= maxAttempts) {
              clearInterval(checkInterval)
              reject(
                new Error('Timeout waiting for app-root or its shadow DOM')
              ) // Reject on timeout
            }
            return
          }

          // Try to find order-table with proper structure
          const orderTable = findElementInShadowDOM(
            appRoot.shadowRoot,
            'order-table'
          )
          if (orderTable && orderTable.shadowRoot) {
            const tableRows = findAllElementsInShadowDOM(
              orderTable.shadowRoot,
              'tr.table-row'
            )
            console.log(
              `Attempt ${attempts}: Found ${tableRows.length} table rows`
            )

            if (tableRows.length > 0) {
              clearInterval(checkInterval)
              console.log('Order table with rows found')
              resolve()
              return
            }
          }

          if (attempts >= maxAttempts) {
            clearInterval(checkInterval)
            console.log('Timeout waiting for order table rows')
            reject(new Error('Timeout waiting for order table rows to load')) // Reject on timeout even if app-root is found
          }
        } catch (error) {
          console.error('Error in waitForAppRootShadowDOM check:', error)
          clearInterval(checkInterval) // Clear interval on error
          reject(error) // Reject on internal error
        }
      }, 1000)
    })
  }

  async function extractData() {
    console.log('Content script: Starting extraction...')

    // Wait for app-root shadow DOM to load
    console.log('Waiting for app-root shadow DOM to load...')
    await waitForAppRootShadowDOM()
    console.log('App root shadow DOM loaded')

    // Find app-root and access its shadow DOM
    const appRoot = document.querySelector('app-root')
    if (!appRoot || !appRoot.shadowRoot)
      throw new Error('app-root or its shadow DOM not found')

    // Try to find order-table in shadow DOM
    const orderTable = findElementInShadowDOM(appRoot.shadowRoot, 'order-table')
    if (!orderTable || !orderTable.shadowRoot) {
      throw new Error('order-table component or its shadow DOM not found')
    }

    console.log('Found order-table component in shadow DOM, extracting data...')

    // Extract data from table rows
    const dataRows = extractOrderTableData(orderTable)

    if (dataRows.length === 0) {
      throw new Error('No product data could be extracted from the order table')
    }

    // Try to extract order info from shadow DOM
    const orderInfo = extractOrderInfo(appRoot.shadowRoot)

    console.log(`Successfully extracted ${dataRows.length} rows of data`)

    return {
      sellerName: orderInfo.sellerName || 'Unknown Seller',
      orderSuffix: orderInfo.orderSuffix || 'XXXX',
      dataRows: dataRows,
    }
  }

  function extractOrderTableData(orderTable) {
    const dataRows = []

    try {
      // Find all table rows in the order table shadow DOM
      const tableRows = findAllElementsInShadowDOM(
        orderTable.shadowRoot,
        'tr.table-row'
      )
      console.log(`Found ${tableRows.length} table rows in order table`)

      tableRows.forEach((row, index) => {
        console.log(`Processing row ${index + 1}`)

        try {
          // Extract data from each cell's web component
          const goodsCell = row.querySelector(
            'td:nth-child(1) order-table-goods'
          )
          const payCell = row.querySelector('td:nth-child(2) order-table-pay')
          const numberCell = row.querySelector(
            'td:nth-child(3) order-table-number'
          )
          const discountCell = row.querySelector(
            'td:nth-child(4) order-table-discount'
          )

          if (goodsCell || payCell || numberCell || discountCell) {
            const rowData = extractRowData(
              goodsCell,
              payCell,
              numberCell,
              discountCell,
              index + 1
            )
            if (rowData) {
              dataRows.push(rowData)
            }
          }
        } catch (error) {
          console.error(`Error processing row ${index + 1}:`, error)
        }
      })
    } catch (error) {
      console.error('Error extracting order table data:', error)
    }

    return dataRows
  }

  function extractRowData(
    goodsCell,
    payCell,
    numberCell,
    discountCell,
    rowNumber
  ) {
    try {
      console.log(`Extracting data from row ${rowNumber}`)

      // Extract thumbnail URL
      let thumbnail = ''
      if (goodsCell && goodsCell.shadowRoot) {
        const imgElement = findElementInShadowDOM(goodsCell.shadowRoot, 'img')
        if (imgElement && imgElement.src) {
          // Convert thumbnail URL format
          thumbnail = imgElement.src.replace(/\.64x64\.jpg/, '.jpg')
        }
      }

      // Extract description
      let description = ''
      if (goodsCell && goodsCell.shadowRoot) {
        const goodsInfo = findElementInShadowDOM(
          goodsCell.shadowRoot,
          '.goods-info'
        )
        if (goodsInfo) {
          const parts = []

          // Product title
          const titleLink = goodsInfo.querySelector('a.oneline')
          if (titleLink) {
            const title = titleLink.textContent.trim()
            if (title) parts.push(title)
          }

          // SKU information
          const skuDiv = goodsInfo.querySelector('.sku')
          if (skuDiv) {
            const colorText = skuDiv.querySelector('c-t')
            if (colorText) {
              const color = colorText.textContent.trim()
              if (color) parts.push(color)
            }

            const productNumber = skuDiv.querySelector('.product-number')
            if (productNumber) {
              const number = productNumber.textContent.trim()
              if (number) parts.push(number)
            }
          }

          description = parts.join('\n')
        }
      }

      // Extract price
      let price = '0'
      if (payCell && payCell.shadowRoot) {
        const payDiv = findElementInShadowDOM(
          payCell.shadowRoot,
          '.order-table-pay .pay'
        )
        if (payDiv) {
          let targetPriceDiv

          // First, try to find the div containing the original price (the second div child)
          // This div is present when there's both a discounted and original price.
          targetPriceDiv = payDiv.querySelector('div:nth-child(2)')

          // If the second div is not found, it means there's likely no discounted price,
          // so we take the first (and only) price div.
          if (!targetPriceDiv) {
            targetPriceDiv = payDiv.querySelector('div:nth-child(1)')
          }

          if (targetPriceDiv) {
            const priceText = targetPriceDiv.textContent || ''
            // Look for price pattern like "9.90 元/件"
            const priceMatch = priceText.match(/(\d+\.?\d*)\s*元/)
            if (priceMatch) {
              price = priceMatch[1]
            }
          }
        }
      }

      // Extract quantity
      let quantity = '0'
      if (numberCell && numberCell.shadowRoot) {
        const numberDiv = findElementInShadowDOM(
          numberCell.shadowRoot,
          '.order-table-number'
        )
        if (numberDiv) {
          const quantityText = numberDiv.textContent.trim()
          const quantityMatch = quantityText.match(/(\d+)/)
          if (quantityMatch) {
            quantity = quantityMatch[1]
          }
        }
      }

      // Extract discount
      let discount = '0'
      if (discountCell && discountCell.shadowRoot) {
        const discountDiv = findElementInShadowDOM(
          discountCell.shadowRoot,
          '.order-table-discount'
        )
        if (discountDiv) {
          const discountText = discountDiv.textContent || ''
          // Look for discount pattern like "优惠共0.99元"
          const discountMatch = discountText.match(/(\d+\.?\d*)\s*元/)
          if (discountMatch) {
            discount = discountMatch[1]
          }
        }
      }

      console.log(`Row ${rowNumber} extracted:`, {
        thumbnail: thumbnail.substring(0, 50) + '...',
        description: description.substring(0, 50) + '...',
        price,
        quantity,
        discount,
      })

      return {
        thumbnail: thumbnail,
        description: description,
        price: price,
        quantity: quantity,
        discount: discount,
      }
    } catch (error) {
      console.error(`Error extracting row ${rowNumber} data:`, error)
      return null
    }
  }

  function extractOrderInfo(shadowRoot) {
    const orderInfo = {
      sellerName: 'Unknown Seller',
      orderSuffix: 'XXXX',
    }

    try {
      // Try to extract from order-info component in shadow DOM
      const orderInfoComponent = findElementInShadowDOM(
        shadowRoot,
        'order-info'
      )
      if (orderInfoComponent && orderInfoComponent.shadowRoot) {
        // Look for seller name
        const userContentItems = findAllElementsInShadowDOM(
          orderInfoComponent.shadowRoot,
          '.order-info-user-content-item'
        )

        for (const item of userContentItems) {
          const fieldName = item.querySelector('.field-name')
          if (fieldName && fieldName.textContent.includes('会员登录名')) {
            const spans = item.querySelectorAll('span')
            if (spans.length > 1) {
              const sellerName = spans[1].textContent.trim()
              if (sellerName) {
                orderInfo.sellerName = sellerName
                console.log('Found seller name:', sellerName)
                break
              }
            }
          }
        }
      }

      // Extract order suffix from URL
      const urlMatch = window.location.href.match(/orderId=(\d+)/)
      if (urlMatch) {
        orderInfo.orderSuffix = urlMatch[1].slice(-4)
        console.log('Found order suffix:', orderInfo.orderSuffix)
      }
    } catch (error) {
      console.error('Error extracting order info:', error)
    }

    return orderInfo
  }

  // Message listener
  function handleMessage(request, sender, sendResponse) {
    try {
      console.log('Content script received message:', request)

      if (request.action === 'ping') {
        console.log('Responding to ping')
        sendResponse({ status: 'ready' })
        return false
      }

      if (request.action === 'extractData') {
        console.log('Starting data extraction...')

        extractData()
          .then((data) => {
            console.log('Data extraction successful:', data)
            sendResponse({ data })
          })
          .catch((error) => {
            console.error('Error extracting data:', error)
            sendResponse({ error: error.message })
          })

        return true
      }

      sendResponse({ error: 'Unknown action' })
      return false
    } catch (error) {
      console.error('Error in message handler:', error)
      sendResponse({ error: error.message })
      return false
    }
  }

  // Register message listener
  if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(handleMessage)
    console.log(
      'Content script loaded for shadow DOM extraction on:',
      window.location.href
    )
  } else {
    console.error('Chrome runtime not available')
  }
})()
