import type { Reservation } from '../types';
import { db } from '../db';

export class EnterpriseNotificationHub {
  static async dispatchBookingAlert(
    orgId: string,
    reservation: Reservation,
    customerName: string,
    serviceName: string,
    _employeeName: string,
    copy?: { title: string; message: string },
  ) {
    await db.notifications.create(orgId, {
      branchId: reservation.branchId,
      title: copy?.title || 'Appointment booked',
      message: copy?.message || `${customerName} booked ${serviceName} on ${reservation.date} at ${reservation.time}.`,
      read: false,
      type: 'BookingCreated',
    });
  }
}
