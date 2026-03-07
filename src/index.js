require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * POST /api/send-email
 * Body (multipart/form-data): to, subject, body, and file(s) with field name "attachment" or "document"
 * Body (application/json): to, subject, body, and optional attachment: { filename, content (base64) }
 */
app.post('/api/send-email', upload.any(), async (req, res) => {
  try {
    const { to, subject, body, attachment: jsonAttachment } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: to, subject, and body are required.',
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

    // Detect if body is HTML (simple heuristic: contains tags)
    const isHtml = /<[a-z][\s\S]*>/i.test(body);

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USERNAME,
      to: recipients,
      subject: subject.trim(),
      [isHtml ? 'html' : 'text']: body,
    };

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

    const info = await transporter.sendMail(mailOptions);

    res.status(200).json({
      success: true,
      message: 'Email sent successfully.',
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected || [],
    });
  } catch (err) {
    console.error('Send email error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to send email.',
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Email API running at http://localhost:${PORT}`);
  console.log(`Send email: POST http://localhost:${PORT}/api/send-email`);
});
