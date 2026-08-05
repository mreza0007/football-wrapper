'use strict';

require('dotenv').config();

const app = require('./app');

const port = process.env.PORT || 3060;

app.listen(port, () => {
  console.log(`Generic football wrapper listening on port ${port}`);
});
