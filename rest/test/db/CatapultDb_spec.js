/*
 * Copyright (c) 2016-present,
 * Jaguar0625, gimre, BloodyRookie, Tech Bureau, Corp. All rights reserved.
 *
 * This file is part of Catapult.
 *
 * Catapult is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Catapult is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Catapult.  If not, see <http://www.gnu.org/licenses/>.
 */

const test = require('./utils/dbTestUtils');
const testDbOptions = require('./utils/testDbOptions');
const CatapultDb = require('../../src/db/CatapultDb');
const catapult = require('catapult-sdk');
const { expect } = require('chai');
const MongoDb = require('mongodb');

const { address, EntityType } = catapult.model;

const { Long, Binary } = MongoDb;
const Mijin_Test_Network = testDbOptions.networkId;
const Default_Height = 34567;

const DefaultPagingOptions = {
	pageSizeMin: 10,
	pageSizeMax: 100,
	pageSizeDefault: 20
};

describe('catapult db', () => {
	const deleteIds = dbEntities => {
		test.collection.names.forEach(collectionName => {
			const seed = test.collection.findInEntities(dbEntities, collectionName);
			test.db.sanitizeDbEntities(collectionName, seed);
		});
	};

	const keyToAddress = key => Buffer.from(address.publicKeyToAddress(key, Mijin_Test_Network));

	const runDbTest = (dbEntities, issueDbCommand, assertDbCommandResult) => {
		// Arrange:
		const db = new CatapultDb(Object.assign({ networkId: Mijin_Test_Network }, DefaultPagingOptions));

		// Act + Assert:
		return db.connect(testDbOptions.url, 'test')
			.then(() => test.db.populateDatabase(db, dbEntities))
			.then(() => deleteIds(dbEntities))
			.then(() => issueDbCommand(db))
			.then(assertDbCommandResult)
			.then(() => db.close());
	};

	const assertEqualDocuments = (expectedDocuments, actualDocuments) => {
		const stripPrivateInformation = transactions => transactions.map(transaction => {
			// addresses metadata is not exposed outside of the database class
			const modifiedTransaction = Object.assign({}, transaction);
			delete modifiedTransaction.meta.addresses;
			return modifiedTransaction;
		});

		const getAttributes = documents => {
			const documentToIdString = document => (document && document.meta ? document.meta.id.toString() : undefined);
			const subTxIds = documents.map(document => (document.transaction.transactions || []).map(documentToIdString));
			return {
				numDocuments: documents.length,
				ids: documents.map(documentToIdString),
				numSubTxes: subTxIds.reduce((sum, ids) => sum + ids.length, 0),
				subTxIds
			};
		};

		// clean transaction data
		const sanitizedExpectedDocuments = expectedDocuments[0] && expectedDocuments[0].transaction
			? stripPrivateInformation(expectedDocuments)
			: expectedDocuments;

		const expectedAttributes = getAttributes(sanitizedExpectedDocuments);
		const actualAttributes = getAttributes(actualDocuments);

		// Assert:
		expect(actualAttributes.numDocuments, 'wrong number of documents').to.equal(expectedAttributes.numDocuments);
		expect(actualAttributes.ids, 'wrong ids').to.deep.equal(expectedAttributes.ids);
		expect(actualAttributes.numSubTxes, 'wrong number of sub documents').to.equal(expectedAttributes.numSubTxes);
		expect(actualAttributes.subTxIds, 'wrong sub document ids').to.deep.equal(expectedAttributes.subTxIds);
		expect(actualDocuments).to.deep.equal(expectedDocuments);
	};

	describe('basic', () => {
		it('cannot create db without network id', () => {
			// Act + Assert:
			expect(() => new CatapultDb({})).to.throw('network id is required');
		});

		it('can close unconnected db', () => {
			// Arrange:
			const db = new CatapultDb({ networkId: Mijin_Test_Network });

			// Act + Assert: no exception
			expect(() => db.close()).to.not.throw();
		});
	});

	describe('storage info', () => {
		it('can retrieve storage info', () => {
			const Rounds = 2;

			// Arrange:
			return runDbTest(
				{
					block: test.db.createDbBlock(Default_Height),
					transactions: test.db.createDbTransactions(Rounds, test.random.publicKey(), test.random.address())
				},
				db => db.storageInfo(),
				storageInfo => expect(storageInfo).to.deep.equal({ numBlocks: 1, numTransactions: Rounds * 8, numAccounts: 0 })
			);
		});
	});

	describe('chain info', () => {
		it('can retrieve chain info', () =>
			// Assert:
			runDbTest(
				{ chainStatistic: test.db.createChainStatistic(1357, 2468, 3579) },
				db => db.chainStatistic(),
				chainStatistic => expect(chainStatistic).to.deep.equal(test.db.createChainStatistic(1357, 2468, 3579))
			));
	});

	const stripBlockFields = (block, fields) => {
		// block merkle trees are not exposed outside of the database class unless explicitly requested
		const modifiedBlock = Object.assign({}, block);
		fields.forEach(field => delete modifiedBlock.meta[field]);
		return modifiedBlock;
	};

	const stripExtraneousBlockInformation = block => stripBlockFields(block, ['transactionMerkleTree', 'statementMerkleTree']);

	describe('blocks', () => {
		const account1 = {
			publicKey: test.random.publicKey(),
			address: test.random.address()
		};
		const account2 = {
			publicKey: test.random.publicKey(),
			address: test.random.address()
		};

		const paginationOptions = {
			pageSize: 10,
			pageNumber: 1,
			sortField: '_id',
			sortDirection: -1
		};

		const { createObjectId } = test.db;

		const createBlock = (objectId, height, signerPublicKey, beneficiaryAddress) => ({
			_id: createObjectId(objectId),
			meta: { height },
			block: {
				signerPublicKey: signerPublicKey ? Buffer.from(signerPublicKey) : undefined,
				beneficiaryAddress: beneficiaryAddress ? Buffer.from(beneficiaryAddress) : undefined
			}
		});

		const runTestAndVerifyIds = (dbBlocks, dbQuery, expectedIds) => {
			const expectedObjectIds = expectedIds.map(id => createObjectId(id));

			return runDbTest(
				{ blocks: dbBlocks },
				dbQuery,
				blocksPage => {
					const returnedIds = blocksPage.data.map(t => t.id);
					expect(blocksPage.data.length).to.equal(expectedObjectIds.length);
					expect(returnedIds.sort()).to.deep.equal(expectedObjectIds.sort());
				}
			);
		};

		it('returns expected structure', () => {
			// Arrange:
			const dbBlocks = [
				createBlock(10, 100, account1.publicKey, account2.address)
			];

			// Act + Assert:
			return runDbTest(
				{ blocks: dbBlocks },
				db => db.blocks(undefined, undefined, paginationOptions),
				page => {
					const expected_keys = ['id', 'meta', 'block'];
					expect(Object.keys(page.data[0]).sort()).to.deep.equal(expected_keys.sort());
				}
			);
		});

		it('returns correct blocks when no filters are provided', () => {
			// Arrange:
			const dbBlocks = [
				createBlock(10, 1),
				createBlock(20, 1, account1.publicKey),
				createBlock(30, 1, account1.publicKey, account2.address)
			];

			// Act + Assert:
			return runTestAndVerifyIds(dbBlocks, db => db.blocks(undefined, undefined, paginationOptions), [10, 20, 30]);
		});

		it('all the provided filters are taken into account', () => {
			// Arrange:
			const dbBlocks = [
				createBlock(10, 1),
				createBlock(20, 1, account1.publicKey),
				createBlock(30, 1, account1.publicKey, account2.address)
			];

			// Act + Assert:
			return runTestAndVerifyIds(dbBlocks, db => db.blocks(account1.publicKey, account2.address, paginationOptions), [30]);
		});

		describe('respects offset', () => {
			// Arrange:
			const dbBlocks = () => [
				createBlock(10, 20),
				createBlock(20, 30),
				createBlock(30, 10)
			];
			const options = {
				pageSize: 10,
				pageNumber: 1,
				sortField: '_id',
				sortDirection: 1,
				offset: createObjectId(20).toString()
			};

			it('gt', () => {
				options.sortDirection = 1;

				// Act + Assert:
				return runTestAndVerifyIds(dbBlocks(), db => db.blocks(undefined, undefined, options), [30]);
			});

			it('lt', () => {
				options.sortDirection = -1;

				// Act + Assert:
				return runTestAndVerifyIds(dbBlocks(), db => db.blocks(undefined, undefined, options), [10]);
			});
		});

		describe('respects sort conditions', () => {
			// Arrange:
			const dbBlocks = () => [
				createBlock(10, 20),
				createBlock(20, 30),
				createBlock(30, 10)
			];

			it('direction ascending', () => {
				const options = {
					pageSize: 10,
					pageNumber: 1,
					sortField: '_id',
					sortDirection: 1
				};

				// Act + Assert:
				return runDbTest(
					{ blocks: dbBlocks() },
					db => db.blocks(undefined, undefined, options),
					blocksPage => {
						expect(blocksPage.data[0].id).to.deep.equal(createObjectId(10));
						expect(blocksPage.data[1].id).to.deep.equal(createObjectId(20));
						expect(blocksPage.data[2].id).to.deep.equal(createObjectId(30));
					}
				);
			});

			it('direction descending', () => {
				const options = {
					pageSize: 10,
					pageNumber: 1,
					sortField: '_id',
					sortDirection: -1
				};

				// Act + Assert:
				return runDbTest(
					{ blocks: dbBlocks() },
					db => db.blocks(undefined, undefined, options),
					blocksPage => {
						expect(blocksPage.data[0].id).to.deep.equal(createObjectId(30));
						expect(blocksPage.data[1].id).to.deep.equal(createObjectId(20));
						expect(blocksPage.data[2].id).to.deep.equal(createObjectId(10));
					}
				);
			});

			it('sort field', () => {
				const options = {
					pageSize: 10,
					pageNumber: 1,
					sortField: 'meta.height',
					sortDirection: 1
				};

				// Act + Assert:
				return runDbTest(
					{ blocks: dbBlocks() },
					db => db.blocks(undefined, undefined, options),
					blocksPage => {
						expect(blocksPage.data[0].id).to.deep.equal(createObjectId(30));
						expect(blocksPage.data[1].id).to.deep.equal(createObjectId(10));
						expect(blocksPage.data[2].id).to.deep.equal(createObjectId(20));
					}
				);
			});
		});

		describe('correctly applies each filter:', () => {
			it('signerPublicKey', () => {
				// Arrange:
				const dbBlocks = [
					createBlock(10, 1, account1.publicKey),
					createBlock(20, 1, account2.publicKey)
				];

				// Act + Assert:
				return runTestAndVerifyIds(dbBlocks, db => db.blocks(account1.publicKey, undefined, paginationOptions), [10]);
			});

			it('beneficiaryAddress', () => {
				// Arrange:
				const dbBlocks = [
					createBlock(10, 1, account1.publicKey, account1.address),
					createBlock(20, 1, account1.publicKey, account2.address)
				];

				// Act + Assert:
				return runTestAndVerifyIds(dbBlocks, db => db.blocks(undefined, account1.address, paginationOptions), [10]);
			});
		});
	});

	describe('block at height', () => {
		it('undefined is returned for block at unknown height', () =>
			// Assert:
			runDbTest(
				{ block: test.db.createDbBlock(Default_Height) },
				db => db.blockAtHeight(Long.fromNumber(Default_Height + 1)),
				block => expect(block).to.equal(undefined)
			));

		// use blockAtHeight tests as a proxy for testing support of different numeric types (Number, uint64, Long)

		const assertCanRetrieveSimpleBlock = height => {
			// Arrange:
			const seedBlock = test.db.createDbBlock(Default_Height);

			// Assert:
			return runDbTest(
				{ block: seedBlock },
				db => db.blockAtHeight(height),
				block => expect(block).to.deep.equal(stripExtraneousBlockInformation(seedBlock))
			);
		};

		it('can retrieve block without transactions at height (Number)', () => assertCanRetrieveSimpleBlock(Default_Height));
		it('can retrieve block without transactions at height (uint64)', () => assertCanRetrieveSimpleBlock([Default_Height, 0]));
		it('can retrieve block without transactions at height (Long)', () => assertCanRetrieveSimpleBlock(Long.fromNumber(Default_Height)));

		it('can retrieve block with transactions at height', () => {
			// Arrange:
			const seedBlock = test.db.createDbBlock(Default_Height);
			const blockTransactions = test.db.createDbTransactions(2, test.random.publicKey(), test.random.address());

			// Assert:
			return runDbTest(
				{ block: seedBlock, transactions: blockTransactions },
				db => db.blockAtHeight(Long.fromNumber(Default_Height)),
				block => expect(block).to.deep.equal(stripExtraneousBlockInformation(seedBlock))
			);
		});
	});

	describe('block at height with statement merkle tree', () => {
		it('undefined is returned for block at unknown height', () =>
			// Assert:
			runDbTest(
				{ block: test.db.createDbBlock(Default_Height) },
				db => db.blockWithMerkleTreeAtHeight(Long.fromNumber(Default_Height + 1), 'statementMerkleTree'),
				block => expect(block).to.equal(undefined)
			));

		// use blockAtHeight tests as a proxy for testing support of different numeric types (Number, uint64, Long)

		const assertCanRetrieveSimpleBlock = height => {
			// Arrange:
			const seedBlock = test.db.createDbBlock(Default_Height);

			// Assert:
			return runDbTest(
				{ block: seedBlock },
				db => db.blockWithMerkleTreeAtHeight(height, 'statementMerkleTree'),
				block => expect(block).to.deep.equal(stripBlockFields(seedBlock, ['transactionMerkleTree']))
			);
		};

		it('can retrieve block with statement merkle tree at height (Number)', () => assertCanRetrieveSimpleBlock(Default_Height));
		it('can retrieve block with statement merkle tree at height (uint64)', () => assertCanRetrieveSimpleBlock([Default_Height, 0]));
		it('can retrieve block with statement merkle tree at height (Long)', () =>
			assertCanRetrieveSimpleBlock(Long.fromNumber(Default_Height)));

		it('can retrieve block with statement merkle tree at height', () => {
			// Arrange:
			const seedBlock = test.db.createDbBlock(Default_Height);
			const blockTransactions = test.db.createDbTransactions(2, test.random.publicKey(), test.random.address());

			// Assert:
			return runDbTest(
				{ block: seedBlock, transactions: blockTransactions },
				db => db.blockWithMerkleTreeAtHeight(Long.fromNumber(Default_Height), 'statementMerkleTree'),
				block => expect(block).to.deep.equal(stripBlockFields(seedBlock, ['transactionMerkleTree']))
			);
		});
	});

	describe('block at height with transaction merkle tree', () => {
		it('undefined is returned for block at unknown height', () =>
			// Assert:
			runDbTest(
				{ block: test.db.createDbBlock(Default_Height) },
				db => db.blockWithMerkleTreeAtHeight(Long.fromNumber(Default_Height + 1), 'transactionMerkleTree'),
				block => expect(block).to.equal(undefined)
			));

		// use blockAtHeight tests as a proxy for testing support of different numeric types (Number, uint64, Long)

		const assertCanRetrieveSimpleBlock = height => {
			// Arrange:
			const seedBlock = test.db.createDbBlock(Default_Height);

			// Assert:
			return runDbTest(
				{ block: seedBlock },
				db => db.blockWithMerkleTreeAtHeight(height, 'transactionMerkleTree'),
				block => expect(block).to.deep.equal(stripBlockFields(seedBlock, ['statementMerkleTree']))
			);
		};

		it('can retrieve block with transaction merkle tree at height (Number)', () => assertCanRetrieveSimpleBlock(Default_Height));
		it('can retrieve block with transaction merkle tree at height (uint64)', () => assertCanRetrieveSimpleBlock([Default_Height, 0]));
		it('can retrieve block with transaction merkle tree at height (Long)', () =>
			assertCanRetrieveSimpleBlock(Long.fromNumber(Default_Height)));

		it('can retrieve block with transaction merkle tree at height', () => {
			// Arrange:
			const seedBlock = test.db.createDbBlock(Default_Height);
			const blockTransactions = test.db.createDbTransactions(2, test.random.publicKey(), test.random.address());

			// Assert:
			return runDbTest(
				{ block: seedBlock, transactions: blockTransactions },
				db => db.blockWithMerkleTreeAtHeight(Long.fromNumber(Default_Height), 'transactionMerkleTree'),
				block => expect(block).to.deep.equal(stripBlockFields(seedBlock, ['statementMerkleTree']))
			);
		});
	});

	describe('blocks from height', () => {
		const createBlocks = (height, numBlocks) => {
			const blocks = [];
			// the blocks are created in descending height order
			// in order to make later comparisons easier using .slice()
			for (let i = 0; i < numBlocks; ++i)
				blocks.push(test.db.createDbBlock(height + numBlocks - 1 - i));

			return blocks;
		};

		const createDbEntities = numBlocks => ({
			chainStatistic: test.db.createChainStatistic(Default_Height + numBlocks - 1, 0, 0),
			blocks: createBlocks(Default_Height, numBlocks)
		});

		it('returns empty array for unknown height', () =>
			// Assert:
			runDbTest(
				createDbEntities(1),
				db => db.blocksFrom(Long.fromNumber(Default_Height + 1), 10),
				blocks => expect(blocks).to.deep.equal([])
			));

		const assertBlocks = (actualBlocks, dbEntities, startHeight, numBlocks) => {
			// Assert: actual blocks should contain `numBlocks` blocks from `startHeight`.
			// dbEntities.blocks are sorted in descending order, so:
			// 1. inside the expected list find the index of element with height `startHeight`,
			// 2. go back numBlocks elements to find element with largest height.
			const endElement = dbEntities.blocks.findIndex(entity => entity.block.height.toNumber() === startHeight) + 1;
			const startElement = endElement - numBlocks;
			expect(actualBlocks.length).to.equal(numBlocks);
			expect(actualBlocks).to.deep.equal(dbEntities.blocks.slice(startElement, endElement).map(block =>
				stripExtraneousBlockInformation(block)));
		};

		it('returns at most available blocks', () => {
			// Arrange:
			const dbEntities = createDbEntities(5);

			// Assert:
			return runDbTest(
				dbEntities,
				db => db.blocksFrom(Default_Height + 2, 10),
				blocks => assertBlocks(blocks, dbEntities, Default_Height + 2, 3)
			);
		});

		it('respects requested number of blocks', () => {
			// Arrange:
			const dbEntities = createDbEntities(10);

			// Assert:
			return runDbTest(
				dbEntities,
				db => db.blocksFrom(Default_Height + 4, 3),
				blocks => assertBlocks(blocks, dbEntities, Default_Height + 4, 3)
			);
		});

		it('returns empty array when requesting 0 blocks', () =>
			// Arrange:
			runDbTest(
				createDbEntities(10),
				db => db.blocksFrom(Default_Height + 4, 0),
				blocks => expect(blocks).to.deep.equal([])
			));

		it('returns top blocks when requesting from "0" height', () => {
			// Arrange:
			const dbEntities = createDbEntities(34);

			// Assert:
			return runDbTest(
				dbEntities,
				db => db.blocksFrom(0, 10),
				blocks => assertBlocks(blocks, dbEntities, Default_Height + 24, 10)
			);
		});

		it('returns top blocks when requesting from "0" height even if more blocks are in the database', () => {
			// Arrange: set height to 4
			const dbEntities = {
				chainStatistic: test.db.createChainStatistic(4, 0, 0),
				blocks: createBlocks(1, 10)
			};

			// Assert:
			return runDbTest(
				dbEntities,
				db => db.blocksFrom(0, 10),
				blocks => assertBlocks(blocks, dbEntities, 1, 4)
			);
		});

		it('returns last block when requesting from "0" height with alignment 1', () => {
			// Arrange: set height to 134
			const dbEntities = {
				chainStatistic: test.db.createChainStatistic(134, 0, 0),
				blocks: createBlocks(120, 15)
			};

			// Assert:
			return runDbTest(
				dbEntities,
				db => db.blocksFrom(0, 1),
				blocks => assertBlocks(blocks, dbEntities, 134, 1)
			);
		});

		it('returns blocks sorted in descending order', () =>
			// Arrange: try to insert in random order
			runDbTest(
				{
					chainStatistic: test.db.createChainStatistic(Default_Height + 2, 0, 0),
					blocks: [
						test.db.createDbBlock(Default_Height + 2),
						test.db.createDbBlock(Default_Height),
						test.db.createDbBlock(Default_Height + 1)
					]
				},
				db => db.blocksFrom(Default_Height, 5),
				// Assert: blocks are returned in proper order - descending by height
				blocks => {
					expect(blocks.length).to.equal(3);
					for (let i = 0; 3 > i; ++i)
						expect(blocks[i].block.height).to.deep.equal(Long.fromNumber(Default_Height + 2 - i));
				}
			));
	});

	describe('latest blocks fee multiplier', () => {
		it('returns empty array when requesting 0 blocks', () => {
			// Arrange:
			const blockDbEntities = [
				{ block: { height: 10, feeMultiplier: 10 } },
				{ block: { height: 11, feeMultiplier: 11 } }
			];

			// Act + Assert:
			return runDbTest(
				{ blocks: blockDbEntities },
				db => db.latestBlocksFeeMultiplier(0),
				feeMultipliers => {
					expect(feeMultipliers).to.deep.equal([]);
				}
			);
		});

		it('returns latest available blocks based on height', () => {
			// Arrange:
			const blockDbEntities = [
				{ block: { height: 12, feeMultiplier: 12 } },
				{ block: { height: 15, feeMultiplier: 15 } },
				{ block: { height: 10, feeMultiplier: 10 } },
				{ block: { height: 14, feeMultiplier: 14 } },
				{ block: { height: 11, feeMultiplier: 11 } },
				{ block: { height: 13, feeMultiplier: 13 } }
			];

			// Act + Assert:
			return runDbTest(
				{ blocks: blockDbEntities },
				db => db.latestBlocksFeeMultiplier(5),
				feeMultipliers => {
					expect(feeMultipliers).to.deep.equal([15, 14, 13, 12, 11]);
				}
			);
		});

		it('respects requested number of blocks', () => {
			// Arrange:
			const blockDbEntities = [
				{ block: { height: 10, feeMultiplier: 1 } },
				{ block: { height: 11, feeMultiplier: 1 } },
				{ block: { height: 12, feeMultiplier: 1 } },
				{ block: { height: 13, feeMultiplier: 1 } },
				{ block: { height: 14, feeMultiplier: 1 } }
			];

			// Act + Assert:
			return runDbTest(
				{ blocks: blockDbEntities },
				db => db.latestBlocksFeeMultiplier(3),
				feeMultipliers => {
					expect(feeMultipliers.length).to.equal(3);
				}
			);
		});

		it('returns only fee multiplier values', () => {
			// Arrange:
			const blockDbEntities = [
				{
					meta: { hash: 'h1' },
					block: {
						network: 144,
						type: 33091,
						height: 11,
						feeMultiplier: 11.1
					}
				},
				{
					meta: { hash: 'h2' },
					block: {
						network: 144,
						type: 33091,
						height: 10,
						feeMultiplier: 10.1
					}
				}
			];

			// Act + Assert:
			return runDbTest(
				{ blocks: blockDbEntities },
				db => db.latestBlocksFeeMultiplier(5),
				feeMultipliers => {
					expect(feeMultipliers).to.deep.equal([11.1, 10.1]);
				}
			);
		});
	});

	const createTransactionHash = id => catapult.utils.convert.hexToUint8(`${'00'.repeat(16)}${id.toString(16)}`.slice(-32));

	const createSeedTransactions = (numTransactionsPerHeight, heights, options) => {
		// notice that generated transactions only contain what was used by transactionsAtHeight for filtering (meta.height)
		let id = 1;
		const transactions = [];
		const addTransactionAtHeight = (height, type) => {
			const aggregateId = test.db.createObjectId(id);
			const hash = new Binary(Buffer.from(createTransactionHash(id++)));
			const meta = { height, hash, addresses: [] };
			transactions.push({ _id: aggregateId, meta, transaction: { type } });

			const numDependentDocuments = (options || {}).numDependentDocuments || 0;
			for (let j = 0; j < numDependentDocuments; ++j)
				transactions.push({ _id: test.db.createObjectId(id++), meta: { height, aggregateId }, transaction: {} });
		};

		for (let i = 0; i < numTransactionsPerHeight; ++i) {
			// transactionsAtHeight only worked for both aggregates, so pick each type alteratively
			const type = 0 === i % 2 ? EntityType.aggregateComplete : EntityType.aggregateBonded;
			heights.forEach(height => { addTransactionAtHeight(height, type); });
		}

		return transactions;
	};

	describe('transaction by id', () => {
		const addTestsWithId = (traits, idTraits) => {
			it('can retrieve each transaction by id', () => {
				// Arrange:
				const seedTransactions = traits.createSeedTransactions();
				const allIds = traits.allIds.map(idTraits.convertToId);

				// Act + Assert:
				return runDbTest(
					{ [idTraits.collectionName]: seedTransactions },
					db => idTraits.transactionsByIds(db, allIds),
					transactions => assertEqualDocuments(traits.expected(seedTransactions, traits.allIds), transactions)
				);
			});

			it('can retrieve transaction using known id', () => {
				// Arrange:
				const seedTransactions = traits.createSeedTransactions();
				const documentId = idTraits.convertToId(traits.validId);

				// Act + Assert:
				return runDbTest(
					{ [idTraits.collectionName]: seedTransactions },
					db => idTraits.transactionsByIds(db, [documentId]),
					transactions => assertEqualDocuments(traits.expected(seedTransactions, [traits.validId]), transactions)
				);
			});

			it('cannot retrieve transaction using unknown id', () => {
				// Arrange:
				const seedTransactions = traits.createSeedTransactions();
				const documentId = idTraits.convertToId(traits.invalidId);

				// Act + Assert:
				return runDbTest(
					{ [idTraits.collectionName]: seedTransactions },
					db => idTraits.transactionsByIds(db, [documentId]),
					transactions => expect(transactions).to.deep.equal([])
				);
			});

			it('can retrieve only known transactions by id', () => {
				// Arrange:
				const seedTransactions = traits.createSeedTransactions();
				const allIds = traits.allIds.map(idTraits.convertToId);
				// make a copy and insert invalid id in the middle
				const mixedIds = allIds.slice();
				mixedIds.splice(mixedIds.length / 2, 0, idTraits.convertToId(traits.invalidId));

				// Act + Assert:
				return runDbTest(
					{ [idTraits.collectionName]: seedTransactions },
					db => idTraits.transactionsByIds(db, mixedIds),
					transactions => assertEqualDocuments(traits.expected(seedTransactions, traits.allIds), transactions)
				);
			});
		};

		const addTests = traits => {
			describe('by object id', () =>
				addTestsWithId(traits, {
					convertToId: test.db.createObjectId,
					collectionName: 'transactions',
					transactionsByIds: (db, ids) => db.transactionsByIds(ids)
				}));

			describe('by transaction hash', () =>
				addTestsWithId(traits, {
					convertToId: createTransactionHash,
					collectionName: 'transactions',
					transactionsByIds: (db, ids) => db.transactionsByHashes(ids)
				}));

			describe('by transaction hash (unconfirmed)', () =>
				addTestsWithId(traits, {
					convertToId: createTransactionHash,
					collectionName: 'unconfirmedTransactions',
					transactionsByIds: (db, ids) => db.transactionsByHashesUnconfirmed(ids)
				}));

			describe('by transaction hash (partial)', () =>
				addTestsWithId(traits, {
					convertToId: createTransactionHash,
					collectionName: 'partialTransactions',
					transactionsByIds: (db, ids) => db.transactionsByHashesPartial(ids)
				}));
		};

		describe('for transactions', () => {
			addTests({
				createSeedTransactions: () => createSeedTransactions(3, [21, 34]),
				expected: (transactions, ids) => ids.map(id => transactions[id - 1]),
				allIds: [1, 2, 3, 4, 5, 6],
				validId: 2,
				invalidId: (3 * 2) + 1
			});
		});

		describe('for transactions with dependent documents', () => {
			addTests({
				// 1 (2, 3)  (height 21)
				// 4 (5, 6)  (height 34)
				// 7 (8, 9)  (height 21)
				// ...
				createSeedTransactions: () => createSeedTransactions(3, [21, 34], { numDependentDocuments: 2 }),
				expected: (transactions, ids) => ids.map(id => {
					const index = id - 1;
					const stitchedAggregate = Object.assign({}, transactions[index]);
					stitchedAggregate.transaction.transactions = [transactions[index + 1], transactions[index + 2]];
					return stitchedAggregate;
				}),
				allIds: [1, 4, 7, 10, 13, 16],
				// transaction with id 4 is an aggregate
				validId: 4,
				invalidId: (3 * 3 * 2) + 1
			});
		});

		describe('for a dependent document', () => {
			it('can retrieve dependent document by id', () => {
				// Arrange:
				// transaction with id 5 is a dependent document
				// 1 (2, 3)  (height 21)
				// 4 (5, 6)  (height 34)
				// ...
				const seedTransactions = createSeedTransactions(3, [21, 34], { numDependentDocuments: 2 });
				const documentId = test.db.createObjectId(5);

				// Act + Assert:
				return runDbTest(
					{ transactions: seedTransactions },
					db => db.transactionsByIds([documentId]),
					transactions => assertEqualDocuments([seedTransactions[4]], transactions)
				);
			});
		});
	});

	describe('names by ids', () => {
		const createDbMarkedTransaction = (id, parentId, markerId) => {
			// meta data
			const meta = {};

			// transaction data
			const transaction = {
				type: 0x12345,
				parentMarkerId: Long.fromNumber(parentId),
				markerId: Long.fromNumber(markerId),
				markerName: `marker-${markerId}`
			};

			return { _id: id, meta, transaction };
		};

		const createDbMarkedTransactions = (numTransactions, numRepetitions) => {
			const transactions = [];
			let id = 0;
			// create multiple (numRepetitions) transactions with same markerId, but different _id field.
			for (let i = 0; i < numRepetitions; ++i) {
				for (let j = 0; j < numTransactions; ++j)
					transactions.push(createDbMarkedTransaction(test.db.createObjectId(++id), 15000 + j, 20000 + j));
			}

			return transactions;
		};

		const createDbEntities = () => ({ transactions: createDbMarkedTransactions(12, 3) });

		const assertTransactions = (expectedTransactions, ids) => runDbTest(
			// Arrange: seed with transactions with markerIds: 20000 - 20011
			createDbEntities(),
			db => db.findNamesByIds(ids, 0x12345, { id: 'markerId', name: 'markerName', parentId: 'parentMarkerId' }),
			transactions => {
				// Assert:
				expect(transactions.length).to.equal(expectedTransactions.length);
				expect(transactions).to.deep.equal(expectedTransactions);
			}
		);

		const createExpected = (parentId, markerId) => ({
			markerId,
			markerName: `marker-${markerId}`,
			parentMarkerId: parentId
		});

		it('returns empty array for unknown ids', () =>
			// Act + Assert: query for markerId outside seed range
			assertTransactions([], [[123, 456]]));

		it('returns single matching entry', () => {
			// Act + Assert: query for markerId in seed range (20000-20011)
			// note: there are multiple transactions with same markerId, so this also checks that only non-duplicates are returned
			const expected = [createExpected(15010, 20010)];

			return assertTransactions(expected, [[20010, 0]]);
		});

		it('returns multiple matching entries', () => {
			// Act + Assert: query for markerIds in seed range (20000-20011)
			// note: there are multiple transactions with same markerId, so this also checks that only non-duplicates are returned
			const expected = [createExpected(15008, 20008), createExpected(15005, 20005), createExpected(15003, 20003)];

			return assertTransactions(expected, [[20003, 0], [20005, 0], [20008, 0]]);
		});

		it('returns only matching entries', () => {
			// Act + Assert: query for markerId in seed range (20000-20011) and one outside of range
			// note: there are multiple transactions with same markerId, so this also checks that only non-duplicates are returned
			const expected = [createExpected(15008, 20008), createExpected(15003, 20003)];

			return assertTransactions(expected, [[20003, 0], [123, 456], [20008, 0]]);
		});
	});

	describe('query transactions', () => {
		const testPublicKeyOne = test.random.publicKey();
		const testAddressOne = keyToAddress(testPublicKeyOne);
		const testPublicKeyTwo = test.random.publicKey();
		const testAddressTwo = keyToAddress(testPublicKeyTwo);

		const createTransaction = (objectId, addresses, type) => ({
			_id: objectId,
			meta: { addresses: addresses.map(a => new Binary(a)) },
			transaction: { type }
		});

		const createDependentDocument = (objectId, aggregateId) => ({
			_id: objectId,
			meta: { aggregateId },
			transaction: {}
		});

		it('does not expose private meta.addresses field', () => {
			// Arrange:
			const id1 = test.db.createObjectId(100);
			const id2 = test.db.createObjectId(200);
			const dbTransactions = [];
			dbTransactions.push(createTransaction(id1, [testAddressOne, testAddressTwo], EntityType.transfer));
			dbTransactions.push(createTransaction(id2, [testAddressOne, testAddressTwo], EntityType.aggregateComplete));

			// Act + Assert:
			return runDbTest({ transactions: dbTransactions },
				db => db.queryTransactions({ 'meta.addresses': Buffer.from(testAddressOne) }),
				transactions => {
					transactions.forEach(transaction => {
						expect(Object.keys(transaction.meta).length).to.equal(1);
						expect(transaction.meta).to.contain.all.keys(['id']);
					});
				});
		});

		it('uses transactions collection by default', () => {
			// Arrange:
			const id1 = test.db.createObjectId(100);
			const id2 = test.db.createObjectId(200);

			const dbEntities = {
				transactions: [createTransaction(id1, [testAddressOne], EntityType.transfer)],
				partialTransactions: [createTransaction(id2, [testAddressOne], EntityType.transfer)]
			};

			// Act + Assert:
			return runDbTest(dbEntities,
				db => db.queryTransactions({ 'meta.addresses': Buffer.from(testAddressOne) }),
				transactions => {
					expect(transactions.length).to.equal(1);
					expect(transactions[0].meta.id).to.deep.equal(id1);
				});
		});

		it('uses specified collection', () => {
			// Arrange:
			const id1 = test.db.createObjectId(100);
			const id2 = test.db.createObjectId(200);

			const dbEntities = {
				transactions: [createTransaction(id1, [testAddressOne], EntityType.transfer)],
				partialTransactions: [createTransaction(id2, [testAddressOne], EntityType.transfer)]
			};

			// Act + Assert:
			return runDbTest(dbEntities,
				db => db.queryTransactions(
					{ 'meta.addresses': Buffer.from(testAddressOne) },
					undefined,
					undefined,
					{ collectionName: 'partialTransactions' }
				),
				transactions => {
					expect(transactions.length).to.equal(1);
					expect(transactions[0].meta.id).to.deep.equal(id2);
				});
		});

		it('filters out dependent documents', () => {
			// Arrange:
			const id1 = test.db.createObjectId(100);
			const id2 = test.db.createObjectId(200);
			const id3 = test.db.createObjectId(300);

			const dbTransactions = [];

			// transactions to ouput
			dbTransactions.push(createTransaction(id1, [testAddressOne, testAddressTwo], EntityType.transfer));
			dbTransactions.push(createTransaction(id2, [testAddressOne, testAddressTwo], EntityType.aggregateComplete));
			dbTransactions.push(createTransaction(id3, [testAddressOne, testAddressTwo], EntityType.aggregateBonded));

			// dependent documents to filter out
			dbTransactions.push(createDependentDocument(test.db.createObjectId(56543), id2));
			dbTransactions.push(createDependentDocument(test.db.createObjectId(23238), id2));
			dbTransactions.push(createDependentDocument(test.db.createObjectId(96212), id3));

			// Act + Assert:
			return runDbTest({ transactions: dbTransactions },
				db => db.queryTransactions({ 'meta.addresses': Buffer.from(testAddressOne) }),
				transactions => {
					const ids = transactions.map(transaction => transaction.meta.id);
					expect(ids.length).to.equal(3);
					expect(ids).to.deep.equal([id3, id2, id1]);
				});
		});

		it('correctly retrieves transactions without dependent documents', () => {
			// Arrange:
			const id1 = test.db.createObjectId(100);
			const id2 = test.db.createObjectId(200);
			const id3 = test.db.createObjectId(300);

			const dbTransactions = [];
			dbTransactions.push(createTransaction(id1, [testAddressOne], EntityType.transfer));
			dbTransactions.push(createTransaction(id2, [testAddressTwo, testAddressOne], EntityType.mosaicSupplyChange));
			dbTransactions.push(createTransaction(id3, [keyToAddress(test.random.publicKey())], EntityType.registerNamespace));

			// Act + Assert:
			return runDbTest({ transactions: dbTransactions },
				db => db.queryTransactions({ 'meta.addresses': Buffer.from(testAddressOne) }),
				transactions => {
					expect(transactions.length).to.equal(2);
					expect(transactions).to.deep.equal([
						{ meta: { id: id2 }, transaction: { type: EntityType.mosaicSupplyChange } },
						{ meta: { id: id1 }, transaction: { type: EntityType.transfer } }
					]);
				});
		});

		it('correctly retrieves transactions with dependent documents and pushes dependent documents to transactions', () => {
			// Arrange:
			const id1 = test.db.createObjectId(100);
			const id2 = test.db.createObjectId(200);
			const id3 = test.db.createObjectId(300);

			const dbTransactions = [];
			dbTransactions.push(createTransaction(id1, [testAddressOne], EntityType.aggregateComplete));
			dbTransactions.push(createTransaction(id2, [testAddressOne], EntityType.aggregateBonded));
			dbTransactions.push(createTransaction(id3, [keyToAddress(test.random.publicKey())], EntityType.mosaicSupplyChange));

			// dependent documents
			const id4 = test.db.createObjectId(400);
			const id5 = test.db.createObjectId(500);
			const id6 = test.db.createObjectId(600);
			const id7 = test.db.createObjectId(700);
			dbTransactions.push(createDependentDocument(id4, id1));
			dbTransactions.push(createDependentDocument(id5, id1));
			dbTransactions.push(createDependentDocument(id6, id2));
			dbTransactions.push(createDependentDocument(id7, id2));
			dbTransactions.push(createDependentDocument(test.db.createObjectId(34654), test.db.createObjectId(89876)));

			// Act + Assert:
			return runDbTest({ transactions: dbTransactions },
				db => db.queryTransactions({ 'meta.addresses': Buffer.from(testAddressOne) }),
				transactions => {
					expect(transactions.length).to.equal(2);
					expect(transactions).to.deep.equal([
						{
							meta: { id: id2 },
							transaction: {
								type: EntityType.aggregateBonded,
								transactions: [
									{ meta: { aggregateId: id2, id: id6 }, transaction: {} },
									{ meta: { aggregateId: id2, id: id7 }, transaction: {} }
								]
							}
						},
						{
							meta: { id: id1 },
							transaction: {
								type: EntityType.aggregateComplete,
								transactions: [
									{ meta: { aggregateId: id1, id: id4 }, transaction: {} },
									{ meta: { aggregateId: id1, id: id5 }, transaction: {} }
								]
							}
						}
					]);
				});
		});

		it('query respects supplied id', () => {
			// Arrange:
			const dbTransactions = [];
			for (let i = 0; 25 > i; ++i)
				dbTransactions.push(createTransaction(test.db.createObjectId(i), [testAddressOne], EntityType.transfer));

			// Act + Assert:
			return runDbTest({ transactions: dbTransactions },
				db => db.queryTransactions({ 'meta.addresses': Buffer.from(testAddressOne) }, test.db.createObjectId(15)),
				transactions => {
					const expectedIds = [];
					for (let i = 14; 0 <= i; --i)
						expectedIds.push(test.db.createObjectId(i));

					expect(transactions.map(t => t.meta.id)).to.deep.equal(expectedIds);
				});
		});

		const runOrderingTest = (ordering, exepctedIds) => {
			// Arrange:
			const dbTransactions = [];
			for (let i = 0; 10 > i; ++i)
				dbTransactions.push(createTransaction(test.db.createObjectId(i), [testAddressOne], EntityType.transfer));

			// Act + Assert:
			return runDbTest({ transactions: dbTransactions },
				db => db.queryTransactions(
					{ 'meta.addresses': Buffer.from(testAddressOne) }, undefined, undefined, { sortOrder: ordering }
				),
				transactions => { expect(transactions.map(t => t.meta.id)).to.deep.equal(exepctedIds); });
		};

		it('query respects options ordering asc', () => {
			const expectedIdsAsc = [];
			for (let i = 0; 10 > i; ++i)
				expectedIdsAsc.push(test.db.createObjectId(i));

			return runOrderingTest(1, expectedIdsAsc);
		});

		it('query respects options ordering desc', () => {
			const expectedIdsDesc = [];
			for (let i = 9; 0 <= i; --i)
				expectedIdsDesc.push(test.db.createObjectId(i));

			return runOrderingTest(-1, expectedIdsDesc);
		});

		const runPageSizeTests = (numTransactionsCreated, pageSize, expectedNumTransactions) => {
			// Arrange:
			const dbTransactions = [];
			for (let i = 0; numTransactionsCreated > i; ++i)
				dbTransactions.push(createTransaction(test.db.createObjectId(i), [testAddressOne], EntityType.transfer));

			// Act + Assert:
			return runDbTest({ transactions: dbTransactions },
				db => db.queryTransactions({ 'meta.addresses': Buffer.from(testAddressOne) }, undefined, pageSize),
				transactions => { expect(transactions.length).to.equal(expectedNumTransactions); });
		};

		it('query respects page size', () => runPageSizeTests(50, 25, 25));

		it('query ensures minimum page size', () => {
			const config = Object.assign({ networkId: Mijin_Test_Network }, DefaultPagingOptions);
			const minPageSize = new CatapultDb(config).pagingOptions.pageSizeMin;
			return runPageSizeTests(minPageSize + 5, minPageSize - 1, minPageSize);
		});

		it('query ensures maximum page size', () => {
			const config = Object.assign({ networkId: Mijin_Test_Network }, DefaultPagingOptions);
			const maxPageSize = new CatapultDb(config).pagingOptions.pageSizeMax;
			return runPageSizeTests(maxPageSize + 5, maxPageSize + 1, maxPageSize);
		});
	});

	describe('queryPagedDocuments 2', () => {
		const account1 = {
			publicKey: test.random.publicKey(),
			address: keyToAddress(test.random.publicKey())
		};
		const account2 = {
			publicKey: test.random.publicKey(),
			address: keyToAddress(test.random.publicKey())
		};
		const { createObjectId } = test.db;
		const sortConditions = { $sort: { _id: 1 } };
		const options = { pageSize: 10, pageNumber: 1 };

		describe('can return empty result', () => {
			it('empty db', () => {
				// Arrange
				const conditions = [];

				// Act + Assert:
				return runDbTest(
					{},
					db => db.queryPagedDocuments_2(conditions, [], sortConditions, 'accounts', options),
					page => {
						expect(page.data).to.deep.equal([]);
						expect(page.pagination).to.deep.equal({
							totalEntries: 0, pageNumber: 1, pageSize: options.pageSize, totalPages: 0
						});
					}
				);
			});

			it('conditions produces empty result', () => {
				// Arrange
				const dbAccounts = () => [
					{ _id: createObjectId(10), account: { addressHeight: 10 } },
					{ _id: createObjectId(30), account: { addressHeight: 30 } }
				];
				const conditions = [{ 'account.addressHeight': 20 }];

				// Act + Assert:
				return runDbTest(
					{ accounts: dbAccounts() },
					db => db.queryPagedDocuments_2(conditions, [], sortConditions, 'accounts', options),
					page => {
						expect(page.data).to.deep.equal([]);
						expect(page.pagination).to.deep.equal({
							totalEntries: 0, pageNumber: 1, pageSize: options.pageSize, totalPages: 0
						});
					}
				);
			});
		});

		describe('respects query conditions', () => {
			// Arrange:
			const accounts = () => ([
				{ _id: createObjectId(10), account: { address: account1.address, addressHeight: 10 } },
				{ _id: createObjectId(20), account: { address: account2.address, addressHeight: 20 } },
				{ _id: createObjectId(30), account: { address: account2.address, addressHeight: 30 } }
			]);

			it('no conditions', () => {
				const conditions = [];

				// Act + Assert:
				return runDbTest(
					{ accounts: accounts() },
					db => db.queryPagedDocuments_2(conditions, [], sortConditions, 'accounts', options),
					page => {
						expect(page.data.length).to.equal(3);
						expect(page.data[0].id).to.deep.equal(createObjectId(10));
						expect(page.data[1].id).to.deep.equal(createObjectId(20));
						expect(page.data[2].id).to.deep.equal(createObjectId(30));
					}
				);
			});

			it('one condition', () => {
				const conditions = [{ 'account.addressHeight': 20 }];

				// Act + Assert:
				return runDbTest(
					{ accounts: accounts() },
					db => db.queryPagedDocuments_2(conditions, [], sortConditions, 'accounts', options),
					page => {
						expect(page.data.length).to.equal(1);
						expect(page.data[0].id).to.deep.equal(createObjectId(20));
					}
				);
			});

			it('multiple conditions', () => {
				const conditions = [
					{ 'account.address': account2.address },
					{ 'account.addressHeight': { $gt: 20 } }
				];

				// Act + Assert:
				return runDbTest(
					{ accounts: accounts() },
					db => db.queryPagedDocuments_2(conditions, [], sortConditions, 'accounts', options),
					page => {
						expect(page.data.length).to.equal(1);
						expect(page.data[0].id).to.deep.equal(createObjectId(30));
					}
				);
			});
		});

		describe('renames _id to id', () => {
			// Arrange:
			const blocks = () => ([
				{
					_id: createObjectId(10),
					meta: {
						hash: 0x0100,
						numTransactions: 10
					},
					block: {
						version: 1,
						type: 2
					}
				}
			]);

			it('id is in the query result and _id is not', () =>
				// Act + Assert:
				runDbTest(
					{ blocks: blocks() },
					db => db.queryPagedDocuments_2([], [], sortConditions, 'blocks', options),
					page => {
						expect(page.data[0]._id).to.equal(undefined);
						expect(page.data[0].id).to.deep.equal(createObjectId(10));
					}
				));

			it('id is used when is removed instead of _id', () =>
				// Act + Assert:
				runDbTest(
					{ blocks: blocks() },
					db => db.queryPagedDocuments_2([], ['id'], sortConditions, 'blocks', options),
					page => {
						expect(page.data[0]._id).to.equal(undefined);
						expect(page.data[0].id).to.equal(undefined);
					}
				));
		});

		describe('removed fields', () => {
			// Arrange:
			const blocks = () => ([
				{
					_id: createObjectId(10),
					meta: {
						hash: 0x0100,
						numTransactions: 10
					},
					block: {
						version: 1,
						type: 2
					}
				}
			]);

			it('does not remove fields if no supplied fields to remove', () => {
				const removedFields = [];

				// Act + Assert:
				return runDbTest(
					{ blocks: blocks() },
					db => db.queryPagedDocuments_2([], removedFields, sortConditions, 'blocks', options),
					page => {
						expect(page.data.length).to.equal(1);
						expect(page.data[0]).to.deep.equal({
							id: createObjectId(10),
							meta: { hash: 0x0100, numTransactions: 10 },
							block: { version: 1, type: 2 }
						});
					}
				);
			});

			it('removes supplied fields', () => {
				const removedFields = ['meta.hash', 'block.version'];

				// Act + Assert:
				return runDbTest(
					{ blocks: blocks() },
					db => db.queryPagedDocuments_2([], removedFields, sortConditions, 'blocks', options),
					page => {
						expect(page.data.length).to.equal(1);
						expect(page.data[0]).to.deep.equal({
							id: createObjectId(10),
							meta: { numTransactions: 10 },
							block: { type: 2 }
						});
					}
				);
			});
		});

		describe('respects sort conditions', () => {
			// Arrange:
			const blocks = () => ([
				{ _id: createObjectId(10), meta: { numTransactions: 1 }, block: { version: 3, type: 2 } },
				{ _id: createObjectId(20), meta: { numTransactions: 2 }, block: { version: 2, type: 1 } },
				{ _id: createObjectId(30), meta: { numTransactions: 3 }, block: { version: 1, type: 3 } }
			]);

			it('direction ascending', () =>
				// Act + Assert:
				runDbTest(
					{ blocks: blocks() },
					db => db.queryPagedDocuments_2([], [], { $sort: { _id: 1 } }, 'blocks', options),
					page => {
						expect(page.data.length).to.equal(3);
						expect(page.data[0].id).to.deep.equal(createObjectId(10));
						expect(page.data[1].id).to.deep.equal(createObjectId(20));
						expect(page.data[2].id).to.deep.equal(createObjectId(30));
					}
				));

			it('direction descending', () =>
				// Act + Assert:
				runDbTest(
					{ blocks: blocks() },
					db => db.queryPagedDocuments_2([], [], { $sort: { _id: -1 } }, 'blocks', options),
					page => {
						expect(page.data.length).to.equal(3);
						expect(page.data[0].id).to.deep.equal(createObjectId(30));
						expect(page.data[1].id).to.deep.equal(createObjectId(20));
						expect(page.data[2].id).to.deep.equal(createObjectId(10));
					}
				));

			it('sort field', () =>
				// Act + Assert:
				runDbTest(
					{ blocks: blocks() },
					db => db.queryPagedDocuments_2([], [], { $sort: { 'block.type': 1 } }, 'blocks', options),
					page => {
						expect(page.data.length).to.equal(3);
						expect(page.data[0].id).to.deep.equal(createObjectId(20));
						expect(page.data[1].id).to.deep.equal(createObjectId(10));
						expect(page.data[2].id).to.deep.equal(createObjectId(30));
					}
				));
		});

		describe('uses provided collection', () => {
			// Arrange:
			const accounts = () => ([{ _id: createObjectId(10), account: { address: account1.address, addressHeight: 10 } }]);
			const blocks = () => ([{ _id: createObjectId(20), meta: { numTransactions: 1 }, block: { version: 3, type: 2 } }]);
			const transactions = () => ([{ _id: createObjectId(30), meta: { height: 1 }, transaction: { type: 3 } }]);

			it('respects collection', () =>
				// Act + Assert:
				runDbTest(
					{ accounts: accounts(), blocks: blocks(), transactions: transactions() },
					db => db.queryPagedDocuments_2([], [], sortConditions, 'blocks', options),
					page => {
						expect(page.data.length).to.equal(1);
						expect(page.data[0].id).to.deep.equal(createObjectId(20));
					}
				));
		});

		describe('options', () => {
			const blocks = numBlocks => {
				const resultBlocks = [];
				for (let i = 0; numBlocks > i; i++)
					resultBlocks.push({ _id: createObjectId(i), meta: { hash: 0x0100 }, block: { type: 1 } });

				return resultBlocks;
			};

			describe('respects page size', () => {
				it('page size: 25', () => {
					const pageSize = 25;

					// Act + Assert:
					return runDbTest(
						{ blocks: blocks(25 + 10) },
						db => db.queryPagedDocuments_2([], [], { $sort: { id: 1 } }, 'blocks', { pageSize, pageNumber: 1 }),
						page => {
							expect(page.data.length).to.equal(25);
							expect(page.pagination).to.deep.equal({
								totalEntries: 25 + 10, pageNumber: 1, pageSize: 25, totalPages: 2
							});
						}
					);
				});

				it('less results than a page size', () => {
					const pageSize = 25;

					// Act + Assert:
					return runDbTest(
						{ blocks: blocks(10) },
						db => db.queryPagedDocuments_2([], [], { $sort: { id: 1 } }, 'blocks', { pageSize, pageNumber: 1 }),
						page => {
							expect(page.data.length).to.equal(10);
							expect(page.pagination).to.deep.equal({
								totalEntries: 10, pageNumber: 1, pageSize: 25, totalPages: 1
							});
						}
					);
				});
			});

			describe('respects page number', () => {
				const runPageNumberTest = (pageNumber, expectedNumberOfElements) => {
					it(`page number: ${pageNumber}`, () =>
						// Act + Assert:
						runDbTest(
							{ blocks: blocks(12) },
							db => db.queryPagedDocuments_2([], [], { $sort: { id: 1 } }, 'blocks', { pageSize: 10, pageNumber }),
							page => {
								expect(page.data.length).to.equal(expectedNumberOfElements);
								expect(page.pagination).to.deep.equal({
									totalEntries: 12, pageNumber, pageSize: 10, totalPages: 2
								});
							}
						));
				};

				runPageNumberTest(1, 10);
				runPageNumberTest(2, 2);
				runPageNumberTest(3, 0);
			});
		});

		describe('does not promote MongoDb.Long to regular `number` for small enough numbers', () => {
			// Arrange:
			const blocks = () => ([{ _id: createObjectId(10), block: { height: Long.fromNumber(10) } }]);

			it('returns long', () =>
				// Act + Assert:
				runDbTest(
					{ blocks: blocks() },
					db => db.queryPagedDocuments_2([], [], sortConditions, 'blocks', options),
					page => {
						expect(page.data[0].block.height instanceof Long).to.be.equal(true);
					}
				));
		});
	});

	describe('transactions', () => {
		const account1 = { publicKey: test.random.publicKey() };
		account1.address = keyToAddress(account1.publicKey);
		const account2 = { publicKey: test.random.publicKey() };
		account2.address = keyToAddress(account2.publicKey);
		const account3 = { publicKey: test.random.publicKey() };
		account3.address = keyToAddress(account3.publicKey);

		const paginationOptions = {
			pageSize: 10,
			pageNumber: 1,
			sortField: '_id',
			sortDirection: -1
		};

		const { createObjectId } = test.db;

		const createTransaction = (objectId, addresses, height, signerPublicKey, recipientAddress, type) => ({
			_id: createObjectId(objectId),
			meta: {
				height,
				addresses: addresses.map(a => Buffer.from(a))
			},
			transaction: {
				signerPublicKey: signerPublicKey ? Buffer.from(signerPublicKey) : undefined,
				recipientAddress: recipientAddress ? Buffer.from(recipientAddress) : undefined,
				type
			}
		});

		const createInnerTransaction = (objectId, aggregateId, signerPublicKey, recipientAddress, type) => ({
			_id: createObjectId(objectId),
			meta: { aggregateId: createObjectId(aggregateId) },
			transaction: {
				signerPublicKey: signerPublicKey ? Buffer.from(signerPublicKey) : undefined,
				recipientAddress: recipientAddress ? Buffer.from(recipientAddress) : undefined,
				type
			}
		});

		const runTestAndVerifyIds = (dbTransactions, filters, options, expectedIds) => {
			const expectedObjectIds = expectedIds.map(id => createObjectId(id));

			return runDbTest(
				{ transactions: dbTransactions },
				db => db.transactions(filters, options),
				transactionsPage => {
					const returnedIds = transactionsPage.data.map(t => t.id);
					expect(transactionsPage.data.length).to.equal(expectedObjectIds.length);
					expect(returnedIds.sort()).to.deep.equal(expectedObjectIds.sort());
				}
			);
		};

		it('returns expected structure', () => {
			// Arrange:
			const dbTransactions = [
				createTransaction(10, [account1.address], 123, account1.publicKey, account2.address, EntityType.transfer)
			];

			// Act + Assert:
			return runDbTest(
				{ transactions: dbTransactions },
				db => db.transactions({}, paginationOptions),
				page => {
					const expected_keys = ['meta', 'transaction', 'id'];
					expect(Object.keys(page.data[0]).sort()).to.deep.equal(expected_keys.sort());
				}
			);
		});

		it('does not expose private meta.addresses field', () => {
			// Arrange:
			const dbTransactions = [
				createTransaction(10, [account1.address], 1, 0, 0, 0)
			];

			// Act + Assert:
			return runDbTest(
				{ transactions: dbTransactions },
				db => db.transactions({}, paginationOptions),
				transactionsPage => {
					expect(transactionsPage.data[0].meta.addresses).to.equal(undefined);
				}
			);
		});

		it('if address is provided signerPublicKey and recipientAddress are omitted', () => {
			// Arrange:
			const dbTransactions = [
				createTransaction(10, [account1.address], 1),
				createTransaction(20, [account1.address], 1, account1.publicKey),
				createTransaction(30, [account1.address], 1, account2.publicKey),
				createTransaction(40, [account1.address], 1, account1.publicKey, account1.address),
				createTransaction(50, [account1.address], 1, account2.publicKey, account2.address),
				createTransaction(60, [account2.address], 1)
			];

			const filters = {
				address: account1.address,
				signerPublicKey: account1.publicKey,
				recipientAddress: account1.address
			};

			// Act + Assert:
			return runTestAndVerifyIds(dbTransactions, filters, paginationOptions, [10, 20, 30, 40, 50]);
		});

		it('ignores inner aggregate transactions in the results', () => {
			// Arrange:
			const dbTransactions = [
				// Aggregate
				createTransaction(10, [], 1, 0, 0, EntityType.aggregateComplete),
				createInnerTransaction(100, 30, 0, 0, EntityType.mosaicDefinition),
				createInnerTransaction(200, 30, 0, 0, EntityType.mosaicSupplyChange),

				createTransaction(20, [], 1, 0, 0, EntityType.aggregateBonded),
				createInnerTransaction(300, 30, 0, 0, EntityType.transfer),
				createInnerTransaction(400, 30, 0, 0, EntityType.mosaicDefinition),

				createTransaction(30, [], 1, 0, 0, EntityType.aggregateComplete),
				createInnerTransaction(500, 30, 0, 0, EntityType.registerNamespace)
			];

			const filters = {
				transactionTypes: [EntityType.transfer, EntityType.mosaicDefinition, EntityType.aggregateComplete]
			};

			// Act + Assert:
			return runTestAndVerifyIds(dbTransactions, filters, paginationOptions, [10, 30]);
		});

		it('returns correct transactions when no filters are provided', () => {
			// Arrange:
			const dbTransactions = [
				createTransaction(10, [account1.address], 1),
				createTransaction(20, [account1.address], 1, account1.publicKey),
				createTransaction(30, [account1.address], 1, account1.publicKey, account1.address),
				createTransaction(40, [account1.address], 1, account1.publicKey, account1.address, EntityType.transfer)
			];

			// Act + Assert:
			return runTestAndVerifyIds(dbTransactions, {}, paginationOptions, [10, 20, 30, 40]);
		});

		it('all the provided filters are taken into account', () => {
			// Arrange:
			const dbTransactions = [
				createTransaction(10, [account1.address], 1),
				createTransaction(20, [account1.address], 1),
				createTransaction(30, [account1.address], 1, account1.publicKey),
				createTransaction(40, [account1.address], 1, account1.publicKey, account1.address),
				createTransaction(50, [account1.address], 1, account1.publicKey, account1.address, EntityType.transfer)
			];

			const filters = {
				height: 1,
				signerPublicKey: account1.publicKey,
				recipientAddress: account1.address,
				transactionTypes: [EntityType.transfer]
			};

			// Act + Assert:
			return runTestAndVerifyIds(dbTransactions, filters, paginationOptions, [50]);
		});

		describe('respects offset', () => {
			// Arrange:
			const dbTransactions = () => [
				createTransaction(10, [], 20),
				createTransaction(20, [], 30),
				createTransaction(30, [], 10)
			];
			const options = {
				pageSize: 10,
				pageNumber: 1,
				sortField: '_id',
				sortDirection: 1,
				offset: createObjectId(20).toString()
			};

			it('gt', () => {
				options.sortDirection = 1;

				// Act + Assert:
				return runTestAndVerifyIds(dbTransactions(), {}, options, [30]);
			});

			it('lt', () => {
				options.sortDirection = -1;

				// Act + Assert:
				return runTestAndVerifyIds(dbTransactions(), {}, options, [10]);
			});
		});

		describe('respects sort conditions', () => {
			// Arrange:
			const dbTransactions = () => [
				createTransaction(10, [], 20),
				createTransaction(20, [], 30),
				createTransaction(30, [], 10)
			];

			it('direction ascending', () => {
				const options = {
					pageSize: 10,
					pageNumber: 1,
					sortField: '_id',
					sortDirection: 1
				};

				// Act + Assert:
				return runDbTest(
					{ transactions: dbTransactions() },
					db => db.transactions([], options),
					transactionsPage => {
						expect(transactionsPage.data[0].id).to.deep.equal(createObjectId(10));
						expect(transactionsPage.data[1].id).to.deep.equal(createObjectId(20));
						expect(transactionsPage.data[2].id).to.deep.equal(createObjectId(30));
					}
				);
			});

			it('direction descending', () => {
				const options = {
					pageSize: 10,
					pageNumber: 1,
					sortField: '_id',
					sortDirection: -1
				};

				// Act + Assert:
				return runDbTest(
					{ transactions: dbTransactions() },
					db => db.transactions([], options),
					transactionsPage => {
						expect(transactionsPage.data[0].id).to.deep.equal(createObjectId(30));
						expect(transactionsPage.data[1].id).to.deep.equal(createObjectId(20));
						expect(transactionsPage.data[2].id).to.deep.equal(createObjectId(10));
					}
				);
			});

			it('sort field', () => {
				const options = {
					pageSize: 10,
					pageNumber: 1,
					sortField: 'meta.height',
					sortDirection: 1
				};

				// Act + Assert:
				return runDbTest(
					{ transactions: dbTransactions() },
					db => db.transactions([], options),
					transactionsPage => {
						expect(transactionsPage.data[0].id).to.deep.equal(createObjectId(30));
						expect(transactionsPage.data[1].id).to.deep.equal(createObjectId(10));
						expect(transactionsPage.data[2].id).to.deep.equal(createObjectId(20));
					}
				);
			});
		});

		describe('correctly applies each filter:', () => {
			it('height', () => {
				// Arrange:
				const dbTransactions = [
					createTransaction(10, [], 5),
					createTransaction(20, [], 10),
					createTransaction(30, [], 15)
				];

				const filters = { height: 10 };

				// Act + Assert:
				return runTestAndVerifyIds(dbTransactions, filters, paginationOptions, [20]);
			});

			it('address', () => {
				// Arrange:
				const dbTransactions = [
					createTransaction(10, [account1.address], 1),
					createTransaction(20, [account2.address], 1),
					createTransaction(30, [account3.address], 1),
					createTransaction(40, [account2.address, account1.address], 1),
					createTransaction(50, [account3.address, account1.address], 1)
				];

				const filters = { address: account1.address };

				// Act + Assert:
				return runTestAndVerifyIds(dbTransactions, filters, paginationOptions, [10, 40, 50]);
			});

			it('signerPublicKey', () => {
				// Arrange:
				const dbTransactions = [
					// Non aggregate
					createTransaction(10, [], 1, account1.publicKey),
					createTransaction(20, [], 1, account2.publicKey),

					// Aggregate
					createTransaction(30, [], 1, account1.publicKey),
					createInnerTransaction(100, 30, account2.publicKey),
					createInnerTransaction(200, 30, account2.publicKey),

					createTransaction(40, [], 1, account2.publicKey),
					createInnerTransaction(300, 40, account1.publicKey),
					createInnerTransaction(400, 40, account2.publicKey),

					createTransaction(50, [], 1, account2.publicKey),
					createInnerTransaction(500, 50, account2.publicKey)
				];

				const filters = { signerPublicKey: account1.publicKey };

				// Act + Assert:
				return runTestAndVerifyIds(dbTransactions, filters, paginationOptions, [10, 30]);
			});

			it('recipientAddress', () => {
				// Arrange:
				const dbTransactions = [
					// Non aggregate
					createTransaction(10, [], 1, 0, account1.address),
					createTransaction(20, [], 1, 0, account2.address),

					// Aggregate
					createTransaction(30, [], 1, 0, account1.address),
					createInnerTransaction(100, 30, 0, account2.address),
					createInnerTransaction(200, 30, 0, account2.address),

					createTransaction(40, [], 1, 0, account2.address),
					createInnerTransaction(300, 40, 0, account1.address),
					createInnerTransaction(400, 40, 0, account2.address),

					createTransaction(50, [], 1, 0, account2.address),
					createInnerTransaction(500, 50, 0, account2.address)
				];

				const filters = { recipientAddress: account1.address };

				// Act + Assert:
				return runTestAndVerifyIds(dbTransactions, filters, paginationOptions, [10, 30]);
			});

			it('transactionTypes', () => {
				// Arrange:
				const dbTransactions = [
					// Non aggregate
					createTransaction(10, [], 1, 0, 0, EntityType.transfer),
					createTransaction(20, [], 1, 0, 0, EntityType.accountLink),

					// Aggregate
					createTransaction(30, [], 1, 0, 0, EntityType.aggregateBonded),
					createInnerTransaction(100, 30, 0, 0, EntityType.mosaicDefinition),
					createInnerTransaction(200, 30, 0, 0, EntityType.mosaicSupplyChange),

					createTransaction(40, [], 1, 0, 0, EntityType.aggregateComplete),
					createInnerTransaction(300, 40, 0, 0, EntityType.transfer),
					createInnerTransaction(400, 40, 0, 0, EntityType.transfer),

					createTransaction(50, [], 1, 0, 0, EntityType.aggregateBonded),
					createInnerTransaction(500, 50, 0, 0, EntityType.registerNamespace),
					createInnerTransaction(600, 50, 0, 0, EntityType.aliasAddress)
				];

				const filters = {
					transactionTypes: [EntityType.mosaicDefinition, EntityType.aggregateComplete, EntityType.transfer]
				};

				// Act + Assert:
				return runTestAndVerifyIds(dbTransactions, filters, paginationOptions, [10, 40]);
			});

			describe('state', () => {
				// Arrange:
				const dbTransactions = () => ({
					transactions: [createTransaction(10, [], 1)],
					partialTransactions: [createTransaction(20, [], 1)],
					unconfirmedTransactions: [createTransaction(30, [], 1)]
				});

				const runStateTest = (state, expectedIds) => {
					it(`state: ${state}`, () => {
						const expectedObjectIds = expectedIds.map(id => createObjectId(id));

						return runDbTest(
							dbTransactions(),
							db => db.transactions({ state }, paginationOptions),
							transactionsPage => {
								const returnedIds = transactionsPage.data.map(t => t.id);
								expect(transactionsPage.data.length).to.equal(expectedObjectIds.length);
								expect(returnedIds.sort()).to.deep.equal(expectedObjectIds.sort());
							}
						);
					});
				};

				runStateTest('confirmed', [10]);
				runStateTest('partial', [20]);
				runStateTest('unconfirmed', [30]);

				it('defaults to confirmed', () =>
					// Act + Assert:
					runDbTest(
						dbTransactions(),
						db => db.transactions({}, paginationOptions),
						transactionsPage => {
							expect(transactionsPage.data.length).to.equal(1);
							expect(transactionsPage.data[0].id).to.deep.equal(createObjectId(10));
						}
					));
			});

			describe('embedded', () => {
				// Arrange:
				const dbTransactions = () => [
					// Non aggregate
					createTransaction(10, [], 1),

					// Aggregate
					createTransaction(20, [], 1),
					createInnerTransaction(100, 20)
				];

				const runEmbeddedTest = (embedded, expectedIds) =>
					it(`embedded: ${embedded}`, () =>
						// Act + Assert:
						runTestAndVerifyIds(dbTransactions(), { embedded }, paginationOptions, expectedIds));

				runEmbeddedTest(true, [10, 20, 100]);
				runEmbeddedTest(false, [10, 20]);

				it('defaults to false', () =>
					// Act + Assert:
					runTestAndVerifyIds(dbTransactions(), {}, paginationOptions, [10, 20]));
			});
		});
	});

	describe('account get', () => {
		const publicKey = test.random.publicKey();
		const decodedAddress = keyToAddress(publicKey);
		const publicKeyUnknown = test.random.publicKey();
		const decodedAddressUnknown = keyToAddress(publicKeyUnknown);

		const transformDbAccount = (dbAccountDocument, numImportances) => {
			// the db call should replace importances with the most recent importance and importance height,
			// so update the expected object to match
			const accountWithMetadata = Object.assign({}, dbAccountDocument);
			const { account } = accountWithMetadata;
			account.importance = Long.fromNumber(numImportances);
			account.importanceHeight = Long.fromNumber(numImportances * numImportances);
			delete account.importances;
			return accountWithMetadata;
		};

		const runSingleKnownAccountTest = (description, accountId, options) => {
			it(description, () => {
				// Arrange:
				// note: createAccounts uses options.numImportances to seed the importances for the accounts
				//       with values i for the importance and i * i for the importance height (0 < i <= numImportances)
				//       the last entry thus is (numImportances, numImportances * numImportances)
				const seedAccounts = test.db.createAccounts(publicKey, options);

				// Assert:
				return runDbTest(
					{ accounts: seedAccounts },
					db => db.accountsByIds([accountId]),
					accounts => {
						// Assert: compare against the transformed account instead of the db account
						const account = transformDbAccount(seedAccounts[0], options.numImportances);
						expect(accounts).to.deep.equal([account]);
					}
				);
			});
		};

		const runUnknownAccountTest = (accountId, options) => {
			it('returns empty array for unknown ids', () =>
				// Assert:
				runDbTest(
					{ accounts: test.db.createAccounts(publicKey, options) },
					db => db.accountsByIds([accountId]),
					accounts => expect(accounts).to.deep.equal([])
				));
		};

		const addAccountsByIdsTestsForSingleAccountLookup = (knownAccountId, unknownAccountId) => {
			runSingleKnownAccountTest(
				'can retrieve account with neither public key nor mosaics',
				knownAccountId,
				{ savePublicKey: false, numMosaics: 0 }
			);
			runSingleKnownAccountTest(
				'can retrieve account with public key but no mosaics',
				knownAccountId,
				{ savePublicKey: true, numMosaics: 0 }
			);
			runSingleKnownAccountTest(
				'can retrieve account without public key but with mosaics',
				knownAccountId,
				{ savePublicKey: false, numMosaics: 3 }
			);
			runSingleKnownAccountTest(
				'can retrieve account with public key and with mosaics',
				knownAccountId,
				{ savePublicKey: true, numMosaics: 3 }
			);
			runSingleKnownAccountTest(
				'can retrieve account without importances',
				knownAccountId,
				{ savePublicKey: true, numMosaics: 3, numImportances: 0 }
			);
			runSingleKnownAccountTest(
				'can retrieve account with single importance',
				knownAccountId,
				{ savePublicKey: true, numMosaics: 3, numImportances: 1 }
			);
			runUnknownAccountTest(
				unknownAccountId,
				{ savePublicKey: false, numMosaics: 3, expectedAddress: decodedAddressUnknown }
			);
		};

		describe('account from decoded address', () => {
			addAccountsByIdsTestsForSingleAccountLookup({ address: decodedAddress }, { address: decodedAddressUnknown });
		});

		describe('account from public key', () => {
			// note: even if public key is not known in the accounts collection, the call to accountsByIds()
			//       will succeed since the public key is converted to a decoded address.
			addAccountsByIdsTestsForSingleAccountLookup({ publicKey }, { publicKey: publicKeyUnknown });
		});

		describe('multiple accounts', () => {
			const runMultipleAccountsByIdsTests = runTest => {
				// Arrange: create 5 random accounts and extract their public keys
				const seedAccounts = test.db.createAccounts(test.random.publicKey(), {
					numAccounts: 4,
					savePublicKey: true,
					saveRandomPublicKey: true,
					numMosaics: 3,
					numImportances: 1
				});
				const publicKeys = seedAccounts.map(seedAccount => seedAccount.account.publicKey.buffer);

				// Assert:
				return runTest(seedAccounts, publicKeys);
			};

			it('returns multiple matching accounts', () =>
				// Arrange:
				runMultipleAccountsByIdsTests((seedAccounts, publicKeys) => runDbTest(
					{ accounts: seedAccounts },
					db => db.accountsByIds([
						{ publicKey: publicKeys[1] },
						{ address: keyToAddress(publicKeys[3]) },
						{ publicKey: publicKeys[4] }
					]),
					accounts => expect(accounts).to.deep.equal([1, 3, 4].map(index => transformDbAccount(seedAccounts[index], 1)))
				)));

			it('returns only known matching accounts', () =>
				// Arrange:
				runMultipleAccountsByIdsTests((seedAccounts, publicKeys) => runDbTest(
					{ accounts: seedAccounts },
					db => db.accountsByIds([
						{ publicKey: publicKeys[1] },
						{ publicKey: test.random.publicKey() },
						{ address: test.random.address() },
						{ address: keyToAddress(publicKeys[3]) }
					]),
					accounts => expect(accounts).to.deep.equal([1, 3].map(index => transformDbAccount(seedAccounts[index], 1)))
				)));
		});
	});

	// region failed transactions

	describe('failed transactions by hashes', () => {
		const runTransactionsByHashesFailedTest = (numSeeds, runTest) => {
			// Arrange:
			const hashes = Array.from(Array(numSeeds), () => test.random.hash());
			const failedTransactionResults = [];
			for (let i = 0; i < numSeeds; ++i)
				failedTransactionResults.push({ status: { hash: new Binary(hashes[i]), validationResult: i } });

			// Assert:
			return runTest(failedTransactionResults, hashes);
		};

		it('returns empty array for unknown hashes', () =>
			// Arrange:
			runTransactionsByHashesFailedTest(3, seedResults => runDbTest(
				{ transactionStatuses: seedResults },
				db => db.transactionsByHashesFailed([test.random.hash(), test.random.hash()]),
				results => { expect(results).to.deep.equal([]); }
			)));

		it('returns single matching failed transaction', () =>
			// Arrange:
			runTransactionsByHashesFailedTest(3, (seedResults, hashes) => runDbTest(
				{ transactionStatuses: seedResults },
				db => db.transactionsByHashesFailed([hashes[1]]),
				results => { expect(results).to.deep.equal([seedResults[1]]); }
			)));

		it('returns multiple matching failed transactions', () =>
			// Arrange:
			runTransactionsByHashesFailedTest(5, (seedResults, hashes) => runDbTest(
				{ transactionStatuses: seedResults },
				db => db.transactionsByHashesFailed([1, 3, 4].map(index => hashes[index])),
				results => { expect(results).to.deep.equal([1, 3, 4].map(index => seedResults[index])); }
			)));

		it('returns only known matching failed transactions', () =>
			// Arrange:
			runTransactionsByHashesFailedTest(3, (seedResults, hashes) => runDbTest(
				{ transactionStatuses: seedResults },
				db => db.transactionsByHashesFailed([hashes[0], test.random.hash(), hashes[2], test.random.hash()]),
				results => { expect(results).to.deep.equal([0, 2].map(index => seedResults[index])); }
			)));
	});

	// endregion

	// region utils

	describe('utils', () => {
		it('can retrieve account public key from account address', () => {
			// Arrange:
			const accountPublicKeyOne = test.random.publicKey();
			const accountAddressOne = keyToAddress(accountPublicKeyOne);
			const accountPublicKeyTwo = test.random.publicKey();
			const accountAddressTwo = keyToAddress(accountPublicKeyTwo);

			const accountDbEntities = [
				{
					meta: {},
					account: {
						address: new Binary(accountAddressOne),
						publicKey: new Binary(accountPublicKeyOne)
					}
				},
				{
					meta: {},
					account: {
						address: new Binary(accountAddressTwo),
						publicKey: new Binary(accountPublicKeyTwo)
					}
				}
			];

			// Act + Assert:
			return runDbTest(
				{ accounts: accountDbEntities },
				db => db.addressToPublicKey(accountAddressOne),
				accountDbEntity => { expect(accountDbEntity.account.publicKey.buffer.equals(accountPublicKeyOne)).to.be.equal(true); }
			);
		});
	});

	// endregion
});
