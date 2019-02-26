const got = require('got');
const _get = require('lodash.get');
const publicIp = require('public-ip');
const { createErrorType } = require('@cumulus/common/errors');
const { deprecate } = require('@cumulus/common/util');

// getUrl, getHost and hostId is not part of the public cmr-client API
const { getUrl, getHost, hostId } = require('@cumulus/cmr-client/getUrl');
// validate is not part of the public cmr-client API
const { validate } = require('@cumulus/cmr-client/ingestConcept');

const ValidationError = createErrorType('ValidationError');

const xmlParseOptions = {
  ignoreAttrs: true,
  mergeAttrs: true,
  explicitArray: false
};

/**
 * Find the UMM version as a decimal string.
 * If a version cannot be found on the input object
 * version 1.4 is assumed and returned.
 *
 * @deprecated
 *
 * @param {Object} umm - UMM metadata object
 * @returns {string} UMM version for the given object
 */
function ummVersion(umm) {
  deprecate('@cumulus/cmrjs/utils#ummVersion', '1.11.1');
  return _get(umm, 'MetadataSpecification.Version', '1.4');
}

/**
 * Posts a given xml string to the validate endpoint of CMR
 * and promises true of valid.
 *
 * @deprecated
 *
 * @param {string} ummMetadata - the UMM object
 * @param {string} identifier - the document identifier
 * @param {string} provider - the CMR provider
 * @returns {Promise<boolean>} returns true if the document is valid
 */
async function validateUMMG(ummMetadata, identifier, provider) {
  deprecate('@cumulus/cmrjs/utils#validateUMMG', '1.11.1');
  const version = ummVersion(ummMetadata);
  let result;

  try {
    result = await got.post(`${getUrl('validate', provider)}granule/${identifier}`, {
      json: true,
      body: ummMetadata,
      headers: {
        Accept: 'application/json',
        'Content-type': `application/vnd.nasa.cmr.umm+json;version=${version}`
      }
    });

    if (result.statusCode === 200) {
      return true;
    }
  }
  catch (e) {
    result = e.response;
  }

  throw new ValidationError(
    `Validation was not successful. UMM metadata Object: ${JSON.stringify(ummMetadata)}`
  );
}

/**
 * Returns IP address.
 *
 * For Lambdas which are launched into a private subnet, no public IP is available
 * and the function falls back to an environment variable, if defined, and  a
 * static string if not defined. The value returned should be a valid IP address or
 * else the request for a CMR token will fail.
 *
 * @deprecated
 *
 * @returns {string} IP address
 */
async function getIp() {
  return publicIp.v4()
    .catch((err) => {
      if (err.message === 'Query timed out') {
        return process.env.USER_IP_ADDRESS || '10.0.0.0';
      }

      throw err;
    });
}

/**
 * Returns a valid a CMR token
 *
 * @deprecated
 *
 * @param {string} cmrProvider - the CMR provider id
 * @param {string} clientId - the CMR clientId
 * @param {string} username - CMR username
 * @param {string} password - CMR password
 * @returns {Promise.<string>} the token
 */
async function updateToken(cmrProvider, clientId, username, password) {
  if (!cmrProvider) throw new Error('cmrProvider is required.');
  if (!clientId) throw new Error('clientId is required.');
  if (!username) throw new Error('username is required.');
  if (!password) throw new Error('password is required.');

  // Update the saved ECHO token
  // for info on how to add collections to CMR: https://cmr.earthdata.nasa.gov/ingest/site/ingest_api_docs.html#validate-collection
  let response;

  try {
    response = await got.post(getUrl('token'), {
      json: true,
      body: {
        token: {
          username: username,
          password: password,
          client_id: clientId,
          user_ip_address: await getIp(),
          provider: cmrProvider
        }
      }
    });
  }
  catch (err) {
    if (err.response.body.errors) throw new Error(`CMR Error: ${err.response.body.errors[0]}`);
    throw err;
  }

  if (!response.body.token) throw new Error('Authentication with CMR failed');

  return response.body.token.id;
}

module.exports = {
  ValidationError,
  getHost,
  getIp,
  getUrl,
  hostId,
  ummVersion,
  updateToken,
  validate,
  validateUMMG,
  xmlParseOptions
};
