# Permission matrix

Roles are `owner`, `receptionist`, and `doctor`. Every API route below is enforced on the server. The browser hides some screens, but hiding a screen is not the security control.

| Capability | Owner | Receptionist | Doctor |
|---|---|---|---|
| First-run setup | Public, once | Public, once | Public, once |
| Sign in, sign out, own password | Yes | Yes | Yes |
| Create and deactivate staff | Yes | No | No |
| Reset another person's password | Yes | No | No |
| Change clinic settings | Yes | No | No |
| Read clinic branding / language / booking rules | Yes | Yes | Yes |
| Read Telegram / WhatsApp connection fields | Yes | No | No |
| Read patients, doctors, services, branches | Yes | Yes | Yes |
| Create or edit patients | Yes | Yes | No |
| Create or edit appointments | Yes | Yes | No |
| Create or edit services, doctors, waitlist, inquiries | Yes | Yes | No |
| Read the activity log | Yes | Yes | Yes |
| Add an activity entry | Yes | Yes | Yes |
| Delete or edit an activity entry | No | No | No |
| Update the tooth chart or a visit note | Yes | Yes | Yes |
| Record a payment | Yes | Yes | No |
| Export one patient record | Yes | Yes | Yes |
| Anonymize a patient | Yes | No | No |
| Save Telegram settings or send a test | Yes | No | No |

A doctor who calls an owner or receptionist route receives **403**. A signed-out request receives **401**. A temporary password must be changed before any other clinic route will succeed.

Activity entries are append-only. There is no update or delete API for them.
