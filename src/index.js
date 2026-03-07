require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS enabled for all origins
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Temporary storage for uploaded files (multer memoryStorage keeps files in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max per file
});

// Nodemailer transporter (timeouts so Render doesn't hang forever)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 15000,
  greetingTimeout: 10000,
});

/**
 * POST /api/send-email
 * Required: to (single email or array).
 * Optional: subject, body (text/HTML), attachment/document.
 */
app.post('/api/send-email', upload.any(), async (req, res) => {
  try {
    if (!process.env.EMAIL_USERNAME || !process.env.EMAIL_PASS) {
      return res.status(503).json({
        success: false,
        error: 'Email service not configured. Set EMAIL_USERNAME and EMAIL_PASS on the server.',
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

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USERNAME,
      to: recipients,
      subject: subjectStr,
    };
    if (bodyStr) {
      const isHtml = /<[a-z][\s\S]*>/i.test(bodyStr);
      mailOptions[isHtml ? 'html' : 'text'] = bodyStr;
    }

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
    if (attachments.length > 0) mailOptions.attachments = attachments;

    // Respond immediately so we don't timeout on Render (Gmail SMTP from their network can hang)
    res.status(202).json({
      success: true,
      message: 'Email accepted for delivery. It is being sent in the background.',
      to: recipients,
    });

    // Send in background; log errors (client already got 202)
    transporter.sendMail(mailOptions).then((info) => {
      console.log('Email sent:', info.messageId, info.accepted);
    }).catch((err) => {
      console.error('Background send failed:', err.message, err.code || '', err.response || '');
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
  if (!process.env.EMAIL_USERNAME || !process.env.EMAIL_PASS) {
    console.warn('WARNING: EMAIL_USERNAME or EMAIL_PASS not set. /api/send-email will return 503 until configured.');
  }
});
