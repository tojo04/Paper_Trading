import type { QueryExecutor } from '../../database/query-executor.js';

type InstrumentRow = {
  display_name: string;
  enabled: boolean;
  id: string;
  instrument_key: string;
  isin: string;
  tick_size_paise: string;
  trading_symbol: string;
};

export type InstrumentRecord = {
  displayName: string;
  enabled: boolean;
  id: string;
  instrumentKey: string;
  isin: string;
  tickSizePaise: bigint;
  tradingSymbol: string;
};

function mapInstrument(row: InstrumentRow): InstrumentRecord {
  return {
    displayName: row.display_name,
    enabled: row.enabled,
    id: row.id,
    instrumentKey: row.instrument_key,
    isin: row.isin,
    tickSizePaise: BigInt(row.tick_size_paise),
    tradingSymbol: row.trading_symbol,
  };
}

export class InstrumentRepository {
  public constructor(private readonly database: QueryExecutor) {}

  public async findByInstrumentKey(instrumentKey: string): Promise<InstrumentRecord | null> {
    const result = await this.database.query<InstrumentRow>(
      `
        SELECT
          id,
          instrument_key,
          trading_symbol,
          display_name,
          isin,
          tick_size_paise,
          enabled
        FROM instruments
        WHERE instrument_key = $1
      `,
      [instrumentKey],
    );

    const row = result.rows[0];
    return row === undefined ? null : mapInstrument(row);
  }

  public async listEnabled(): Promise<InstrumentRecord[]> {
    const result = await this.database.query<InstrumentRow>(`
      SELECT
        id,
        instrument_key,
        trading_symbol,
        display_name,
        isin,
        tick_size_paise,
        enabled
      FROM instruments
      WHERE enabled = TRUE
      ORDER BY trading_symbol
    `);

    return result.rows.map(mapInstrument);
  }
}
