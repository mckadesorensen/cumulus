'use strict';

const test = require('ava');
const rewire = require('rewire');
const sinon = require('sinon');

const awsServices = require('@cumulus/aws-client/services');
const s3 = require('@cumulus/aws-client/S3');
const { randomId } = require('@cumulus/common/test-utils');

const indexer = rewire('../../es/indexer');
const Collection = require('../../es/collections');
const { Search } = require('../../es/search');
const models = require('../../models');
const { fakeGranuleFactoryV2, fakeCollectionFactory } = require('../../lib/testUtils');
const { bootstrapElasticSearch } = require('../../lambdas/bootstrap');

const collectionTable = randomId('collectionsTable');
const granuleTable = randomId('granulesTable');

process.env.system_bucket = randomId('systemBucket');
process.env.stackName = randomId('stackName');

let esClient;
let esAlias;
let esIndex;
let collectionModel;
let granuleModel;

// Before each test create a new index and use that since it's very important for
// these tests to test a clean ES index
test.before(async (t) => {
  // create the tables
  process.env.CollectionsTable = collectionTable;
  collectionModel = new models.Collection();
  await collectionModel.createTable();

  process.env.GranulesTable = granuleTable;
  granuleModel = new models.Granule();
  await granuleModel.createTable();

  // create buckets
  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  esAlias = randomId('esalias');
  esIndex = randomId('esindex');
  process.env.ES_INDEX = esAlias;

  // create the elasticsearch index and add mapping
  await bootstrapElasticSearch('fakehost', esIndex, esAlias);
  esClient = await Search.es();

  await Promise.all([
    indexer.indexCollection(esClient, fakeCollectionFactory({
      name: 'coll1',
      version: '1'
    }), esAlias),
    indexer.indexCollection(esClient, fakeCollectionFactory({
      name: 'coll1',
      version: '2'
    }), esAlias),
    indexer.indexCollection(esClient, fakeCollectionFactory({
      name: 'coll2',
      version: '1'
    }), esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({ collectionId: 'coll1___1' }), esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({ collectionId: 'coll1___1' }), esAlias)
  ]);

  // Indexing using Date.now() to generate the timestamp
  const stub = sinon.stub(Date, 'now').returns((new Date(2020, 0, 29)).getTime());

  await Promise.all([
    indexer.indexCollection(esClient, fakeCollectionFactory({
      name: 'coll3',
      version: '1',
      updatedAt: new Date(2020, 0, 29)
    }), esAlias),
    indexer.indexGranule(esClient, fakeGranuleFactoryV2({
      updatedAt: new Date(2020, 1, 29),
      collectionId: 'coll3___1'
    }), esAlias)
  ]);

  stub.restore();
});


test.after.always(async () => {
  await esClient.indices.delete({ index: esIndex });
  await collectionModel.deleteTable();
  await granuleModel.deleteTable();
  await s3.recursivelyDeleteS3Bucket(process.env.system_bucket);
});

test.only('addStatsToCollection add stats to ES collection results', async (t) => {
  const esResults = [
    {
      name: 'coll1',
      version: '1'
    },
    {
      name: 'coll1',
      version: '2'
    }
  ];

  const collectionSearch = new Collection({}, null, process.env.ES_INDEX);
  const resultsWithStats = await collectionSearch.addStatsToCollectionResults(esResults);

  t.deepEqual(resultsWithStats, [
    {
      name: 'coll1',
      version: '1',
      stats: { running: 0, completed: 2, failed: 0, total: 2 } },
    { name: 'coll1',
      version: '2',
      stats: { running: 0, completed: 0, failed: 0, total: 0 } }
  ]);
});

test.serial('aggregateActiveGranuleCollections returns only collections with granules', async (t) => {
  const collectionSearch = new Collection({}, null, process.env.ES_INDEX);
  const queryResult = await collectionSearch.aggregateActiveGranuleCollections();

  t.deepEqual(queryResult, [ 'coll1___1', 'coll3___1' ]);
});

test.serial('aggregateActiveGranuleCollections respects date range for granules', async (t) => {
  const collectionSearch = new Collection({
    queryStringParameters: {
      updatedAt__from: (new Date(2020, 1, 25)).getTime(),
      updatedAt__to: (new Date(2020, 1, 30)).getTime()
    }
  }, null, process.env.ES_INDEX);
  const queryResult = await collectionSearch.aggregateActiveGranuleCollections();

  t.deepEqual(queryResult, [ 'coll3___1' ]);
});

test.serial('queryCollectionsWithActiveGranules returns collection info and stats', async (t) => {
  const collectionSearch = new Collection({}, null, process.env.ES_INDEX);
  const queryResult = await collectionSearch.queryCollectionsWithActiveGranules();

  t.is(queryResult.meta.count, 2);

  const collections = queryResult.results.map((c) => ({ name: c.name, version: c.version, stats: c.stats }));
  t.deepEqual(collections, [
    {
      name: 'coll1',
      version: '1',
      stats: { running: 0, completed: 2, failed: 0, total: 2 }
    },
    {
      name: 'coll3',
      version: '1',
      stats: { running: 0, completed: 1, failed: 0, total: 1 }
    }
  ]);
});

test.serial('queryCollectionsWithActiveGranules respects granule update times, but not collection', async (t) => {
  const collectionSearch = new Collection({
    queryStringParameters: {
      updatedAt__from: (new Date(2020, 1, 25)).getTime(),
      updatedAt__to: (new Date(2020, 1, 30)).getTime()
    }
  }, null, process.env.ES_INDEX);
  const queryResult = await collectionSearch.queryCollectionsWithActiveGranules();

  t.is(queryResult.meta.count, 1);
  t.is(queryResult.results[0].name, 'coll3');
});
