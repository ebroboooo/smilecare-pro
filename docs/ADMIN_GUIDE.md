# Admin guide

Three roles. The server enforces them. A doctor who calls an owner route receives 403.

| Role | What they do |
|---|---|
| Owner | Settings, staff accounts, reports, anonymize a patient, record payments |
| Reception | Patients, calendar, inquiries, waiting list, payments |
| Doctor | Their appointments, the tooth chart, and visit notes. They can see a balance. They cannot record a payment |

## English

- **Home** is today: who is coming, and buttons for a new appointment or a new patient.
- **Calendar** is where you book, confirm, complete, or cancel. Closed days and a doctor's time away are on the same page.
- **Patients** holds the phone, the tooth chart, visit notes, and payments. Download file exports one patient. Remove name and contact is owner-only and keeps the visit history.
- **Inquiries** are messages from the public contact form.
- **Waiting list** is for someone who wants a time when the day is full. Give them the first open slot in the part of the day they asked for.
- **Settings → Clinic** is the name, language, currency, and how far ahead patients may book.
- **Settings → Integrations** is Telegram, and the WhatsApp connection. Read `docs/MESSAGING.md` before pasting a token.
- The language buttons in the staff header switch the screens without a second account. The public site has its own English / العربية switch.

Payment is cash or card at the clinic. There is no online card charge.

## العربية

ثلاثة أدوار. الخادم يفرضها. الطبيب الذي يطلب مسار المالك يستلم 403.

| الدور | ما يفعله |
|---|---|
| المالك | الإعدادات، حسابات الموظفين، التقارير، إخفاء اسم المريض، تسجيل المدفوعات |
| الاستقبال | المرضى، التقويم، الاستفسارات، قائمة الانتظار، المدفوعات |
| الطبيب | مواعيده، مخطط الأسنان، ملاحظات الزيارة. يرى المتبقي. لا يسجّل دفعة |

- **الرئيسية** هي اليوم: من القادم، وأزرار لموعد جديد أو مريض جديد.
- **التقويم** مكان الحجز والتأكيد والإتمام والإلغاء. أيام الإغلاق وغياب الطبيب في الصفحة نفسها.
- **المرضى** فيه الهاتف ومخطط الأسنان وملاحظات الزيارة والمدفوعات. تنزيل الملف يصدّر مريضاً واحداً. إزالة الاسم وبيانات التواصل للمالك فقط، ويبقى سجل الزيارات.
- **الاستفسارات** رسائل نموذج التواصل في الموقع.
- **قائمة الانتظار** لمن يريد وقتاً واليوم ممتلئ. أعطهم أول وقت مفتوح في الفترة التي طلبوها.
- **الإعدادات → العيادة** للاسم واللغة والعملة ومدى الحجز المسبق.
- **الإعدادات → الربط** لتيليجرام واتصال واتساب. اقرأ `docs/MESSAGING.md` قبل لصق أي رمز.
- أزرار اللغة في شريط الموظفين تبدّل الشاشات. الموقع العام له زر English / العربية خاص به.

الدفع نقداً أو بالبطاقة في العيادة. لا يوجد سحب بطاقة عبر الإنترنت.
