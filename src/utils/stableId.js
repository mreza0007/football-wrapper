'use strict';

const crypto = require('node:crypto');

function stableId(entityType, providerKey, externalId) {
  const type = String(entityType).trim().toLowerCase();
  const provider = String(providerKey).trim().toLowerCase();
  const external = String(externalId).trim();

  if (!type || !provider || !external) {
    throw new TypeError('Stable ID inputs must be non-empty');
  }

  const hash = crypto
    .createHash('sha256')
    .update(`${type}\u0000${provider}\u0000${external}`)
    .digest('hex')
    .slice(0, 24);

  return `mp_${type}_${hash}`;
}

module.exports = stableId;
