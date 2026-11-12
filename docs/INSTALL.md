# Install

One clinic, one computer or one server. Node.js 22.

## English

```powershell
cd E:\Projects\Project2_reservation_system
powershell -File scripts\setup-clinic.ps1
npm install
npm run dev
```

Open http://localhost:5173. The first page creates the owner. After that, use **Staff sign in**.

`npm run dev` runs the API on port 3001 and the website on port 5173.

For a clinic machine that should keep running:

```powershell
npm run build
npm start
```

Set `SESSION_SECRET` in `server/.env` to a unique value of at least 32 characters before `NODE_ENV=production`. The sample secret is refused in production.

Copy the database with `docs/BACKUP.md`. Docker and a web server sample are in `docs/DEPLOY.md`.

Do not turn on demo mode (`VITE_DEMO_MODE=true`) for real patients. That mode keeps data in the browser only.

## العربية

عيادة واحدة، جهاز واحد أو خادم واحد. يلزم Node.js 22.

```powershell
cd E:\Projects\Project2_reservation_system
powershell -File scripts\setup-clinic.ps1
npm install
npm run dev
```

افتح http://localhost:5173. الصفحة الأولى تنشئ حساب المالك. بعد ذلك استخدم دخول الموظفين.

`npm run dev` يشغّل الواجهة البرمجية على المنفذ 3001 والموقع على المنفذ 5173.

لجهاز العيادة الذي يبقى يعمل:

```powershell
npm run build
npm start
```

ضع `SESSION_SECRET` في `server/.env` بقيمة خاصة لا تقل عن ٣٢ حرفاً قبل تشغيل الإنتاج. السر التجريبي يُرفض في الإنتاج.

انسخ قاعدة البيانات حسب `docs/BACKUP.md`. مثال Docker وخادم الويب في `docs/DEPLOY.md`.

لا تفعّل الوضع التجريبي (`VITE_DEMO_MODE=true`) لمرضى حقيقيين. ذلك الوضع يبقي البيانات في المتصفح فقط.
