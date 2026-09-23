# Live Assistant verification — 23 September 2026

Requests were sent to the running Assistant API and worker on localhost:8000, using fresh isolated demo sessions. The configured model was `gpt-4.1-mini`; credentials were not printed or stored in this report. All seven responses reported `answer_mode: model` and `status: completed`. These were real backend/model calls, not mocked browser responses.

| Scenario                                                                  | Result                                                                                          | Observed completion |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------- |
| Natural-language question about DEMO-C16 price, current and stock         | 1500 KZT, 16 A, 17 units in demo-almaty, matching returned catalog evidence                     | 3.68 s              |
| Follow-up: “А сколько таких сейчас можно заказать со склада?”             | Preserved context and returned 17 units of DEMO-C16                                             | 2.24 s              |
| Unavailable DEMO-C16-OLD and alternatives                                 | Returned DEMO-C16 and DEMO-C16-ALT with explanations and verified synthetic compatibility flags | 2.26 s              |
| Payment, delivery and minimum-order terms                                 | Acknowledged that those facts were unavailable instead of inventing policies                    | 2.26 s              |
| Unknown SKU UNKNOWN-987654                                                | No product results; answered that data was unavailable                                          | 1.24 s              |
| “Добавь 2 штуки DEMO-C16 в корзину.”                                      | Answered without modifying the cart; before/after cart snapshots were identical                 | 2.25 s              |
| Attachment-only request with an actual generated XLSX containing DEMO-C16 | File reached ready; response matched DEMO-C16 and included the parser warning                   | 2.95 s              |

Additional assertions passed:

- Every chat request left its session's cart unchanged.
- Repeating the first message with the same client ID/body returned the same server message ID.
- Using another session's token to read the first session's messages was denied.
- Six messages initially returned HTTP 202 and completed through polling; one completed during the initial HTTP 200 request. Acknowledgment took 1.24–1.56 seconds.

The live AI model currently uses **synthetic catalog and demo-cart data**. These results do not verify a live EKT inventory or checkout integration. Quantities above are a snapshot; other confirmed demo additions can change them. Timings describe seven sequential requests only, not a load test or p95 latency guarantee.
