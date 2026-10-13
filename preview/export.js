const response = await fetch('/fixture-data.json')
const rows = await response.json()
for (const row of rows.dataRows) {
  const tr = document.createElement('tr')
  const imageCell = document.createElement('td')
  const img = document.createElement('img')
  img.src = row.thumbnail
  img.width = 40
  img.height = 40
  img.alt = 'Synthetic product'
  imageCell.appendChild(img)
  tr.appendChild(imageCell)
  for (const key of ['description', 'price', 'quantity', 'discount']) {
    const td = document.createElement('td')
    td.textContent = row[key]
    tr.appendChild(td)
  }
  document.getElementById('rows').appendChild(tr)
}
