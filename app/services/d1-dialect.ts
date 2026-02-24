/**
 * Custom D1 Dialect wrapper that removes deprecated fields to silence Kysely warnings.
 *
 * The kysely-d1 package (v0.4.0) returns `numUpdatedOrDeletedRows` for backward compatibility,
 * but Kysely >= 0.27 logs a warning when this deprecated field is present.
 * This wrapper removes the deprecated field from query results.
 */

import type {
  CompiledQuery,
  DatabaseConnection,
  Dialect,
  DialectAdapter,
  Driver,
  Kysely,
  QueryResult,
  TransactionSettings,
} from 'kysely'
import { D1Dialect as OriginalD1Dialect } from 'kysely-d1'
import type { Database } from './db'

/**
 * A connection wrapper that removes deprecated fields from query results
 */
class CleanD1Connection implements DatabaseConnection {
  constructor(private readonly inner: DatabaseConnection) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.inner.executeQuery<R>(compiledQuery)

    // Remove the deprecated numUpdatedOrDeletedRows field if present
    // biome-ignore lint/suspicious/noExplicitAny: Removing deprecated field from result
    const cleanResult = result as any
    if ('numUpdatedOrDeletedRows' in cleanResult) {
      delete cleanResult.numUpdatedOrDeletedRows
    }

    return cleanResult as QueryResult<R>
  }

  async *streamQuery<R>(
    compiledQuery: CompiledQuery,
    chunkSize?: number,
  ): AsyncIterableIterator<QueryResult<R>> {
    yield* this.inner.streamQuery(compiledQuery, chunkSize)
  }
}

/**
 * A driver wrapper that returns clean connections
 */
class CleanD1Driver implements Driver {
  constructor(private readonly inner: Driver) {}

  async init(): Promise<void> {
    await this.inner.init()
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const conn = await this.inner.acquireConnection()
    return new CleanD1Connection(conn)
  }

  async beginTransaction(
    conn: DatabaseConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    // Unwrap if needed
    const innerConn =
      conn instanceof CleanD1Connection
        ? // biome-ignore lint/suspicious/noExplicitAny: Accessing private inner connection
          (conn as any).inner
        : conn
    await this.inner.beginTransaction(innerConn, settings)
  }

  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    const innerConn =
      conn instanceof CleanD1Connection
        ? // biome-ignore lint/suspicious/noExplicitAny: Accessing private inner connection
          (conn as any).inner
        : conn
    await this.inner.commitTransaction(innerConn)
  }

  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    const innerConn =
      conn instanceof CleanD1Connection
        ? // biome-ignore lint/suspicious/noExplicitAny: Accessing private inner connection
          (conn as any).inner
        : conn
    await this.inner.rollbackTransaction(innerConn)
  }

  async releaseConnection(conn: DatabaseConnection): Promise<void> {
    const innerConn =
      conn instanceof CleanD1Connection
        ? // biome-ignore lint/suspicious/noExplicitAny: Accessing private inner connection
          (conn as any).inner
        : conn
    await this.inner.releaseConnection(innerConn)
  }

  async destroy(): Promise<void> {
    await this.inner.destroy()
  }
}

/**
 * Custom D1 Dialect that wraps the original to remove deprecated query result fields.
 * This silences the "outdated driver/plugin detected" warning from Kysely.
 */
export class D1Dialect implements Dialect {
  private readonly inner: OriginalD1Dialect

  constructor(config: { database: D1Database }) {
    this.inner = new OriginalD1Dialect(config)
  }

  createAdapter(): DialectAdapter {
    return this.inner.createAdapter()
  }

  createDriver(): Driver {
    return new CleanD1Driver(this.inner.createDriver())
  }

  createQueryCompiler(): ReturnType<Dialect['createQueryCompiler']> {
    return this.inner.createQueryCompiler()
  }

  createIntrospector(
    db: Kysely<Database>,
  ): ReturnType<Dialect['createIntrospector']> {
    // biome-ignore lint/suspicious/noExplicitAny: Kysely generic types
    return this.inner.createIntrospector(db as any)
  }
}
