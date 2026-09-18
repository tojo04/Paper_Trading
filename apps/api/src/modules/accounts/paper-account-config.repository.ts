import type { QueryExecutor } from '../../database/query-executor.js';

type PaperAccountConfigRow = {
  starting_cash_paise: string;
};

export class PaperAccountConfigRepository {
  public constructor(private readonly database: QueryExecutor) {}

  public async getStartingCashPaise(): Promise<bigint> {
    const result = await this.database.query<PaperAccountConfigRow>(`
      SELECT starting_cash_paise
      FROM paper_account_config
      WHERE singleton = TRUE
    `);
    const row = result.rows[0];

    if (row === undefined) {
      throw new Error('Paper account configuration has not been seeded');
    }

    return BigInt(row.starting_cash_paise);
  }
}
