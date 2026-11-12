const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const PAYPAL_BASE = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function extractOrder(text) {
  if (process.env.OPENAI_API_KEY) {
    const response = await fetch(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Extract a custom bakery order into JSON with keys: item, quantity (number), date, details, budget (number or null), clarification (string). Never invent a price. If absent, use null/empty string. Return JSON only.' },
          { role: 'user', content: text }
        ] })
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = data?.error?.message || data?.message || 'Check your API project limits and billing.';
      const code = data?.error?.code ? ` [${data.error.code}]` : '';
      throw new Error(`AI request failed (${response.status}): ${detail}${code}`);
    }
    return { ...JSON.parse(data.choices[0].message.content), aiMode: 'live' };
  }
  // Local fallback keeps the prototype usable before an AI key is configured.
  const quantity = Number((text.match(/\b(\d+)\b/) || [])[1]) || 12;
  const budgetMatch = text.match(/(?:under|below|budget(?: of)?|₹|\$|€|£|rs\.?|inr)\s*[₹$€£]?\s*(\d[\d,]*)/i);
  const budget = budgetMatch ? Number(budgetMatch[1].replace(/,/g, '')) : null;
  const flavors = ['chocolate', 'vanilla', 'strawberry', 'red velvet'].filter(x => text.toLowerCase().includes(x));
  const datePattern = /\b(?:(?:next|this)\s+)?(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/i;
  const date = (text.match(datePattern) || [''])[0];
  return { item: /cupcake/i.test(text) ? 'Custom cupcakes' : /cake/i.test(text) ? 'Custom cake' : 'Custom bakery order', quantity,
    date, details: flavors.length ? flavors.join(' and ') : text.slice(0, 140), budget,
    clarification: date ? '' : 'Please confirm the pickup or delivery date.', aiMode: 'sample' };
}

async function paypalToken() {
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to enable PayPal sandbox checkout.');
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, { method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || 'PayPal authentication failed.');
  return data.access_token;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { aiReady: !!process.env.OPENAI_API_KEY, paypalReady: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET), currency: process.env.CURRENCY || 'USD' });
    if (req.method === 'POST' && url.pathname === '/api/extract') {
      const { text } = await body(req);
      if (!text || text.length > 2000) return json(res, 400, { error: 'Enter an order request under 2,000 characters.' });
      return json(res, 200, await extractOrder(text));
    }
    if (req.method === 'POST' && url.pathname === '/api/paypal/order') {
      const { amount, description } = await body(req);
      const total = Number(amount);
      if (!Number.isFinite(total) || total < 1 || total > 10000) return json(res, 400, { error: 'Enter a valid amount between 1 and 10,000.' });
      const token = await paypalToken();
      const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, { method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ description: String(description || 'Custom bakery order').slice(0, 127), amount: { currency_code: process.env.CURRENCY || 'USD', value: total.toFixed(2) } }],
          application_context: { brand_name: 'SellerSidekick', user_action: 'PAY_NOW', return_url: `${url.origin}/?payment=success`, cancel_url: `${url.origin}/?payment=cancelled` } }) });
      const data = await response.json();
      if (!response.ok) return json(res, response.status, { error: data.message || 'PayPal could not create the order.' });
      return json(res, 200, { id: data.id, approveUrl: data.links.find(x => x.rel === 'approve')?.href });
    }
    if (req.method === 'GET' && url.pathname === '/api/paypal/capture') {
      const orderId = url.searchParams.get('token');
      if (!orderId) return json(res, 400, { error: 'Missing PayPal order token.' });
      const token = await paypalToken();
      const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
      const data = await response.json();
      if (!response.ok) return json(res, response.status, { error: data.message || 'Payment capture failed.' });
      return json(res, 200, { status: data.status, id: data.id });
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const target = path.resolve(ROOT, file);
    if (!target.startsWith(ROOT + path.sep)) return json(res, 403, { error: 'Forbidden' });
    fs.readFile(target, (err, content) => {
      if (err) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream' }); res.end(content);
    });
  } catch (error) { json(res, 500, { error: error.message || 'Unexpected server error.' }); }
});

server.listen(PORT, () => console.log(`SellerSidekick running at http://localhost:${PORT}`));
