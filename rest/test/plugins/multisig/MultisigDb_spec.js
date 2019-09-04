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

const entitiesByAccounts = require('./entriesByAccountsTestUtils');
const test = require('./multisigDbTestUtils');
const AccountType = require('../../../src/plugins/AccountType');

describe('multisig db', () => {
	describe('multisigs by publicKey', () =>
		entitiesByAccounts.addTests({
			createEntry: (id, account) => test.db.createMultisigEntry(id, account),
			toDbApiId: owner => owner.publicKey,
			runDbTest: (entries, accountsToQuery, assertDbCommandResult) => test.db.runDbTest(
				entries,
				db => db.multisigsByAccounts(AccountType.publicKey, accountsToQuery),
				assertDbCommandResult
			)
		}));

	describe('multisigs by address', () =>
		entitiesByAccounts.addTests({
			createEntry: (id, account) => test.db.createMultisigEntry(id, account),
			toDbApiId: owner => owner.address,
			runDbTest: (entries, accountsToQuery, assertDbCommandResult) => test.db.runDbTest(
				entries,
				db => db.multisigsByAccounts(AccountType.address, accountsToQuery),
				assertDbCommandResult
			)
		}));
});