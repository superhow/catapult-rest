# catapult-rest

[![Build Status](https://api.travis-ci.com/nemtech/catapult-rest.svg?branch=master)](https://travis-ci.com/nemtech/catapult-rest)
[![Coverage Status](https://coveralls.io/repos/github/nemtech/catapult-rest/badge.svg?branch=master)](https://coveralls.io/github/nemtech/catapult-rest?branch=master)

Catapult REST gateway combines HTTP and WebSockets to perform read and write actions on the blockchain.

## Requirements

- NodeJS version 12
- [yarn][yarn] dependency manager
- [catapult-server][catapult-server] configured as an [API node][api-node].
- MongoDb 4.2

## Installation

1. Edit ``rest/resources/rest.json`` configuration:

| Parameter | Description | Example  |
|-|-|-|
| db.url | MongoDB connection URL. | mongodb://localhost:27017/ |
| apiNode.host | API node connection host. | 127.0.0.1 |
| apiNode.port | API node connection port. | 7900 |
| apiNode.tlsClientCertificatePath | API node TLS client certificate path. | /api-node-config/cert/node.crt.pem |
| apiNode.tlsClientKeyPath | API node TLS client key certificate path.  | /api-node-config/cert/node.key.pem |
| apiNode.tlsCaCertificatePath| API node TLS CA certificate path. | /api-node-config/cert/ca.cert.pem |
| websocket.mq.host | ZeroMQ connection host. |  127.0.0.1 |
| websocket.mq.port | ZeroMQ connection port. |  7902 |

> **Note:** catapult-rest has to reach the API node, ZeroMQ and MongoDB ports. If you are running catapult-server on a VPS, you can bind the ports to your local development environment creating an **SSH tunnel**: ``ssh -L 27017:localhost:27017 -L 7900:localhost:7900 -L 7902:localhost:7902 -p 2357 <USER>@<VPS_IP>``

2. Install the project's dependencies:

```
./yarn_setup.sh
```

3. Run catapult-rest:

```
cd rest
yarn build
yarn start resources/rest.json
```

## Usage

Please refer to the [documentation](https://nemtech.github.io/api.html) for more information.

## Contributing

Before contributing please [read this](CONTRIBUTING.md) and consider the following guidelines:
- Submit small and concise PRs that address a single and clear feature or issue
- Submit only fully tested code
- Split test scope areas with _Arrange/Act/Assert_ comments
- Use spontaneous comments only when necessary
- Follow linting rules - tests are set to fail if those aren't followed
- Notify or update related API resources of accepted changes ([OpenAPI](https://github.com/nemtech/symbol-openapi))

## License

Copyright (c) 2018 Jaguar0625, gimre, BloodyRookie, Tech Bureau, Corp Licensed under the [GNU Lesser General Public License v3](LICENSE)

[yarn]: https://yarnpkg.com/lang/en/
[catapult-server]: https://github.com/nemtech/catapult-server
[api-node]: https://nemtech.github.io/server.html#installation
