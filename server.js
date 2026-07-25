require('dotenv').config();
const express = require('express');
const path = require('path');

const apiRoutes = require('./routes/api');
const qrRoutes = require('./routes/qr');
const traceabilityRoutes = require('./routes/traceability');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRoutes);
app.use('/api', qrRoutes);
// Export Traceability (batches / lots / gates) — separate dashboard at /export/
app.use('/api/traceability', traceabilityRoutes);

// Public lot passport short URL → export passport page
app.get('/t/:code', (req, res) => {
  res.redirect(
    302,
    `/export/passport.html?code=${encodeURIComponent(req.params.code)}`
  );
});

// Local / traditional hosting
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Agronexia running at http://localhost:${PORT}`);
    console.log(`  Greenhouse ops:        http://localhost:${PORT}/`);
    console.log(`  Export Traceability:   http://localhost:${PORT}/export/`);
  });
}

// Vercel / serverless: export the Express app
module.exports = app;
