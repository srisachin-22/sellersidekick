# SellerSidekick

SellerSidekick turns a custom bakery request into a seller-editable quote and PayPal sandbox checkout. The seller approves the details and price before the app creates a PayPal order.

## Run locally

Requires Node.js 18 or later. No package install is needed.

```sh
node server.js
```

Open http://localhost:3000. Without keys, the app uses a visible local sample parser and disables checkout until PayPal credentials are configured.

## Enable AI extraction

Set `OPENAI_API_KEY` in the environment before starting the server. Optional: set `OPENAI_MODEL` (defaults to `gpt-4o-mini`) and `OPENAI_BASE_URL` (defaults to OpenAI's chat completions endpoint). The model is asked to extract order fields as JSON; it does not set the price.

## Enable PayPal sandbox checkout

Create a sandbox app in the PayPal Developer dashboard and set:

```sh
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_secret
```

Optional: set `CURRENCY` (defaults to `USD`; common values include `INR`, `EUR`, and `GBP`) and `PORT` (defaults to `3000`). Start the server, create a quote, review/edit the amount, then choose **Create PayPal checkout**. Approve the order with a PayPal sandbox buyer account. The app captures the approved order on return.

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Local server port | `3000` |
| `OPENAI_API_KEY` | Enables live AI extraction | unset (sample parser) |
| `OPENAI_MODEL` | Chat completions model | `gpt-4o-mini` |
| `OPENAI_BASE_URL` | Chat completions endpoint | `https://api.openai.com/v1/chat/completions` |
| `PAYPAL_CLIENT_ID` | PayPal sandbox app client ID | unset |
| `PAYPAL_CLIENT_SECRET` | PayPal sandbox app secret | unset |
| `PAYPAL_BASE_URL` | PayPal API base | `https://api-m.sandbox.paypal.com` |
| `CURRENCY` | Quote and PayPal order currency | `USD` |

Never commit credentials. The server keeps PayPal secrets out of browser code.
