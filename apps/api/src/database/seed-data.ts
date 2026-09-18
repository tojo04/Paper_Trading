export type SeedInstrument = {
  displayName: string;
  instrumentKey: string;
  isin: string;
  tickSizePaise: bigint;
  tradingSymbol: string;
};

// Verified against Upstox's official NSE BOD JSON on 2026-09-18.
export const supportedSeedInstruments: readonly SeedInstrument[] = [
  {
    displayName: 'Reliance Industries Ltd',
    instrumentKey: 'NSE_EQ|INE002A01018',
    isin: 'INE002A01018',
    tickSizePaise: 10n,
    tradingSymbol: 'RELIANCE',
  },
  {
    displayName: 'Tata Consultancy Services Ltd',
    instrumentKey: 'NSE_EQ|INE467B01029',
    isin: 'INE467B01029',
    tickSizePaise: 10n,
    tradingSymbol: 'TCS',
  },
  {
    displayName: 'Infosys Ltd',
    instrumentKey: 'NSE_EQ|INE009A01021',
    isin: 'INE009A01021',
    tickSizePaise: 10n,
    tradingSymbol: 'INFY',
  },
  {
    displayName: 'HDFC Bank Ltd',
    instrumentKey: 'NSE_EQ|INE040A01034',
    isin: 'INE040A01034',
    tickSizePaise: 5n,
    tradingSymbol: 'HDFCBANK',
  },
  {
    displayName: 'ICICI Bank Ltd',
    instrumentKey: 'NSE_EQ|INE090A01021',
    isin: 'INE090A01021',
    tickSizePaise: 10n,
    tradingSymbol: 'ICICIBANK',
  },
] as const;
