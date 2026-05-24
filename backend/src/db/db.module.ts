import { Global, Module } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as postgresNs from 'postgres';
import * as schema from './schema';

const pg = (postgresNs as unknown as { default: typeof import('postgres') }).default ?? (postgresNs as unknown as typeof import('postgres'));

export const DB = Symbol('DB');
export type Db = PostgresJsDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) {
          throw new Error('DATABASE_URL is not set');
        }
        const client = pg(url, { max: 10, prepare: false });
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DB],
})
export class DbModule {}
