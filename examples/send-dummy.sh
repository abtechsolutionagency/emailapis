#!/usr/bin/env bash
# Dummy request: multiple recipients + body + document attachment
# Run from project root: ./examples/send-dummy.sh

curl -X POST http://localhost:3000/api/send-email \
  -F "to=recipient1@example.com" \
  -F "to=recipient2@example.com" \
  -F "to=recipient3@example.com" \
  -F "subject=Test email with document (multiple recipients)" \
  -F "body=Hi everyone,

This is a dummy email body.

It can be <b>plain text</b> or contain <em>HTML</em>.

Please find the dummy document attached.

Best regards" \
  -F "document=@dummy-document.txt"
