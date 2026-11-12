# Messaging

Tokens stay on the clinic server. The website never receives them back. A test is a success only when Telegram or Meta accepts it. A rejected test is not marked as sent.

Patient WhatsApp reminders are **coming soon**. They are not sent. The WhatsApp form saves the Cloud API connection and can send one test to the number you type.

## Telegram — English

1. In Telegram, open `@BotFather`.
2. Send `/newbot`, then a display name and a username that ends in `bot`.
3. Copy the token BotFather shows. It looks like `123456789:AA...`.
4. In SmileCare, open **Settings → Integrations**.
5. Paste the bot username without `@`, the token, and the staff chat id.
6. Set **Hours before the visit** (1 to 72). The default is 24. One reminder is sent in that window.
7. Turn on **Send Telegram alerts** and choose **Save Telegram**.
8. Open the bot in Telegram, send `/start`, then choose **Send a test**. If Telegram rejects the token or the chat id, the screen says the test was not sent.
9. To find the staff chat id, send a message to the bot, then open `https://api.telegram.org/bot<token>/getUpdates` and read `chat.id`. Prefer a private staff chat, not a public group.
10. On a patient file, **Telegram link** gives a one-time `https://t.me/<bot>?start=...` link. The patient opens it once. Later reminders can go to that chat. The raw token is stored only as a hash.

Staff alerts for a new request include Confirm and Cancel buttons. The reminder loop runs inside the API process. It is not an external cron job.

## Telegram — العربية

1. في تيليجرام افتح `@BotFather`.
2. أرسل `/newbot` ثم اسم العرض واسم مستخدم ينتهي بـ `bot`.
3. انسخ الرمز الذي يعرضه BotFather. شكله مثل `123456789:AA...`.
4. في سمايل كير افتح **الإعدادات → الربط**.
5. الصق اسم المستخدم بدون `@`، والرمز، ومعرّف محادثة الموظفين.
6. حدّد **عدد الساعات قبل الزيارة** (من ١ إلى ٧٢). الافتراضي ٢٤. يُرسل تذكير واحد خلال هذه المدة.
7. فعّل **إرسال تنبيهات تيليجرام** ثم **حفظ تيليجرام**.
8. افتح البوت في تيليجرام وأرسل `/start` ثم اختر **إرسال تجربة**. إذا رفض تيليجرام الرمز أو المعرّف، تظهر رسالة أن التجربة لم تُرسل.
9. لمعرفة معرّف المحادثة، أرسل رسالة للبوت ثم افتح `https://api.telegram.org/bot<token>/getUpdates` واقرأ `chat.id`. الأفضل محادثة خاصة للموظفين لا مجموعة عامة.
10. من ملف المريض، **رابط تيليجرام** يعطي رابطاً لمرة واحدة `https://t.me/<bot>?start=...`. يفتحه المريض مرة واحدة. التذكير اللاحق يمكن أن يصل إلى تلك المحادثة. الرمز الخام يُحفظ كبصمة فقط.

تنبيه الطلب الجديد للموظفين فيه زرا تأكيد وإلغاء. حلقة التذكير تعمل داخل عملية الواجهة البرمجية، وليست جدولة خارجية.

## WhatsApp — English

This uses the Meta WhatsApp Cloud API. SmileCare does not send patient reminders yet. The badge on the form says **Coming soon**.

1. In Meta Business Suite, create a WhatsApp Business app and add the WhatsApp product.
2. In WhatsApp → API Setup, copy the **Phone number ID** and a temporary or permanent **access token**.
3. Optional: copy the **WhatsApp Business account ID**.
4. In SmileCare, paste those values. Type the test number as digits with the country code, for example `201012345678`, with no plus sign. Use your own WhatsApp.
5. Choose **Save**. Saving does not send a message.
6. Choose **Send a WhatsApp test**. The screen says Meta accepted it only if Meta returns a message id. Any other result says nothing was delivered.
7. The access token is write-only. Opening Settings again shows that a token is saved, not the token itself.

Do not promise patients a WhatsApp reminder until this screen no longer says coming soon.

## WhatsApp — العربية

هذا يستخدم واجهة واتساب السحابية من ميتا. سمايل كير لا يرسل تذكيرات للمرضى بعد. الشارة على النموذج تقول **قريباً**.

1. في Meta Business Suite أنشئ تطبيق واتساب للأعمال وأضف منتج واتساب.
2. من واتساب → إعداد الواجهة، انسخ **معرّف رقم الهاتف** و**رمز الوصول** المؤقت أو الدائم.
3. اختياري: انسخ **معرّف حساب الأعمال**.
4. في سمايل كير الصق هذه القيم. اكتب رقم الاختبار أرقاماً مع مفتاح الدولة، مثل `201012345678`، بدون علامة زائد. استخدم رقم واتساب الخاص بك.
5. اختر **حفظ**. الحفظ لا يرسل رسالة.
6. اختر **إرسال اختبار واتساب**. تظهر عبارة أن ميتا قبلت الرسالة فقط إذا أعادت ميتا معرّف رسالة. أي نتيجة أخرى تعني أنه لم يُسلَّم شيء.
7. رمز الوصول يُكتب فقط. عند فتح الإعدادات مرة أخرى يظهر أن رمزاً محفوظ، لا الرمز نفسه.

لا تعد المرضى بتذكير واتساب قبل أن تختفي عبارة «قريباً» من هذه الشاشة.
