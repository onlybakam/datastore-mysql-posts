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
  DeltaSyncTableTTL: 30, // 30 minutes
  BaseTableTTL: 43200, // 30 days in minutes
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

const tableName = (belongsTo) => {
  return belongsTo[0].toUpperCase() + belongsTo.slice(1) + 's'
}

const toModel = (row, belongsTo) => {
  const mysql_id = row.id
  let pid, _deleted
  const id = row.datastore_uuid || `datastore-uuid-${row.id}`
  if (belongsTo) {
    pid = row.parentUUID
    _deleted = row.parentDeleted
  }
  return {
    ...row,
    mysql_id,
    id,
    _lastChangedAt: parseInt(new Date(row._lastChangedAt).getTime() / 1_000),
    ...(belongsTo && pid && _deleted !== undefined
      ? { [belongsTo]: { id: pid, _deleted } }
      : null),
  }
}

const _query = async ({
  args: { limit = 1_000, lastSync, nextToken: inNextToken },
  table,
  connection,
  belongsTo,
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

  if (belongsTo) {
    const parentTable = tableName(belongsTo)
    sql = `SELECT ${table}.*, ${parentTable}.datastore_uuid as parentUUID, ${parentTable}._deleted as parentDeleted from ${table}, ${parentTable} WHERE ${table}._deleted = ? and ${table}.${belongsTo}ID = ${parentTable}.datastore_uuid`
  } else {
    sql = `SELECT * FROM ${table} WHERE _deleted = ?`
  }

  if (lastSync === undefined) {
    sql += ` ORDER BY ${table}.id LIMIT ?, ?`
    values = [false, offset, limit]
  } else if (lastSync < moment) {
    sql += ` AND ${table}._lastChangedAt > FROM_UNIXTIME(?/1000) ORDER BY ${table}.id LIMIT ?, ?`
    values = [false, lastSync, offset, limit]
  } else {
    //todo: implement delta sync on a separate table?
    sql += ` AND ${table}._lastChangedAt > FROM_UNIXTIME(?/1000) ORDER BY ${table}.id LIMIT ?, ?`
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
  const items = rows.map((row) => toModel(row, belongsTo))

  return { items, startedAt, nextToken }
}

const _create = async ({ args: { input }, table, connection, belongsTo }) => {
  const { id = uuidv4(), ...rest } = input
  const item = { ...rest, datastore_uuid: id }
  const keys = Object.keys(item)

  let sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES(${keys
    .map((k) => '?')
    .join(',')})`
  let values = keys.map((k) => item[k])

  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))

  const [result] = await connection.query(sql, values)
  console.log(`result >`, JSON.stringify(result, null, 2))

  if (belongsTo) {
    const parentTable = tableName(belongsTo)
    sql = `SELECT ${table}.*, ${parentTable}.datastore_uuid as parentUUID, ${parentTable}._deleted as parentDeleted from ${table}, ${parentTable} WHERE ${table}.id = ? AND ${table}.${belongsTo}ID = ${parentTable}.datastore_uuid`
  } else {
    sql = `SELECT * FROM ${table} WHERE id = ?`
  }
  values = [result.insertId]

  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))

  const [[row]] = await connection.query(sql, values)
  console.log(`row >`, JSON.stringify(row, null, 2))

  return { data: toModel(row, belongsTo) }
}

const _update = async ({ args: { input }, table, connection, belongsTo }) => {
  const { id: uuid, _version = 0, ...item } = input

  const keys = Object.keys(item)

  let sql = `UPDATE ${table} SET ${keys
    .map((k) => k + ' = ?')
    .join(
      ', '
    )}, _version=_version+1 WHERE datastore_uuid = ? AND _version >= ?`
  let values = keys.map((k) => item[k])
  values.push(uuid)
  values.push(_version)

  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))

  const [result] = await connection.query(sql, values)
  console.log(`result >`, JSON.stringify(result, null, 2))

  if (belongsTo) {
    const parentTable = tableName(belongsTo)
    sql = `SELECT ${table}.*, ${parentTable}.datastore_uuid as parentUUID, ${parentTable}._deleted as parentDeleted from ${table}, ${parentTable} WHERE ${table}.datastore_uuid = ? AND ${table}.${belongsTo}ID = ${parentTable}.datastore_uuid`
  } else {
    sql = `SELECT * FROM ${table} WHERE datastore_uuid = ?`
  }
  values = [uuid]

  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))

  const [[row]] = await connection.query(sql, values)
  console.log(`row >`, JSON.stringify(row, null, 2))

  if (result.affectedRows !== 1) {
    console.log('version mismatch on item')
    return {
      data: toModel(row),
      errorMessage: 'Conflict',
      errorType: 'ConflictUnhandled',
    }
  }

  return { data: toModel(row) }
}

const _delete = async ({ args: { input }, table, connection, belongsTo }) => {
  const { id: uuid, _version = 0 } = input

  let sql = `UPDATE ${table} SET _deleted=true, _version=_version+1, ttl = TIMESTAMPADD(MINUTE, ?, CURRENT_TIMESTAMP(3)) WHERE datastore_uuid = ? AND _version >= ?`
  let values = [DeltaSyncConfig.BaseTableTTL, uuid, _version]

  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))

  const [result] = await connection.query(sql, values)
  console.log(`result >`, JSON.stringify(result, null, 2))

  if (belongsTo) {
    const parentTable = tableName(belongsTo)
    sql = `SELECT ${table}.*, ${parentTable}.datastore_uuid as parentUUID, ${parentTable}._deleted as parentDeleted from ${table}, ${parentTable} WHERE ${table}.datastore_uuid = ? AND ${table}.${belongsTo}ID = ${parentTable}.datastore_uuid`
  } else {
    sql = `SELECT * FROM ${table} WHERE datastore_uuid = ?`
  }
  values = [uuid]

  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))

  const [[row]] = await connection.query(sql, values)
  console.log(`row >`, JSON.stringify(row, null, 2))

  return { data: toModel(row) }
}

const operations = {
  syncPosts: { fn: _query, table: 'Posts' },
  syncComments: { fn: _query, table: 'Comments', belongsTo: 'post' },
  createPost: { fn: _create, table: 'Posts' },
  createComment: { fn: _create, table: 'Comments', belongsTo: 'post' },
  updatePost: { fn: _update, table: 'Posts' },
  updateComment: { fn: _update, table: 'Comments', belongsTo: 'post' },
  deletePost: { fn: _delete, table: 'Posts' },
  deleteComment: { fn: _delete, table: 'Comments', belongsTo: 'post' },
}

exports.handler = async (event) => {
  try {
    console.log(`passed event >`, JSON.stringify(event, null, 2))

    const { fieldName: operation, arguments: args } = event

    if (operation in operations) {
      const connection = await init()
      const { fn, table, belongsTo } = operations[operation]
      const result = await fn.apply(undefined, [
        { table, args, connection, belongsTo },
      ])
      await connection.end()
      return result
    }
  } catch (error) {
    console.log(`handler error >`, JSON.stringify(error, null, 2))
    return {
      data: null,
      errorMessage: error.message || JSON.stringify(error),
      errorType: 'InternalFailure',
    }
  }
}
