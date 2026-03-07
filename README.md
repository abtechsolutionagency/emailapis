# Email API

Node.js API using Express and Nodemailer to send emails. CORS is enabled for all origins.

## Endpoint

**POST** `http://localhost:3000/api/send-email`

(Use your deployed base URL in production.)

## Environment variables

| Variable        | Description                    |
|----------------|--------------------------------|
| `PORT`         | Server port (default: 3000)    |
| `EMAIL_USERNAME` | Gmail address for SMTP auth  |
| `EMAIL_FROM`   | From address (defaults to EMAIL_USERNAME) |
| `EMAIL_PASS`   | Gmail app password             |

Copy `.env.example` to `.env` and fill in your values. For Gmail, use an [App Password](https://support.google.com/accounts/answer/185833), not your normal password.

## Request body

| Field      | Type              | Required | Description |
|-----------|-------------------|----------|-------------|
| `to`      | string or array   | Yes      | Single email, comma-separated string, or array of emails |
| `subject` | string            | Yes      | Email subject |
| `body`    | string            | Yes      | HTML or plain text body |
| `attachment` / `document` | file(s) or JSON | No | File(s) in multipart, or `{ filename, content }` (base64) in JSON |

## Postman

1. **Method:** `POST`
2. **URL:** `http://localhost:3000/api/send-email`
3. **Body:** choose **form-data** (not raw JSON).
4. Add these keys (leave **Key** and **Value**; set type to **Text** except for the file):

   | Key        | Type | Value |
   |------------|------|--------|
   | `to`       | Text | `recipient1@example.com,recipient2@example.com,recipient3@example.com` |
   | `subject`  | Text | `Test from Postman` |
   | `body`     | Text | `Hi everyone,<br><br>This is a <b>dummy</b> email body with a document attached.<br><br>Best regards` |
   | `document` | File | Select a file (e.g. `dummy-document.txt` or any PDF/image) |

   For **multiple recipients** you can instead add several rows with key `to` and one email per row.

5. Send the request. No **Authorization** or extra headers are required.

**Or import the collection:** in Postman, **Import** → **File** → choose `postman/Email-API.postman_collection.json`. Edit the **document** row to select a file, then send **Send email (multiple recipients + document)**.

## Examples

### cURL (multipart with file)

```bash
curl -X POST http://localhost:3000/api/send-email \
  -F "to=recipient@example.com" \
  -F "subject=Test" \
  -F "body=Hello, this is the email body." \
  -F "attachment=@/path/to/document.pdf"
```

### cURL (JSON, no attachment)

```bash
curl -X POST http://localhost:3000/api/send-email \
  -H "Content-Type: application/json" \
  -d '{"to":["a@example.com","b@example.com"],"subject":"Hi","body":"<p>HTML body</p>"}'
```

### JavaScript (fetch with FormData)

```js
const form = new FormData();
form.append('to', 'user@example.com');
form.append('subject', 'Report');
form.append('body', '<h1>Report</h1><p>See attachment.</p>');
form.append('attachment', fileInput.files[0]);

const res = await fetch('http://localhost:3000/api/send-email', {
  method: 'POST',
  body: form,
});
```

## Run

```bash
npm install
npm start
```

Dev with auto-reload: `npm run dev`

Health check: **GET** `http://localhost:3000/health`
