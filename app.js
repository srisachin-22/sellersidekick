const $ = (s) => document.querySelector(s);
const request = $('#request'), extractBtn = $('#extractBtn'), payBtn = $('#payBtn');
let extracted = false;
let paypalReady = false;
let activeCurrency = 'USD';

function showError(message) { const el = $('#error'); el.textContent = message; el.hidden = !message; }
function formatMoney(value, currency = 'USD') {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${Number(value).toFixed(2)}`; }
}
async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
async function loadConfig() {
  try {
    const config = await api('/api/config');
    activeCurrency = config.currency || 'USD';
    paypalReady = config.paypalReady;
    const symbols = { USD: '$', INR: '₹', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$' };
    $('#currencySymbol').textContent = symbols[activeCurrency] || `${activeCurrency} `;
    if (config.aiReady) $('#aiTag').textContent = 'AI READY';
    if (!config.paypalReady) payBtn.title = 'Set PayPal sandbox credentials in the environment to enable checkout.';
  } catch {}
}
extractBtn.addEventListener('click', async () => {
  showError(''); extractBtn.disabled = true; extractBtn.innerHTML = '<span>✦</span> Reading request…'; payBtn.disabled = true;
  try {
    const order = await api('/api/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: request.value.trim() }) });
    $('#item').value = order.item || 'Custom bakery order';
    $('#quantity').value = order.quantity || 1;
    $('#date').value = order.date || '';
    $('#details').value = order.details || '';
    $('#budget').value = order.budget == null ? 'Not specified' : formatMoney(order.budget, activeCurrency);
    if (order.budget != null) $('#amount').value = order.budget;
    $('#aiTag').textContent = order.aiMode === 'live' ? 'AI DRAFT' : 'SAMPLE PARSE';
    const clarification = $('#clarification'); clarification.textContent = order.clarification || ''; clarification.hidden = !order.clarification;
    extracted = true; payBtn.disabled = !paypalReady;
    if (!paypalReady) showError('Add PayPal sandbox credentials to enable checkout. See the README setup steps.');
  } catch (err) { showError(err.message); }
  finally { extractBtn.disabled = false; extractBtn.innerHTML = '<span>✦</span> Turn into an order <span class="arrow">→</span>'; }
});
payBtn.addEventListener('click', async () => {
  if (!extracted) return;
  showError(''); payBtn.disabled = true; payBtn.innerHTML = '<span class="pay-mark">P</span> Connecting to PayPal…';
  try {
    const amount = Number($('#amount').value);
    const description = `${$('#quantity').value} ${$('#item').value} — ${$('#details').value}`;
    const order = await api('/api/paypal/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount, description }) });
    if (!order.approveUrl) throw new Error('PayPal did not return a checkout link.');
    location.href = order.approveUrl;
  } catch (err) { showError(err.message); payBtn.disabled = false; payBtn.innerHTML = '<span class="pay-mark">P</span> Create PayPal checkout <span class="arrow">→</span>'; }
});
$('#exampleBtn').addEventListener('click', () => { request.value = 'Can you make a small birthday cake for 10 people next Friday? Chocolate, simple floral decoration, budget around $65.'; request.focus(); });
async function handleReturn() {
  const params = new URLSearchParams(location.search);
  if (params.get('payment') === 'success' && params.get('token')) {
    $('#successPanel').hidden = false; $('#successTitle').textContent = 'Completing sandbox payment…';
    try { const result = await api(`/api/paypal/capture?token=${encodeURIComponent(params.get('token'))}`); $('#successTitle').textContent = result.status === 'COMPLETED' ? 'Payment complete' : `Payment ${result.status.toLowerCase()}`; $('#successText').textContent = `Order ${result.id} is ready for the seller.`; }
    catch (err) { $('#successTitle').textContent = 'Checkout approved'; $('#successText').textContent = `Capture needs attention: ${err.message}`; }
    history.replaceState({}, '', '/');
  } else if (params.get('payment') === 'cancelled') { $('#successPanel').hidden = false; $('#successTitle').textContent = 'Checkout cancelled'; $('#successText').textContent = 'No sandbox payment was captured. You can create a new checkout.'; history.replaceState({}, '', '/'); }
}
loadConfig(); handleReturn();
