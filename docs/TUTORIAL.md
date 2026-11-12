# First day at the clinic

SmileCare Pro is the desk system for one dental clinic. Staff sign in. Patients book on the public page. Money is taken at the clinic, in cash or by card. Card numbers are not stored.

## English

1. On the clinic computer, follow `docs/INSTALL.md` until the site opens at http://localhost:5173.
2. If this is the first start, create the owner: clinic name, your name, email, and a password of at least 10 characters with a letter and a number. Write the password down. There is no default password.
3. Sign in.
4. Open **Settings**. Set the clinic name, phone, address, currency **EGP**, time zone **Africa/Cairo**, and language **Arabic** or **English**. The staff screens follow this language. Patients can still switch language on the public pages.
5. Open **Doctors**. Add each doctor, the days they work, and the lunch break. A doctor who is not marked working that day will not appear as available.
6. Open **Services**. Add the visit types patients can book, with the length in minutes and the price.
7. Open **Calendar** and choose **New appointment**. Pick the patient (add them first from **Patients** if they called), the service, the doctor, and an open time. Save it, then set the status to **Confirmed** when the patient agrees.
8. Give patients the booking link from **Booking page** in the top bar. They choose a service, a doctor, and an open time, and they must tick the consent box. The request arrives as **Pending**.
9. Open the patient file for the tooth chart, the visit note, and a payment. The balance is the visit fees minus what you recorded as paid.
10. Optional: connect Telegram with `docs/MESSAGING.md`. WhatsApp patient reminders are not sent yet. You can save the Meta connection and send a test to your own number.

## العربية

سمايل كير برو هو نظام مكتب عيادة أسنان واحدة. الموظفون يسجّلون الدخول. المريض يحجز من الصفحة العامة. الدفع يتم في العيادة نقداً أو بالبطاقة. أرقام البطاقات لا تُحفظ.

1. على جهاز العيادة، اتبع `docs/INSTALL.md` حتى يفتح الموقع على http://localhost:5173.
2. في أول تشغيل، أنشئ حساب المالك: اسم العيادة، اسمك، البريد، وكلمة مرور من ١٠ أحرف على الأقل فيها حرف ورقم. دوّن كلمة المرور. لا توجد كلمة مرور جاهزة.
3. سجّل الدخول.
4. افتح **الإعدادات**. اكتب اسم العيادة والهاتف والعنوان، واختر العملة **جنيه** والمنطقة الزمنية **Africa/Cairo** واللغة **العربية** أو **الإنجليزية**. شاشات الموظفين تتبع هذه اللغة. الزائر يستطيع تغيير اللغة في الصفحات العامة.
5. افتح **الأطباء**. أضف كل طبيب وأيام عمله وراحة الغداء. الطبيب غير الموجود في الجدول لن يظهر كمتاح.
6. افتح **الخدمات**. أضف أنواع الزيارة التي يحجزها المريض، مع المدة بالدقائق والسعر.
7. افتح **التقويم** واختر **موعد جديد**. اختر المريض (أضفه أولاً من **المرضى** إذا اتصل)، والخدمة، والطبيب، ووقتاً متاحاً. احفظ، ثم اجعل الحالة **مؤكد** عندما يوافق المريض.
8. أعطِ المرضى رابط الحجز من **صفحة الحجز** في الشريط العلوي. يختارون الخدمة والطبيب والوقت، ويجب تعليم مربع الموافقة. يصل الطلب بحالة **قيد الانتظار**.
9. افتح ملف المريض لمخطط الأسنان وملاحظة الزيارة والدفعة. المتبقي هو رسوم الزيارات ناقص ما سجّلتموه مدفوعاً.
10. اختياري: اربط تيليجرام من `docs/MESSAGING.md`. تذكيرات واتساب للمرضى لا تُرسل بعد. يمكن حفظ اتصال ميتا وإرسال اختبار إلى رقمك.
