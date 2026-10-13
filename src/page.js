export function orderIdFromUrl(value) {
  try {
    return new URL(value).searchParams.get('orderId') || ''
  } catch {
    return ''
  }
}
