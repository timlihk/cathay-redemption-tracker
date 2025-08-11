import nodemailer from 'nodemailer';
import { config } from './config.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
});

export async function sendEmail(to: string, subject: string, html: string) {
  if (!config.smtp.host) {
    console.warn('SMTP not configured, skip email');
    return;
  }
  await transporter.sendMail({ from: config.smtp.from, to, subject, html });
}