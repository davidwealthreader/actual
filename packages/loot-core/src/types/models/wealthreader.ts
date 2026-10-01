export type SyncServerWealthReaderAccount = {
  account_id: string;
  name: string;
  institution: string;
  entity_code: string;
  token: string;
  balance: number;
  currency?: string;
  iban?: string;
};
