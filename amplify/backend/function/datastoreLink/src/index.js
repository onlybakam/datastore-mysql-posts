const AWS = require('aws-sdk')
const mysql = require('mysql2/promise')

const {
  util: {
    uuid: { v4: uuidv4 },
  },
} = AWS

let secretsManager = new AWS.SecretsManager()
const { SM_EXAMPLE_DATABASE_CREDENTIALS, URL_RDS_PROXY } = process.env

const DeltaSyncConfig = {
  DeltaSyncTableTTL: 30,
  BaseTableTTL: 43200,
}
const MIN_TO_MILLI = 60 * 1000

const init = async () => {
  let sm = await secretsManager
    .getSecretValue({ SecretId: SM_EXAMPLE_DATABASE_CREDENTIALS })
    .promise()

  const credentials = JSON.parse(sm.SecretString)

  const connectionConfig = {
    host: URL_RDS_PROXY,
    port: credentials.port,
    user: credentials.username,
    password: credentials.password,
    database: credentials.dbname,
  }
  return await mysql.createConnection(connectionConfig)
}

const q = (str) => '`' + str + '`'

const clean = (row) => {
  const mysql_id = row.id
  const id = row.datastore_uuid || `datastore-uuid-${row.id}`
  return {
    ...row,
    mysql_id,
    id,
    _lastChangedAt: parseInt(new Date(row._lastChangedAt).getTime() / 1_000),
  }
}

const _query = async ({
  args: { limit = 100, lastSync, nextToken: inNextToken },
  table,
  connection,
}) => {
  const startedAt = Date.now()
  const moment = startedAt - DeltaSyncConfig.DeltaSyncTableTTL * MIN_TO_MILLI
  let sql
  let values = []
  let offset = 0
  if (inNextToken) {
    const tokenInfo = JSON.parse(Buffer.from(inNextToken, 'base64').toString())
    offset = tokenInfo.offset
  }

  if (lastSync === undefined) {
    sql = `SELECT * FROM ${q(table)} WHERE ${q('_deleted')} = ? ORDER BY ${q(
      'id'
    )} LIMIT ?, ?`
    values = [false, offset, limit]
  } else if (lastSync < moment) {
    sql =
      'SELECT * FROM `' +
      table +
      '` WHERE `_deleted` = ? AND _lastChangedAt > FROM_UNIXTIME(?/1000) ORDER BY `id` LIMIT ?, ?'
    values = [false, lastSync, offset, limit]
  } else {
    //todo: implement delta sync on a separate table?
    sql =
      'SELECT * FROM `' +
      table +
      '` WHERE `_deleted` = ? AND _lastChangedAt > FROM_UNIXTIME(?/1000) ORDER BY `id` LIMIT ?, ?'
    values = [false, lastSync, offset, limit]
  }
  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))

  const [rows] = await connection.execute(sql, values)
  console.log(`rows >`, JSON.stringify(rows, null, 2))

  let nextToken = null
  if (rows.length >= limit) {
    nextToken = Buffer.from(
      JSON.stringify({ offset: offset + rows.length })
    ).toString('base64')
  }
  const items = rows.map((row) => clean(row))

  return { items, startedAt, nextToken }
}

const _create = async ({ args: { input }, table, connection }) => {
  const { id = uuidv4(), ...rest } = input
  const item = { ...rest, datastore_uuid: id }
  const keys = Object.keys(item)

  let sql =
    'INSERT INTO `' +
    table +
    '` ' +
    `(${keys.join(',')}) VALUES(${keys.map((k) => '?').join(',')})`
  let values = keys.map((k) => item[k])

  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))

  const [result] = await connection.query(sql, values)
  console.log(`result >`, JSON.stringify(result, null, 2))

  sql = 'SELECT * FROM `' + table + '` WHERE `id` = ?'
  values = [result.insertId]

  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))

  const [[row]] = await connection.query(sql, values)
  console.log(`row >`, JSON.stringify(row, null, 2))

  return { data: clean(row) }
}

const _update = async ({ args: { input }, table, connection }) => {
  const { id: uuid, _version = 0, ...rest } = input

  const keys = Object.keys(rest)

  let sql =
    'UPDATE `' +
    table +
    '` SET ' +
    `${keys.map((k) => k + ' = ?').join(', ')} ` +
    'WHERE `datastore_uuid` = ? AND `_version` >= ?'
  let values = keys.map((k) => rest[k])
  values.push(uuid)
  values.push(_version)

  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))

  const [result] = await connection.query(sql, values)
  console.log(`result >`, JSON.stringify(result, null, 2))

  sql = 'SELECT * FROM `' + table + '` WHERE `datastore_uuid` = ?'
  values = [uuid]

  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))

  const [[item]] = await connection.query(sql, values)
  console.log(`row >`, JSON.stringify(item, null, 2))

  if (result.affectedRows !== 1) {
    console.log('version mismatch on item')
    return {
      data: clean(item),
      errorMessage: 'Conflict',
      errorType: 'ConflictUnhandled',
    }
  }

  return { data: clean(item) }
}

const _delete = async ({ args: { input }, table, connection }) => {
  const { id: uuid, _version = 0 } = input
  const rest = { _version: '`_version` + 1', _deleted: true }

  const keys = Object.keys(rest)
  let values = keys.map((k) => rest[k])
  values.push(uuid)
  values.push(_version)

  let sql =
    'UPDATE `' +
    table +
    '` SET ' +
    `${keys.map((k) => k + ' = ?').join(', ')} ` +
    'WHERE `datastore_uuid` = ? AND `_version` >= ?'

  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))

  const [result] = await connection.query(sql, values)
  console.log(`result >`, JSON.stringify(result, null, 2))

  sql = 'SELECT * FROM `' + table + '` WHERE `datastore_uuid` = ?'
  values = [uuid]

  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))

  const [[row]] = await connection.query(sql, values)
  console.log(`row >`, JSON.stringify(row, null, 2))

  return { data: clean(row) }
}

const operations = {
  syncPosts: { fn: _query, table: 'Posts' },
  syncComments: { fn: _query, table: 'Comments' },
  createPost: { fn: _create, table: 'Posts' },
  createComment: { fn: _create, table: 'Comments' },
  updatePost: { fn: _update, table: 'Posts' },
  updateComment: { fn: _update, table: 'Comments' },
  deletePost: { fn: _delete, table: 'Posts' },
  deleteComment: { fn: _delete, table: 'Comments' },
}

exports.handler = async (event) => {
  console.log(`passed event >`, JSON.stringify(event, null, 2))

  const { fieldName: operation, arguments: args } = event

  const connection = await init()

  if (operation in operations) {
    const { fn, table } = operations[operation]
    const result = await fn.apply(undefined, [{ table, args, connection }])
    await connection.end()
    return result
  }
}
