require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const multer = require('multer');
const FormData = require('form-data');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 3000;

const maxFileSize = Number(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024; // default 10MB

// CORS enabled for all origins
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSize },
});

// Mailgun (HTTP API – works on Render)
const mailgunDomain = process.env.MAILGUN_DOMAIN;
const mailgunApiKey = process.env.MAILGUN_API_KEY;
const mailgunBaseUrl = (process.env.MAILGUN_BASE_URL || 'https://api.mailgun.net').replace(/\/$/, '');
const mailgunFrom = process.env.MAILGUN_FROM;
const useMailgun = !!(mailgunDomain && mailgunApiKey && mailgunFrom);

// Resend (HTTP API)
const resendApi = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Nodemailer: SMTP_* (explicit) or EMAIL_* / Gmail
const smtpHost = process.env.SMTP_HOST;
const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USERNAME;
const smtpPass = process.env.SMTP_PASSWORD || process.env.EMAIL_PASS;
const transporter = nodemailer.createTransport(
  smtpHost
    ? {
        host: smtpHost,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
        connectionTimeout: 15000,
        greetingTimeout: 10000,
      }
    : {
        service: 'gmail',
        auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
      }
);

/**
 * POST /api/send-email
 * Required: to (single email or array).
 * Optional: subject, body (text/HTML), attachment/document.
 */
async function sendViaMailgun(recipients, subjectStr, bodyStr, attachments) {
  const form = new FormData();
  form.append('from', mailgunFrom);
  form.append('to', recipients.join(', '));
  form.append('subject', subjectStr);
  if (bodyStr) {
    const isHtml = /<[a-z][\s\S]*>/i.test(bodyStr);
    form.append(isHtml ? 'html' : 'text', bodyStr);
  }
  attachments.forEach((a) => form.append('attachment', a.content, { filename: a.filename }));
  const auth = Buffer.from(`api:${mailgunApiKey}`).toString('base64');
  const url = `${mailgunBaseUrl}/v3/${mailgunDomain}/messages`;
  // Send as buffer so Mailgun gets valid multipart (fetch + form-data stream can be malformed)
  const bodyBuffer = form.getBuffer();
  const headers = {
    ...form.getHeaders(),
    Authorization: `Basic ${auth}`,
    'Content-Length': bodyBuffer.length,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: bodyBuffer,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Mailgun ${res.status}`);
  return data;
}

app.post('/api/send-email', upload.any(), async (req, res) => {
  try {
    const useMailgunNow = useMailgun;
    const useResend = !useMailgunNow && !!process.env.RESEND_API_KEY;
    const useSmtp = !useMailgunNow && !useResend && (smtpUser && smtpPass);

    if (!useMailgunNow && !useResend && !useSmtp) {
      return res.status(503).json({
        success: false,
        error: 'Email not configured. Set MAILGUN_API_KEY + MAILGUN_DOMAIN + MAILGUN_FROM, or RESEND_API_KEY, or SMTP_* / EMAIL_*.',
      });
    }

    const { to, subject, body, attachment: jsonAttachment } = req.body || {};

    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: to (at least one recipient email).',
      });
    }

    // Normalize recipients to array
    const recipients = Array.isArray(to)
      ? to
      : typeof to === 'string'
        ? to.split(',').map((e) => e.trim()).filter(Boolean)
        : [];

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one valid recipient (to) is required.',
      });
    }

    const subjectStr = subject != null ? String(subject).trim() : '';
    const bodyStr = body != null ? String(body) : '';

    // Attachments: from multipart upload (req.files) or from JSON (base64)
    const attachments = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => {
        attachments.push({
          filename: file.originalname || file.fieldname || 'attachment',
          content: file.buffer,
        });
      });
    }
    if (jsonAttachment) {
      const list = Array.isArray(jsonAttachment) ? jsonAttachment : [jsonAttachment];
      list.forEach((att) => {
        const filename = att.filename || att.name || 'document';
        const content = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content || '', 'base64');
        if (content.length) attachments.push({ filename, content });
      });
    }

    const provider = useMailgunNow ? 'mailgun' : useResend ? 'resend' : 'smtp';

    if (useMailgunNow) {
      const data = await sendViaMailgun(recipients, subjectStr, bodyStr, attachments);
      return res.status(200).json({
        success: true,
        message: 'Email sent successfully.',
        to: recipients,
        provider,
        messageId: data?.id,
      });
    }

    if (useResend) {
      const from = process.env.EMAIL_FROM || process.env.RESEND_FROM || 'onboarding@resend.dev';
      const payload = {
        from: from.includes('<') ? from : `${from.split('@')[0]} <${from}>`,
        to: recipients,
        subject: subjectStr,
        attachments: attachments.length ? attachments.map((a) => ({ filename: a.filename, content: a.content })) : undefined,
      };
      if (bodyStr) {
        const isHtml = /<[a-z][\s\S]*>/i.test(bodyStr);
        payload[isHtml ? 'html' : 'text'] = bodyStr;
      }
      const { data, error } = await resendApi.emails.send(payload);
      if (error) {
        return res.status(500).json({ success: false, error: error.message, provider });
      }
      return res.status(200).json({
        success: true,
        message: 'Email sent successfully.',
        to: recipients,
        provider,
        messageId: data?.id,
      });
    }

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USERNAME,
      to: recipients,
      subject: subjectStr,
    };
    if (bodyStr) {
      const isHtml = /<[a-z][\s\S]*>/i.test(bodyStr);
      mailOptions[isHtml ? 'html' : 'text'] = bodyStr;
    }
    if (attachments.length > 0) mailOptions.attachments = attachments;

    const info = await transporter.sendMail(mailOptions);
    return res.status(200).json({
      success: true,
      message: 'Email sent successfully.',
      to: recipients,
      provider,
      messageId: info.messageId,
      accepted: info.accepted,
    });
  } catch (err) {
    console.error('Send email error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to send email.',
    });
  }
});

// Root (for Render / load balancer health checks)
app.get('/', (req, res) => {
  res.json({ service: 'Email API', docs: '/api/send-email (POST)', health: '/health' });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Bind to 0.0.0.0 so Render (and other hosts) can reach the server
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Email API running on port ${PORT}`);
  console.log(`Send email: POST http://localhost:${PORT}/api/send-email`);
  const configured = useMailgun || process.env.RESEND_API_KEY || (smtpUser && smtpPass);
  if (!configured) {
    console.warn('WARNING: Set MAILGUN_* or RESEND_API_KEY or SMTP_* / EMAIL_* for /api/send-email.');
  }
});
