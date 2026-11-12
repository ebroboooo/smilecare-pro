# Manual QA — 12 Nov 2026

Checked on this computer after the messaging work. The clinic database at `server/data/smilecare.db` was not reset. Mutating API checks used a separate database, `server/data/qa-flow.db`, and an API on port 3011. The browser used the running site at http://localhost:5173 with the API on port 3001.

## API matrix (temporary database, 22/22 passed)

| Check | Result |
|---|---|
| Health | Pass |
| Create owner and sign in with the session cookie | Pass |
| List the default branch | Pass |
| Create a doctor, a service, and a patient | Pass |
| Book 10:00 and confirm it | Pass |
| List appointments | Pass |
| Save tooth 16 as Caries, a visit note, and a cash payment of 200 | Pass. Balance 500 due, 200 paid, 300 left |
| Save Telegram username, 12-hour reminder, and WhatsApp ids | Pass. Neither token appeared in the settings JSON |
| WhatsApp test with a fake token | Pass as a refusal. HTTP 502, “WhatsApp did not accept the message. Nothing was delivered.” |
| Telegram test with a fake token | Pass as a refusal. HTTP 502, “Telegram did not accept the test message” |
| Public clinic, slots, and a consented booking at 11:00 | Pass. 10:00 was omitted because it was already booked |
| Second booking of 11:00 | Pass. HTTP 409 |
| Add a closed day | Pass |

`npm test` covers the same secret rule: the WhatsApp token is not returned, and the test route in the test runner returns 501 instead of pretending a message was sent. `deliverWhatsApp` returns a message id only when the transport body contains `messages[0].id`.

## Browser (live clinic site)

| Screen | Result |
|---|---|
| Home after sign-in | Pass, after a JSX error on the dashboard was fixed. Today, coming visits, and next-step buttons render |
| Settings → Clinic | Pass. Name, EGP, Africa/Cairo, notice and slot fields |
| Settings → Integrations | Pass. Telegram username, chat id, reminder hours, write-only token, test button. WhatsApp phone number id, business account id, test number, write-only token, and the coming-soon patient-reminder note |
| Patients | Pass. Two patients, search, open file |
| Patient file | Pass. Tooth chart, visit note, payment form, download, and Telegram link |
| Calendar | Pass. Day, week, month, the doctor filter, closed days, and time away |
| Public booking `/book/smilecare-clinic` | Pass. English and Arabic, including RTL labels and “ج.م.” for EGP. The chosen day had no open time and the continue button stayed disabled |
| A real Telegram chat and a real WhatsApp chat | Not done. Fake tokens were rejected on purpose. No live bot was connected in this session |

## Not claimed

- Treatment plans, file attachments, and a medical-alert banner are still absent.
- Patient WhatsApp reminders are not sent.
- Playwright is not installed.
- Docker was not started.
