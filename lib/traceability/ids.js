const crypto = require('crypto');

function id(size = 10) {
  return crypto.randomBytes(Math.ceil(size * 0.75)).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, size);
}

function code(prefix, size = 6) {
  return `${prefix}-${id(size).toUpperCase()}`;
}

function now() {
  return new Date().toISOString();
}

module.exports = { id, code, now };
