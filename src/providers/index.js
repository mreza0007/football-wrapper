'use strict';

const varzesh3 = require('./varzesh3');

const providers = {
  [varzesh3.providerKey]: varzesh3
};

function getProvider(providerKey) {
  const normalizedKey =
    typeof providerKey === 'string' ? providerKey.trim().toLowerCase() : '';
  return providers[normalizedKey] || null;
}

module.exports = { providers, getProvider };
