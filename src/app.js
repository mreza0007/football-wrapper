'use strict';

const express = require('express');
const healthRoutes = require('./routes/healthRoutes');
const competitionRoutes = require('./routes/competitionRoutes');
const matchRoutes = require('./routes/matchRoutes');
const notFoundHandler = require('./middleware/notFoundHandler');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
app.use(express.json());
app.use('/health', healthRoutes);
app.use('/competitions', competitionRoutes);
app.use('/matches', matchRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
