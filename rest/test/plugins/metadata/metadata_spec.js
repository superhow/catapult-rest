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

const MetadataDb = require('../../../src/plugins/metadata/MetadataDb');
const metadata = require('../../../src/plugins/metadata/metadata');
const { test } = require('../../routes/utils/routeTestUtils');
const pluginTest = require('../utils/pluginTestUtils');

describe('metadata plugin', () => {
	pluginTest.assertThat.pluginCreatesDb(metadata, MetadataDb);
	pluginTest.assertThat.pluginDoesNotRegisterAdditionalTransactionStates(metadata);
	pluginTest.assertThat.pluginDoesNotRegisterAdditionalMessageChannels(metadata);

	describe('register routes', () => {
		it('registers GET routes', () => {
			// Arrange:
			const routes = [];
			const server = test.setup.createCapturingMockServer('get', routes);
			const registeredRoutes = [];
			['mosaic', 'namespace'].forEach(entity => {
				registeredRoutes.push(`/metadata/${entity}/:${entity}Id`);
				registeredRoutes.push(`/metadata/${entity}/:${entity}Id/key/:key`);
				registeredRoutes.push(`/metadata/${entity}/:${entity}Id/key/:key/sender/:senderAddress`);
			});

			registeredRoutes.push('/metadata/account/:address');
			registeredRoutes.push('/metadata/account/:address/key/:key');
			registeredRoutes.push('/metadata/account/:address/key/:key/sender/:senderAddress');

			// Act:
			metadata.registerRoutes(server, {});

			// Assert:
			test.assert.assertRoutes(routes, registeredRoutes);
		});
	});
});
