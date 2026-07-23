require('dotenv').config();
const express = require('express');
const path = require('path');

const apiRoutes = require('./routes/api');
const qrRoutes = require('./routes/qr');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', apiRoutes);
app.use('/api', qrRoutes);

// Local / traditional hosting
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Greenhouse dashboard running at http://localhost:${PORT}`);
  });
}

// Vercel / serverless: export the Express app
module.exports = app;
