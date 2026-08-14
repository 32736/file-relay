// An in-memory D1Database-shaped fake covering exactly the SQL statements the
// server uses. It is intentionally minimal: a table store with INSERT/SELECT/
// DELETE and equality WHERE clauses, plus the UNIQUE constraint on
// sessions.token_hash. Tests cast it to D1Database when building bindings.

type Row = Record<string, unknown>

interface ColumnDef {
  name: string
}

interface TableState {
  columns: ColumnDef[]
  rows: Row[]
}

interface WhereClause {
  column: string
  value: unknown
}

type Query =
  | { kind: 'insert'; table: string; columns: string[]; values: unknown[] }
  | { kind: 'select'; columns: string[]; table: string; where?: WhereClause }
  | { kind: 'delete'; table: string; where?: WhereClause }

function parseWhere(clause: string | undefined, params: unknown[]): WhereClause | undefined {
  if (!clause) return undefined
  const match = /^(\w+)\s*=\s*(\?|'[^']*')$/.exec(clause.trim())
  if (!match) throw new Error(`unsupported WHERE clause in fake: ${clause}`)
  const value = match[2] === '?' ? params[0] : match[2].slice(1, -1)
  return { column: match[1], value }
}

function parseQuery(sql: string, params: unknown[]): Query {
  const insertMatch = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)/i.exec(sql)
  if (insertMatch) {
    const columns = insertMatch[2].split(',').map((name) => name.trim())
    const placeholders = insertMatch[3].split(',').map((name) => name.trim())
    const values = placeholders.map((placeholder, index) => {
      if (placeholder !== '?') throw new Error(`unsupported INSERT literal: ${placeholder}`)
      return params[index]
    })
    return { kind: 'insert', table: insertMatch[1], columns, values }
  }

  const selectMatch = /^SELECT (.+) FROM (\w+)(?:\s+WHERE\s+(.+))?$/i.exec(sql)
  if (selectMatch) {
    return {
      kind: 'select',
      columns: selectMatch[1].split(',').map((name) => name.trim()),
      table: selectMatch[2],
      where: parseWhere(selectMatch[3], params),
    }
  }

  const deleteMatch = /^DELETE FROM (\w+)(?:\s+WHERE\s+(.+))?$/i.exec(sql)
  if (deleteMatch) {
    return { kind: 'delete', table: deleteMatch[1], where: parseWhere(deleteMatch[2], params) }
  }

  throw new Error(`unsupported SQL in fake: ${sql}`)
}

function matchesWhere(row: Row, where: WhereClause | undefined): boolean {
  if (!where) return true
  return row[where.column] === where.value
}

export class D1Fake {
  private tables = new Map<string, TableState>()

  constructor(seed: { sessions?: Row[] } = {}) {
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
  }

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql)
  }

  /** Internal access for FakeStatement; not part of the D1Database shape. */
  tableState(table: string): TableState {
    const state = this.tables.get(table)
    if (!state) throw new Error(`unknown table: ${table}`)
    return state
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
    if (query.kind !== 'select') throw new Error('all() only supports SELECT in fake')
    const table = this.db.tableState(query.table)
    const results = table.rows
      .filter((row) => matchesWhere(row, query.where))
      .map((row) => {
        const picked: Row = {}
        for (const column of query.columns) picked[column] = row[column]
        return picked
      })
    return { results, success: true }
  }

  async first(): Promise<Row | null> {
    const { results } = await this.all()
    return results[0] ?? null
  }

  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    const query = parseQuery(this.sql, this.params)
    const table = this.db.tableState(query.table)

    if (query.kind === 'insert') {
      const row: Row = {}
      query.columns.forEach((column, index) => {
        row[column] = query.values[index]
      })
      if (
        query.table === 'sessions' &&
        table.rows.some((existing) => existing.token_hash === row.token_hash)
      ) {
        throw new Error('UNIQUE constraint failed: sessions.token_hash')
      }
      table.rows.push(row)
      return { success: true, meta: { changes: 1 } }
    }

    if (query.kind === 'delete') {
      const before = table.rows.length
      table.rows = table.rows.filter((row) => !matchesWhere(row, query.where))
      return { success: true, meta: { changes: before - table.rows.length } }
    }

    throw new Error('run() only supports INSERT/DELETE in fake')
  }
}
