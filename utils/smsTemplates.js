/* =========================================================
   SMS TEMPLATES
========================================================= */

import dayjs from "dayjs";

const MAX_SMS_LENGTH = 150;

const getFirstName = (fullName = "") => {
  return String(fullName).trim().split(/\s+/)[0] || "Sir/Madam";
};

const formatSmsDate = (date) => {
  const appointmentDate = dayjs(date);

  return appointmentDate.format("YYYY MMMM DD");
};

export const appointmentDetailsSMS = ({ date, appointmentNumber }) => {
  const smsDate = dayjs(date).format("DD.MM.YYYY");

  const formattedNumber = String(appointmentNumber || "").padStart(2, "0");

  return (
    `Dear Sir/Madam,\n` +
    `Your tentative appointment for Dr Bandu Ukwattage at Ivory Dental on ${smsDate} appt no ${formattedNumber}.\n` +
    `Thanking you for choosing Ivory Dental.\n` +
    `- Ivory Dental -`
  );
};

/**
 * Doctor Arrival SMS
 */
export const doctorArrivalSMS = () => {
  return (
    `Dear Sir/Madam,\n` +
    `Dr Bandu Ukwatta has arrived. Please proceed to the dental clinic according to your allocated number.\n` +
    `Thank You.\n` +
    `- Ivory Dental -`
  );
};

/**
 * Appointment Details / Confirmation SMS
 */

/**
 * E-Bill / Payment SMS
 */
export const eBillSMS = ({ patientName, total, paid, balance, billLink }) => {
  const firstName = getFirstName(patientName);

  return (
    `Dear Sir/Madam,\n\n` +
    `Total Rs.${total}, Paid Rs.${paid}, Bal Rs.${balance}.\n` +
    `Bill: ${billLink}\n\n` +
    `Contact: +94 71 144 9999\n` +
    `- Ivory Dental -`
  );
};
export const doctorDailySummarySMS = ({
  date,
  totalAppointments = 0,
  todayIncome = 0,
}) => {
  const smsDate = dayjs(date).format("DD.MM.YYYY");

  const income = Number(todayIncome || 0).toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    `IVORY DENTAL - DAILY SUMMARY\n` +
    `Date: ${smsDate}\n\n` +
    `Dear Dr. Bandu Ukwatta,\n\n` +
    `Today's Income: Rs.${income}\n\n` +
    `Thank you.\n` +
    `- Ivory Dental -`
  );
};

/* =========================================================
   CENTRAL TEMPLATE OBJECT
========================================================= */
export const doctorDailyCollectionSMS = ({
  date,
  total = 0,
  full = 0,
  installments = 0,
  count = 0,
}) => {
  const smsDate = dayjs(date).format("DD.MM.YYYY");

  const formatAmount = (value) =>
    Number(value || 0).toLocaleString("en-LK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    `IVORY DENTAL - DAILY COLLECTION\n` +
    `Date: ${smsDate}\n\n` +
    `Dear Dr. Bandu Ukwatta,\n\n` +
    `Total: Rs.${formatAmount(total)}\n` +
    `Full: Rs.${formatAmount(full)}\n` +
    `Installments: Rs.${formatAmount(installments)}\n` +
    `Payments: ${count}\n\n` +
    `- Ivory Dental -`
  );
};
const SMS_TEMPLATES = {
  doctorArrival: doctorArrivalSMS,
  appointmentDetails: appointmentDetailsSMS,
  doctorDailySummary: doctorDailySummarySMS,
  doctorDailyCollection: doctorDailyCollectionSMS,
  eBill: eBillSMS,
};
/* =========================================================
   DOCTOR DAILY SUMMARY SMS
========================================================= */

/**
 * Doctor Daily Collection SMS
 */

export default SMS_TEMPLATES;
