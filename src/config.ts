import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT || 8080),
  baseUrl: process.env.BASE_URL || `http://localhost:8080`,
  cron: process.env.CRON_SCHEDULE || '0 * * * *',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'CX Monitor <noreply@example.com>'
  },
  playwright: {
    headful: process.env.PW_HEADFUL === '1',
    channel: process.env.PW_CHROMIUM_CHANNEL || undefined,
  }
};