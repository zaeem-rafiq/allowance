# PayPal docs for the coding agent

All files in `raw/` stay on the build Mac and are not in the repository. They were downloaded on November 7, 2026, from PayPal's own Markdown copies of its developer docs (the `.md` version of each page). The doc index is `raw/developer.paypal.com_llms.txt` (https://developer.paypal.com/llms.txt). Build from these files, and recheck a page online if the build disagrees with it.

## Files and what they are for

| File in `raw/` | Source URL | Used for |
|---|---|---|
| `page_api_payment-tokens_save-without-purchase_paypal.md` | https://developer.paypal.com/api/payment-tokens/save-without-purchase/paypal | Save the parent's PayPal once (setup token, then payment token) so the store can charge it later without the parent present |
| `page_sdk_save-without-purchase_paypal.md` | https://developer.paypal.com/sdk/save-without-purchase/paypal | The same save flow with the JavaScript SDK on the parent's approval screen |
| `page_api_save-with-purchase_test-integration.md` | https://developer.paypal.com/api/save-with-purchase/test-integration | Testing the saved-payment flow in the sandbox |
| `page_payment-methods_auth-honor.md` | https://developer.paypal.com/payment-methods/auth-honor | Fallback plan: a weekly hold (29-day authorization, 3-day honor period, reauthorization) |
| `page_checkout_delay-capture.md` | https://developer.paypal.com/checkout/delay-capture | Fallback plan: authorize now, capture later |
| `developer.paypal.com_docs_api_orders_v2.md` | https://developer.paypal.com/api/orders/v2 | Orders v2 operations; the full schema is at https://developer.paypal.com/api/orders/v2/schema.json |
| `page_api_customer-disputes_v1.md` | https://developer.paypal.com/api/customer-disputes/v1 | Disputes API operations, including provide evidence and make offer |
| `page_disputes_reasons-evidence.md` | https://developer.paypal.com/disputes/reasons-evidence | Which evidence fits which dispute reason |
| `page_disputes_disputes-lifecycle.md` | https://developer.paypal.com/disputes/disputes-lifecycle | Dispute stages and allowed actions |
| `page_disputes_set-up.md` | https://developer.paypal.com/disputes/set-up | Sandbox accounts for disputes, and buyer-side credentials |
| `page_disputes_test-go-live.md` | https://developer.paypal.com/disputes/test-go-live | Sandbox-only endpoints that create disputes and chargebacks |
| `page_api_webhooks_overview.md` | https://developer.paypal.com/api/webhooks/overview | Webhooks for captures and new disputes |
| `page_ai-tools_toolkit.md` | https://developer.paypal.com/ai-tools/toolkit | PayPal Agent Toolkit (`@paypal/agent-toolkit`) and the local PayPal MCP server (`@paypal/mcp`) |
| `page_ai-tools_agent-tools.md` | https://developer.paypal.com/ai-tools/agent-tools | Every Agent Toolkit tool and its parameters |
| `page_sdk_js_set-up.md` | https://developer.paypal.com/sdk/js/set-up | JavaScript SDK v6 setup |
| `page_agent-ready_overview.md` | https://developer.paypal.com/agent-ready/overview | PayPal's agent payment products, for the write-up's "how this relates" paragraph |
| `page_agent-ready_agentic-commerce-protocol.md` | https://developer.paypal.com/agent-ready/agentic-commerce-protocol | Same |
| `page_agent-ready_universal-commerce-protocol-with-paypal.md` | https://developer.paypal.com/agent-ready/universal-commerce-protocol-with-paypal | Same |

## Facts that shape the build

- **Saved PayPal needs eligibility.** The saved-payment page says the account must be "approved and have your account configured for billing agreements". Test this in hour 1. If the sandbox refuses, use the weekly-hold fallback.
- **Holds last 29 days.** The first 3 days are the honor period. Reauthorization restarts it within the 29 days.
- **Creating disputes by API needs extra scopes.** PayPal's sandbox has a sandbox-only `POST /v1/customer/disputes` endpoint. It needs the `DISPUTE_CREATE` scope, which only a PayPal account manager can add. Plan for disputes opened by hand from the sandbox buyer account in the sandbox Resolution Center. Use the API only if the scope is already present.
- **PayPal's own agent checkout is gated.** Agent Ready (ACP through Braintree, UCP through Google) needs registration with OpenAI or Google. So Allowance's mandate is its own format, shaped like the AP2 Intent Mandate. The write-up must say so.

## Official MCP servers and agent tools (listed, not installed)

These need the owner's approval before install:

- `@paypal/agent-toolkit` (npm): PayPal's tool definitions for agent frameworks, including the Vercel AI SDK and MCP. Adds ready-made dispute, refund and order tools.
- `@paypal/mcp` (npm, run with `npx`): PayPal's local MCP server. It lets a coding agent read the sandbox account (orders, disputes, invoices) in plain language while building.
