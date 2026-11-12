const base = process.env.QA_BASE || 'http://127.0.0.1:3011';
const results = [];
let cookie = '';

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

async function call(method, path, body) {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const item of setCookies) {
    const part = item.split(';')[0];
    const name = part.split('=')[0];
    const others = cookie.split('; ').filter((entry) => entry && !entry.startsWith(name + '='));
    cookie = [...others, part].join('; ');
  }
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
  return { status: response.status, json };
}

function weekdayAhead(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const health = await call('GET', '/api/health');
record('health', health.status === 200 && health.json?.ok === true, `status ${health.status}`);

const setup = await call('POST', '/api/setup', {
  name: 'QA Owner',
  email: 'qa-owner@smilecare.test',
  password: 'OwnerPass123',
  businessName: 'QA Dental Clinic',
});
record('setup owner', setup.status === 201, `status ${setup.status} ${setup.json?.error?.message || ''}`);

const login = await call('POST', '/api/auth/login', { email: 'qa-owner@smilecare.test', password: 'OwnerPass123' });
record('login', login.status === 200 && Boolean(cookie.includes('sid=')), `status ${login.status}`);

const branches = await call('GET', '/api/branches');
const branchId = branches.json?.[0]?.id;
record('branches', branches.status === 200 && Boolean(branchId), `status ${branches.status} branch ${branchId || 'none'}`);

const doctor = await call('POST', '/api/doctors', {
  name: 'Dr. Sara Nabil',
  role: 'Dentist',
  email: 'sara@smilecare.test',
  phone: '01000000011',
  branchIds: [branchId],
});
record('create doctor', doctor.status === 201, `status ${doctor.status} ${doctor.json?.error?.message || doctor.json?.id || ''}`);

const service = await call('POST', '/api/services', {
  name: 'Exam',
  description: 'Check-up',
  duration: 30,
  price: 500,
  category: 'General',
  branchIds: [branchId],
});
record('create service', service.status === 201, `status ${service.status} ${service.json?.error?.message || service.json?.id || ''}`);

const patient = await call('POST', '/api/patients', {
  fullName: 'Mona Adel',
  phone: '01000000022',
  email: 'mona@example.com',
});
record('create patient', patient.status === 201, `status ${patient.status} ${patient.json?.error?.message || patient.json?.id || ''}`);

const day = weekdayAhead(3);
const appointment = await call('POST', '/api/appointments', {
  branchId,
  customerId: patient.json.id,
  serviceId: service.json.id,
  employeeId: doctor.json.id,
  date: day,
  time: '10:00',
  duration: 30,
  status: 'Pending',
  paymentStatus: 'Unpaid',
  paymentDetails: { method: 'Cash', amount: 500 },
});
record('create appointment', appointment.status === 201, `status ${appointment.status} ${appointment.json?.error?.message || appointment.json?.id || ''}`);

const confirmed = await call('PATCH', `/api/appointments/${appointment.json?.id}`, { status: 'Confirmed' });
record('confirm appointment', confirmed.status === 200 && confirmed.json?.status === 'Confirmed', `status ${confirmed.status} ${confirmed.json?.status || confirmed.json?.error?.message || ''}`);

const listed = await call('GET', '/api/appointments');
record('list appointments', listed.status === 200 && Array.isArray(listed.json) && listed.json.length === 1, `count ${listed.json?.length}`);

const chart = await call('PUT', `/api/patients/${patient.json.id}/odontogram`, {
  teeth: [{ tooth: '16', condition: 'Caries', note: 'occlusal' }],
});
record('tooth chart', chart.status === 200, `status ${chart.status} ${chart.json?.error?.message || ''}`);

const visit = await call('POST', `/api/patients/${patient.json.id}/visits`, {
  visitedOn: day,
  complaint: 'Sensitivity',
  diagnosis: 'Caries 16',
  treatment: 'Filling planned',
});
record('visit note', visit.status === 201, `status ${visit.status} ${visit.json?.error?.message || ''}`);

const payment = await call('POST', `/api/patients/${patient.json.id}/payments`, {
  amount: 200,
  method: 'Cash',
  note: 'deposit',
});
record('record payment', payment.status === 201, `status ${payment.status} ${payment.json?.error?.message || ''}`);

const balance = await call('GET', `/api/patients/${patient.json.id}/balance`);
record('balance', balance.status === 200 && balance.json?.balance === 300, JSON.stringify(balance.json));

const settings = await call('PATCH', '/api/settings', {
  language: 'ar',
  currency: 'EGP',
  telegramBotUsername: 'SmileCareClinicBot',
  telegramChatId: '555',
  telegramReminderHours: 12,
  telegramEnabled: false,
  telegramBotToken: '123456789:AA-qa-token-not-real-value',
  whatsappPhoneNumberId: '123456789012345',
  whatsappBusinessAccountId: '998877665544',
  whatsappTestRecipient: '201012345678',
  whatsappAccessToken: 'EAAB-qa-whatsapp-token-not-real-value',
});
const settingsText = JSON.stringify(settings.json);
const secretsHidden = !settingsText.includes('AA-qa-token') && !settingsText.includes('EAAB-qa-whatsapp');
record('save messaging settings', settings.status === 200 && secretsHidden && settings.json?.whatsappTokenSet === true && settings.json?.telegramReminderHours === 12, `status ${settings.status} tokenSet ${settings.json?.whatsappTokenSet} leaked ${!secretsHidden}`);

const wa = await call('POST', '/api/settings/whatsapp-test');
record('whatsapp test does not fake delivery', wa.status !== 200 && wa.json?.delivered !== true, `status ${wa.status} ${wa.json?.error?.message || ''}`);

const tg = await call('POST', '/api/settings/telegram-test');
record('telegram test does not fake delivery', tg.status !== 200 && tg.json?.delivered !== true, `status ${tg.status} ${tg.json?.error?.message || ''}`);

const clinic = await call('GET', '/api/public/clinic');
record('public clinic', clinic.status === 200 && clinic.json?.businessName === 'QA Dental Clinic', clinic.json?.businessName || clinic.status);

const slots = await call('GET', `/api/public/slots?branchId=${branchId}&doctorId=${doctor.json.id}&serviceId=${service.json.id}&date=${day}`);
const open = Array.isArray(slots.json?.slots) && slots.json.slots.includes('11:00') && !slots.json.slots.includes('10:00');
record('public slots hide booked time', slots.status === 200 && open, `status ${slots.status} slots ${(slots.json?.slots || []).join(',')}`);

const booking = await call('POST', '/api/public/bookings', {
  fullName: 'Yara Hassan',
  phone: '01000000033',
  email: 'yara@example.com',
  branchId,
  doctorId: String(doctor.json.id),
  serviceId: String(service.json.id),
  date: day,
  time: '11:00',
  notes: '',
  consent: true,
  companyWebsite: '',
});
record('public booking', booking.status === 201 && Boolean(booking.json?.reference) && Boolean(booking.json?.manageToken), `status ${booking.status} ${booking.json?.error?.message || booking.json?.reference || ''}`);

const duplicate = await call('POST', '/api/public/bookings', {
  fullName: 'Other Person',
  phone: '01000000044',
  email: 'other@example.com',
  branchId,
  doctorId: String(doctor.json.id),
  serviceId: String(service.json.id),
  date: day,
  time: '11:00',
  consent: true,
});
record('double book rejected', duplicate.status >= 400, `status ${duplicate.status}`);

const holiday = await call('POST', '/api/holidays', { branchId, date: weekdayAhead(8), label: 'Clinic holiday', preventBookings: true });
record('closure', holiday.status === 201, `status ${holiday.status} ${holiday.json?.error?.message || ''}`);

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
