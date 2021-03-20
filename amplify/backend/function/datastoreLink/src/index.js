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
const DELTA_SYNC_PREFIX = 'DeltaSync'

const getSM = () => {
  return secretsManager
    .getSecretValue({ SecretId: SM_EXAMPLE_DATABASE_CREDENTIALS })
    .promise()
}

const initConn = (sm) => {
  const credentials = JSON.parse(sm.SecretString)
  const connectionConfig = {
    host: URL_RDS_PROXY,
    port: credentials.port,
    user: credentials.username,
    password: credentials.password,
    database: credentials.dbname,
  }
  return mysql.createConnection(connectionConfig)
}

const tableName = (belongsTo) =>
  belongsTo[0].toUpperCase() + belongsTo.slice(1) + 's'

const deltaSyncTable = (baseTable) => DELTA_SYNC_PREFIX + baseTable

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

const selectRow = async ({
  table,
  isUpdate,
  lookupId,
  belongsTo,
  connection,
}) => {
  let sql = null
  const lookupField = isUpdate ? 'datastore_uuid' : 'id'
  if (belongsTo) {
    const parentTable = tableName(belongsTo)
    sql = `
    SELECT ${table}.*, ${parentTable}.datastore_uuid as parentUUID, ${parentTable}._deleted as parentDeleted
    FROM ${table}
    INNER JOIN ${parentTable} ON ${table}.${belongsTo}ID = ${parentTable}.datastore_uuid
    WHERE ${table}.${lookupField} = ?`
  } else {
    sql = `SELECT * FROM ${table} WHERE ${lookupField} = ?`
  }
  const values = [lookupId]

  // RETRIEVE the row and potential parent
  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))
  const [[row]] = await connection.query(sql, values)
  console.log(`row >`, JSON.stringify(row, null, 2))
  return row
}

const writeToDeltaSyncTable = async ({ row, table, connection }) => {
  const ds = Object.assign({}, row)
  delete ds.id
  delete ds.ttl
  delete ds.parentUUID
  delete ds.parentDeleted
  delete ds.ttl
  const keys = Object.keys(ds)
  const sql = `INSERT INTO ${deltaSyncTable(table)} (${keys.join(
    ','
  )}, ttl) VALUES(${keys
    .map((k) => '?')
    .join(',')}, TIMESTAMPADD(MINUTE, ?, CURRENT_TIMESTAMP(3)))`
  const values = keys.map((k) => ds[k])
  values.push(DeltaSyncConfig.DeltaSyncTableTTL)

  console.log(`ds - execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`ds - with values >`, JSON.stringify(values, null, 2))
  const [result] = await connection.query(sql, values)
  console.log(`ds - result >`, JSON.stringify(result, null, 2))
  return result
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
    sql = `
    SELECT ${table}.*, ${parentTable}.datastore_uuid as parentUUID, ${parentTable}._deleted as parentDeleted
    FROM ${table}
    INNER JOIN ${parentTable} ON ${table}.${belongsTo}ID = ${parentTable}.datastore_uuid`
  } else {
    sql = `SELECT * FROM ${table}`
  }

  if (lastSync === undefined) {
    // If the lastSync field is not specified, a Scan on the Base table is performed.
    sql += ` ORDER BY ${table}.id LIMIT ?, ?`
    values = [offset, limit]
  } else if (lastSync < moment) {
    // the value is before the current moment - DeltaSyncTTL, a Scan on the Base table is performed.
    sql += ` WHERE ${table}._lastChangedAt > FROM_UNIXTIME(?/1000) ORDER BY ${table}.id LIMIT ?, ?`
    values = [lastSync, offset, limit]
  } else {
    // the value is on or after the current moment - DeltaSyncTTL, a Query on the Delta table is performed.
    const dsTable = deltaSyncTable(table)
    if (belongsTo) {
      const parentTable = tableName(belongsTo)
      sql = `
      SELECT ${dsTable}.*, ${parentTable}.datastore_uuid as parentUUID, ${parentTable}._deleted as parentDeleted
      FROM ${dsTable}
      INNER JOIN ${parentTable} ON ${dsTable}.${belongsTo}ID = ${parentTable}.datastore_uuid`
    } else {
      sql = `SELECT ${dsTable}.* FROM ${dsTable}`
    }
    sql += ` WHERE ${dsTable}._lastChangedAt > FROM_UNIXTIME(?/1000) ORDER BY ${dsTable}.id LIMIT ?, ?`
    values = [lastSync, offset, limit]
  }

  // FETCH the rows
  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))
  const [rows] = await connection.execute(sql, values)
  console.log(`rows >`, JSON.stringify(rows, null, 2))

  // EVALUATE next token
  let nextToken = null
  if (rows.length >= limit) {
    nextToken = Buffer.from(
      JSON.stringify({ offset: offset + rows.length })
    ).toString('base64')
  }
  const items = rows.map((row) => toModel(row, belongsTo))

  return { data: { items, startedAt, nextToken } }
}

const _create = async ({ args: { input }, table, connection, belongsTo }) => {
  const { id = uuidv4(), ...rest } = input
  const item = { ...rest, datastore_uuid: id }
  const keys = Object.keys(item)

  const insertSql = `INSERT INTO ${table} (${keys.join(',')}) VALUES(${keys
    .map((k) => '?')
    .join(',')})`
  const insertValues = keys.map((k) => item[k])

  // INSERT the new row
  console.log(`execute sql >`, JSON.stringify(insertSql, null, 2))
  console.log(`with values >`, JSON.stringify(insertValues, null, 2))
  const [result] = await connection.query(insertSql, insertValues)
  console.log(`result >`, JSON.stringify(result, null, 2))

  const row = await selectRow({
    table,
    isUpdate: false,
    lookupId: result.insertId,
    belongsTo,
    connection,
  })

  // UPDATE the DeltaSync table if row was created
  if (row && row.id) {
    await writeToDeltaSyncTable({ row, table, connection })
  }

  return { data: toModel(row, belongsTo) }
}

const _doUpdateTransactionWithRowLock = async ({
  sql,
  values,
  uuid,
  table,
  connection,
  belongsTo,
}) => {
  // START TRANSACTION to lock the row
  const transaction = await connection.query(`START TRANSACTION`)
  console.log(`start transaction >`, transaction)

  // TRY to lock the row for update
  const locksql = `SELECT * FROM ${table} WHERE datastore_uuid=? LOCK IN SHARE MODE;`
  const [[existing]] = await connection.query(locksql, [uuid])
  console.log(`existing with lock >`, JSON.stringify(existing, null, 2))

  // UPDATE the row - op specific
  console.log(`execute sql >`, JSON.stringify(sql, null, 2))
  console.log(`with values >`, JSON.stringify(values, null, 2))
  const [result] = await connection.query(sql, values)
  console.log(`result >`, JSON.stringify(result, null, 2))

  const row = await selectRow({
    table,
    isUpdate: true,
    lookupId: uuid,
    belongsTo,
    connection,
  })

  // FINALLY COMMIT
  const commit = await connection.query('COMMIT;')
  console.log('commit', commit)

  if (result.affectedRows !== 1) {
    // INITIAL operation did not update a row, return unhandled mismatch
    console.log('version mismatch on item')
    return {
      data: toModel(row, belongsTo),
      errorMessage: 'Conflict',
      errorType: 'ConflictUnhandled',
    }
  }

  // WRITE record to the DeltaSync table if row was created
  if (row && row.id) {
    await writeToDeltaSyncTable({ row, table, connection })
  }

  return { data: toModel(row, belongsTo) }
}

const _update = async ({ args: { input }, table, connection, belongsTo }) => {
  const { id: uuid, _version = 0, ...item } = input
  delete item.mysql_id // do not track changes to this field!
  const keys = Object.keys(item)

  const sql = `UPDATE ${table} SET ${keys
    .map((k) => k + ' = ?')
    .join(', ')}, _version=_version+1 WHERE datastore_uuid = ? AND _version = ?`
  const values = keys.map((k) => item[k])
  values.push(uuid)
  values.push(_version)

  return await _doUpdateTransactionWithRowLock({
    sql,
    values,
    uuid,
    table,
    connection,
    belongsTo,
  })
}

const _delete = async ({ args: { input }, table, connection, belongsTo }) => {
  const { id: uuid, _version = 0 } = input
  const sql = `
  UPDATE ${table} SET _deleted=true, _version=_version+1, ttl = TIMESTAMPADD(MINUTE, ?, CURRENT_TIMESTAMP(3))
  WHERE datastore_uuid = ? AND _version = ?`
  const values = [DeltaSyncConfig.BaseTableTTL, uuid, _version]

  return await _doUpdateTransactionWithRowLock({
    sql,
    values,
    uuid,
    table,
    connection,
    belongsTo,
  })
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

const smPromise = getSM()
exports.handler = async (event) => {
  try {
    console.log(`passed event >`, JSON.stringify(event, null, 2))

    const { fieldName: operation, arguments: args } = event

    if (operation in operations) {
      const connection = await smPromise.then(initConn)
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
