ALTER TABLE settings ADD COLUMN telegram_bot_username TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN telegram_reminder_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE settings ADD COLUMN whatsapp_phone_number_id TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN whatsapp_access_token TEXT;
ALTER TABLE settings ADD COLUMN whatsapp_business_account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN whatsapp_test_recipient TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN whatsapp_last_status TEXT NOT NULL DEFAULT '';
