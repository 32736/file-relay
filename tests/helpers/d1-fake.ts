// An in-memory D1Database-shaped fake covering exactly the SQL statements the
// server uses: INSERT / SELECT / UPDATE / DELETE with equality and comparison
// conditions, `col = col + N` assignments, `RETURNING` on UPDATE, and batched
// statements. Tests cast it to D1Database when building bindings.

type Row = Record<string, unknown>

interface ColumnDef {
  name: string
}

interface TableState {
  columns: ColumnDef[]
  rows: Row[]
}

type CompareOperator = '=' | '<' | '>' | '<=' | '>='

interface WhereClause {
  column: string
  operator: CompareOperator | 'is-null' | 'is-not-null' | 'in' | 'like'
  value?: unknown
  values?: unknown[]
  otherColumn?: string
}

/** One AND term; its conditions are OR-ed together (parenthesized groups). */
interface WhereGroup {
  conditions: WhereClause[]
}

interface Assignment {
  column: string
  value?: unknown
  increment?: number
}

interface OrderByClause {
  column: string
  direction: 'asc' | 'desc'
}

/** Splits a SELECT column list on top-level commas (not inside parentheses). */
function splitSelectColumns(raw: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of raw) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current)
  return parts
}

/** A SELECT output column: a plain column or an aggregate expression. */
type SelectColumn =
  | { kind: 'plain'; name: string; alias: string }
  | { kind: 'count'; alias: string }
  | { kind: 'sum'; column: string; alias: string }

function parseSelectColumn(raw: string): SelectColumn {
  const trimmed = raw.trim()
  const countMatch = /^COUNT\(\*\)\s+AS\s+(\w+)$/i.exec(trimmed)
  if (countMatch) return { kind: 'count', alias: countMatch[1] }
  const coalescedSum = /^COALESCE\(\s*SUM\((\w+)\)\s*,\s*\d+\s*\)\s+AS\s+(\w+)$/i.exec(trimmed)
  if (coalescedSum) return { kind: 'sum', column: coalescedSum[1], alias: coalescedSum[2] }
  const plainSum = /^SUM\((\w+)\)\s+AS\s+(\w+)$/i.exec(trimmed)
  if (plainSum) return { kind: 'sum', column: plainSum[1], alias: plainSum[2] }
  const aliased = /^(\w+)\s+AS\s+(\w+)$/i.exec(trimmed)
  if (aliased) return { kind: 'plain', name: aliased[1], alias: aliased[2] }
  if (/^\w+$/.test(trimmed)) return { kind: 'plain', name: trimmed, alias: trimmed }
  throw new Error(`unsupported SELECT column in fake: ${trimmed}`)
}

type Query =
  | { kind: 'insert'; table: string; columns: string[]; values: unknown[]; orReplace: boolean }
  | {
      kind: 'select'
      columns: SelectColumn[]
      table: string
      where: WhereGroup[]
      orderBy: OrderByClause[]
      limit?: number
      offset: number
    }
  | {
      kind: 'update'
      table: string
      assignments: Assignment[]
      where: WhereGroup[]
      returning: boolean
      limit?: number
    }
  | { kind: 'delete'; table: string; where: WhereGroup[]; limit?: number }

/** Parses `col = rhs` pairs in a SET clause; `?` params are consumed via cursor. */
function parseAssignments(
  clause: string,
  params: unknown[],
  cursor: { index: number },
): Assignment[] {
  return clause.split(',').map((part) => {
    const match = /^(\w+)\s*=\s*(.+)$/.exec(part.trim())
    if (!match) throw new Error(`unsupported SET clause: ${part}`)
    const column = match[1]
    const rhs = match[2].trim()

    const incrementMatch = /^(\w+)\s*\+\s*(\?|\d+)$/.exec(rhs)
    if (incrementMatch && incrementMatch[1] === column) {
      const by = incrementMatch[2] === '?' ? Number(params[cursor.index++]) : Number(incrementMatch[2])
      return { column, increment: by }
    }
    if (rhs === '?') return { column, value: params[cursor.index++] }
    if (/^-?\d+$/.test(rhs)) return { column, value: Number(rhs) }
    if (rhs.startsWith("'")) return { column, value: rhs.slice(1, -1) }
    throw new Error(`unsupported SET value in fake: ${rhs}`)
  })
}

function parseCondition(
  condition: string,
  params: unknown[],
  cursor: { index: number },
): WhereClause {
  const trimmed = condition.trim()
  const nullMatch = /^(\w+)\s+IS\s+(NOT\s+)?NULL$/i.exec(trimmed)
  if (nullMatch) {
    return { column: nullMatch[1], operator: nullMatch[2] ? 'is-not-null' : 'is-null' }
  }
  const likeMatch = /^(\w+)\s+LIKE\s+(\?|'[^']*')(?:\s+ESCAPE\s+'\\')?$/i.exec(trimmed)
  if (likeMatch) {
    const value = likeMatch[2] === '?' ? params[cursor.index++] : likeMatch[2].slice(1, -1)
    return { column: likeMatch[1], operator: 'like', value }
  }
  const inMatch = /^(\w+)\s+IN\s*\(([^)]+)\)$/.exec(trimmed)
  if (inMatch) {
    const values = inMatch[2].split(',').map((placeholder) => {
      const value = placeholder.trim()
      if (value === '?') return params[cursor.index++]
      if (value.startsWith("'")) return value.slice(1, -1)
      return Number(value)
    })
    return { column: inMatch[1], operator: 'in', values }
  }
  const compareMatch = /^(\w+)\s*(<=|>=|<|>|=)\s*(.+)$/.exec(trimmed)
  if (!compareMatch) throw new Error(`unsupported WHERE clause: ${condition}`)
  const column = compareMatch[1]
  const operator = compareMatch[2] as CompareOperator
  const rhs = compareMatch[3].trim()

  if (rhs === '?') return { column, operator, value: params[cursor.index++] }
  if (/^-?\d+$/.test(rhs)) return { column, operator, value: Number(rhs) }
  if (rhs.startsWith("'")) return { column, operator, value: rhs.slice(1, -1) }
  if (/^\w+$/.test(rhs)) return { column, operator, otherColumn: rhs }
  throw new Error(`unsupported WHERE clause: ${condition}`)
}

function parseWhere(
  clause: string | undefined,
  params: unknown[],
  cursor: { index: number },
): WhereGroup[] {
  if (!clause) return []
  return clause.split(/\s+AND\s+/i).map((part) => {
    const trimmed = part.trim()
    const inner = trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed
    const conditions = inner
      .split(/\s+OR\s+/i)
      .map((condition) => parseCondition(condition, params, cursor))
    return { conditions }
  })
}

function parseOrderBy(clause: string | undefined): OrderByClause[] {
  if (!clause) return []
  return clause.split(',').map((part) => {
    const match = /(\w+)(?:\s+(ASC|DESC))?/i.exec(part.trim())
    if (!match) throw new Error(`unsupported ORDER BY clause: ${part}`)
    return { column: match[1], direction: (match[2] ?? 'asc').toLowerCase() as 'asc' | 'desc' }
  })
}

/** Resolves a LIMIT/OFFSET value that is either a literal number or a `?` param. */
function parseNumber(
  value: string | undefined,
  params: unknown[],
  cursor: { index: number },
): number | undefined {
  if (value === undefined) return undefined
  if (value === '?') return Number(params[cursor.index++])
  return Number(value)
}

function parseQuery(sql: string, params: unknown[]): Query {
  // The server formats long SQL across lines; normalize whitespace so the
  // statement regexes match regardless of formatting.
  const normalized = sql.replace(/\s+/g, ' ').trim()
  const cursor = { index: 0 }

  const insertMatch = /^INSERT(?: OR REPLACE)? INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)/i.exec(
    normalized,
  )
  if (insertMatch) {
    const columns = insertMatch[2].split(',').map((name) => name.trim())
    const placeholders = insertMatch[3].split(',').map((name) => name.trim())
    const values = placeholders.map((placeholder) => {
      if (placeholder !== '?') throw new Error(`unsupported INSERT literal: ${placeholder}`)
      return params[cursor.index++]
    })
    return {
      kind: 'insert',
      table: insertMatch[1],
      columns,
      values,
      orReplace: /^INSERT OR REPLACE INTO/i.test(normalized),
    }
  }

  const selectMatch = /^SELECT (.+) FROM (\w+)(.*)$/i.exec(normalized)
  if (selectMatch) {
    const rest = selectMatch[3]
    const whereMatch = /WHERE\s+(.+?)(?=\s+ORDER BY\s|\s+LIMIT\s|\s+OFFSET\s|$)/i.exec(rest)
    const orderMatch = /ORDER BY\s+(.+?)(?=\s+LIMIT\s|\s+OFFSET\s|$)/i.exec(rest)
    const limitMatch = /LIMIT\s+(\?|\d+)/i.exec(rest)
    const offsetMatch = /OFFSET\s+(\?|\d+)/i.exec(rest)
    return {
      kind: 'select',
      columns: splitSelectColumns(selectMatch[1]).map((name) => parseSelectColumn(name)),
      table: selectMatch[2],
      where: parseWhere(whereMatch?.[1], params, cursor),
      orderBy: parseOrderBy(orderMatch?.[1]),
      limit: parseNumber(limitMatch?.[1], params, cursor),
      offset: parseNumber(offsetMatch?.[1], params, cursor) ?? 0,
    }
  }

  const updateMatch =
    /^UPDATE (\w+) SET (.+?)(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING\s+\*)?(?:\s+LIMIT\s+(\?|\d+))?$/i.exec(
      normalized,
    )
  if (updateMatch) {
    return {
      kind: 'update',
      table: updateMatch[1],
      assignments: parseAssignments(updateMatch[2], params, cursor),
      where: parseWhere(updateMatch[3], params, cursor),
      returning: /RETURNING\s+\*$/i.test(normalized),
      limit: parseNumber(updateMatch[4], params, cursor),
    }
  }

  const deleteMatch =
    /^DELETE FROM (\w+)(?:\s+WHERE\s+(.+?))?(?:\s+LIMIT\s+(\?|\d+))?$/i.exec(normalized)
  if (deleteMatch) {
    return {
      kind: 'delete',
      table: deleteMatch[1],
      where: parseWhere(deleteMatch[2], params, cursor),
      limit: parseNumber(deleteMatch[3], params, cursor),
    }
  }

  throw new Error(`unsupported SQL in fake: ${normalized}`)
}

function escapeRegExpChar(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char
}

/** Converts a SQL LIKE pattern (with `%`/`_` and `\` escapes) to a regex. */
function likePatternToRegExp(pattern: string): RegExp {
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '\\' && i + 1 < pattern.length) {
      source += escapeRegExpChar(pattern[i + 1])
      i++
    } else if (char === '%') {
      source += '.*'
    } else if (char === '_') {
      source += '.'
    } else {
      source += escapeRegExpChar(char)
    }
  }
  return new RegExp(`^${source}$`, 'i')
}

function matchCondition(row: Row, condition: WhereClause): boolean {
  const left = row[condition.column]
  if (condition.operator === 'is-null') {
    return left === null || left === undefined
  }
  if (condition.operator === 'is-not-null') {
    return left !== null && left !== undefined
  }
  if (condition.operator === 'in') {
    return (condition.values ?? []).includes(left)
  }
  if (condition.operator === 'like') {
    return (
      typeof left === 'string' && likePatternToRegExp(String(condition.value ?? '')).test(left)
    )
  }
  const right =
    condition.otherColumn !== undefined ? row[condition.otherColumn] : condition.value
  switch (condition.operator) {
    case '=':
      return left === right
    case '<':
      return (left as number) < (right as number)
    case '>':
      return (left as number) > (right as number)
    case '<=':
      return (left as number) <= (right as number)
    case '>=':
      return (left as number) >= (right as number)
  }
}

function matchesWhere(row: Row, groups: WhereGroup[]): boolean {
  return groups.every((group) =>
    group.conditions.some((condition) => matchCondition(row, condition)),
  )
}

function applyAssignments(row: Row, assignments: Assignment[]): Row {
  const updated: Row = { ...row }
  for (const { column, value, increment } of assignments) {
    if (increment !== undefined) {
      updated[column] = Number(updated[column] ?? 0) + increment
    } else {
      updated[column] = value
    }
  }
  return updated
}

export class D1Fake {
  private tables = new Map<string, TableState>()

  constructor(seed: {
    sessions?: Row[]
    files?: Row[]
    upload_sessions?: Row[]
    upload_parts?: Row[]
    shares?: Row[]
  } = {}) {
    this.tables.set('sessions', {
      columns: [
        { name: 'id' },
        { name: 'token_hash' },
        { name: 'github_user_id' },
        { name: 'created_at' },
        { name: 'expires_at' },
      ],
      rows: seed.sessions ? seed.sessions.map((row) => ({ ...row })) : [],
    })
    this.tables.set('files', {
      columns: [
        { name: 'id' },
        { name: 'object_key' },
        { name: 'original_name' },
        { name: 'mime_type' },
        { name: 'size' },
        { name: 'etag' },
        { name: 'source' },
        { name: 'created_at' },
        { name: 'expires_at' },
        { name: 'deleted_at' },
      ],
      rows: seed.files ? seed.files.map((row) => ({ ...row })) : [],
    })
    this.tables.set('upload_parts', {
      columns: [
        { name: 'upload_session_id' },
        { name: 'part_number' },
        { name: 'etag' },
        { name: 'size' },
        { name: 'created_at' },
      ],
      rows: seed.upload_parts ? seed.upload_parts.map((row) => ({ ...row })) : [],
    })
    this.tables.set('upload_sessions', {
      columns: [
        { name: 'id' },
        { name: 'file_id' },
        { name: 'object_key' },
        { name: 'original_name' },
        { name: 'mime_type' },
        { name: 'total_size' },
        { name: 'chunk_size' },
        { name: 'total_parts' },
        { name: 'mode' },
        { name: 'r2_upload_id' },
        { name: 'auth_kind' },
        { name: 'access_token_hash' },
        { name: 'status' },
        { name: 'created_at' },
        { name: 'expires_at' },
        { name: 'completed_at' },
      ],
      rows: seed.upload_sessions ? seed.upload_sessions.map((row) => ({ ...row })) : [],
    })
    this.tables.set('shares', {
      columns: [
        { name: 'id' },
        { name: 'file_id' },
        { name: 'token_hash' },
        { name: 'password_mac' },
        { name: 'expires_at' },
        { name: 'max_downloads' },
        { name: 'download_count' },
        { name: 'last_download_at' },
        { name: 'delete_file_after_exhausted' },
        { name: 'created_at' },
        { name: 'revoked_at' },
      ],
      rows: seed.shares ? seed.shares.map((row) => ({ ...row })) : [],
    })
  }

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql)
  }

  async batch(
    statements: FakeStatement[],
  ): Promise<{ success: boolean; meta: { changes: number } }[]> {
    const results: { success: boolean; meta: { changes: number } }[] = []
    for (const statement of statements) {
      results.push(await statement.run())
    }
    return results
  }

  /** Internal access for FakeStatement; not part of the D1Database shape. */
  tableState(table: string): TableState {
    const state = this.tables.get(table)
    if (!state) throw new Error(`unknown table: ${table}`)
    return state
  }

  /** Applies an UPDATE query and returns the updated rows (for RETURNING). */
  applyUpdate(query: Extract<Query, { kind: 'update' }>): Row[] {
    const table = this.tableState(query.table)
    const updatedRows: Row[] = []
    let matched = 0
    table.rows = table.rows.map((row) => {
      if (!matchesWhere(row, query.where)) return row
      if (query.limit !== undefined && matched >= query.limit) return row
      matched++
      const updated = applyAssignments(row, query.assignments)
      updatedRows.push(updated)
      return updated
    })
    return updatedRows
  }

  /** Test helper: returns a copy of the rows of a table. */
  rows(table: string): Row[] {
    const state = this.tables.get(table)
    if (!state) throw new Error(`unknown table: ${table}`)
    return state.rows.map((row) => ({ ...row }))
  }
}

class FakeStatement {
  private params: unknown[] = []

  constructor(
    private readonly db: D1Fake,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.params = values
    return this
  }

  async all(): Promise<{ results: Row[]; success: boolean }> {
    const query = parseQuery(this.sql, this.params)

    if (query.kind === 'select') {
      const table = this.db.tableState(query.table)
      const filtered = table.rows.filter((row) => matchesWhere(row, query.where))

      // Aggregate queries (COUNT/SUM/COALESCE) return a single computed row.
      if (query.columns.some((column) => column.kind !== 'plain')) {
        const row: Row = {}
        for (const column of query.columns) {
          if (column.kind === 'count') {
            row[column.alias] = filtered.length
          } else if (column.kind === 'sum') {
            row[column.alias] = filtered.reduce(
              (sum, item) => sum + Number(item[column.column] ?? 0),
              0,
            )
          } else {
            row[column.alias] = filtered[0]?.[column.name] ?? null
          }
        }
        return { results: [row], success: true }
      }

      const sorted =
        query.orderBy.length === 0
          ? filtered
          : [...filtered].sort((a, b) => {
              for (const { column, direction } of query.orderBy) {
                const left = a[column] as number | string | null | undefined
                const right = b[column] as number | string | null | undefined
                if (left === right) continue
                if (left == null) return direction === 'desc' ? 1 : -1
                if (right == null) return direction === 'desc' ? -1 : 1
                const comparison = left < right ? -1 : 1
                return direction === 'desc' ? -comparison : comparison
              }
              return 0
            })
      const paged =
        query.limit === undefined ? sorted : sorted.slice(query.offset, query.offset + query.limit)
      const results = paged.map((row) => {
        const picked: Row = {}
        for (const column of query.columns) {
          if (column.kind === 'plain') picked[column.alias] = row[column.name]
        }
        return picked
      })
      return { results, success: true }
    }

    if (query.kind === 'update' && query.returning) {
      return { results: this.db.applyUpdate(query), success: true }
    }

    throw new Error('all() only supports SELECT or UPDATE ... RETURNING in fake')
  }

  async first(): Promise<Row | null> {
    const { results } = await this.all()
    return results[0] ?? null
  }

  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    const query = parseQuery(this.sql, this.params)

    if (query.kind === 'update') {
      if (query.returning) throw new Error('run() cannot return rows in fake')
      return {
        success: true,
        meta: { changes: this.db.applyUpdate(query).length },
      }
    }

    const table = this.db.tableState(query.table)

    if (query.kind === 'insert') {
      const row: Row = {}
      query.columns.forEach((column, index) => {
        row[column] = query.values[index]
      })
      if (query.table === 'upload_parts') {
        const existingIndex = table.rows.findIndex(
          (existing) =>
            existing.upload_session_id === row.upload_session_id &&
            existing.part_number === row.part_number,
        )
        if (existingIndex >= 0) {
          if (!query.orReplace) throw new Error('PRIMARY KEY constraint failed: upload_parts')
          table.rows[existingIndex] = row
          return { success: true, meta: { changes: 1 } }
        }
      }
      if (
        query.table === 'sessions' &&
        table.rows.some((existing) => existing.token_hash === row.token_hash)
      ) {
        throw new Error('UNIQUE constraint failed: sessions.token_hash')
      }
      if (
        query.table === 'files' &&
        table.rows.some((existing) => existing.object_key === row.object_key)
      ) {
        throw new Error('UNIQUE constraint failed: files.object_key')
      }
      if (
        query.table === 'upload_sessions' &&
        table.rows.some((existing) => existing.object_key === row.object_key)
      ) {
        throw new Error('UNIQUE constraint failed: upload_sessions.object_key')
      }
      if (
        query.table === 'shares' &&
        table.rows.some((existing) => existing.token_hash === row.token_hash)
      ) {
        throw new Error('UNIQUE constraint failed: shares.token_hash')
      }
      table.rows.push(row)
      return { success: true, meta: { changes: 1 } }
    }

    if (query.kind === 'delete') {
      let removed = 0
      table.rows = table.rows.filter((row) => {
        if (!matchesWhere(row, query.where)) return true
        if (query.limit !== undefined && removed >= query.limit) return true
        removed++
        return false
      })
      return { success: true, meta: { changes: removed } }
    }

    throw new Error('run() only supports INSERT/UPDATE/DELETE in fake')
  }
}
