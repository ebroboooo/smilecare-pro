import React from 'react';
import { Link } from 'react-router-dom';

export const PrivacyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-6">
        <Link to="/" className="text-sm text-brand-700">Back to the clinic site</Link>
        <h1 className="text-3xl font-display font-bold text-slate-900">Privacy</h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          SmileCare Pro stores the details a clinic needs to book and treat patients: name, phone, email, appointments, tooth chart, visit notes, and payments taken at the clinic. This page describes how this installation works. It is not a legal certificate and it does not claim compliance with any privacy law.
        </p>
        <h2 className="text-xl font-semibold text-slate-900">What is stored</h2>
        <ul className="text-sm text-slate-700 list-disc ps-5 space-y-1">
          <li>Staff accounts, with passwords stored as a one-way hash.</li>
          <li>Patient contact details and the appointments they request or the clinic creates.</li>
          <li>Clinical notes the clinic chooses to record, including the tooth chart and visit records.</li>
          <li>Cash and card payments recorded at the clinic. Card numbers are not stored.</li>
        </ul>
        <h2 className="text-xl font-semibold text-slate-900">Who can see it</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Signed-in clinic staff can open patient records. A public booking page does not list other patients. The clinic owner can export a patient file or replace the name and contact details with an anonymized record. Anonymizing a record does not delete appointment history.
        </p>
        <h2 className="text-xl font-semibold text-slate-900">Booking requests</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          The public form asks for consent before a request is saved. Payment happens at the clinic. A booking reference lets the patient cancel or move a request with a private token that is not stored in plain text.
        </p>
        <p className="text-sm text-slate-500">Questions about a record should go to the clinic, not to the software vendor.</p>
      </div>
    </div>
  );
};
