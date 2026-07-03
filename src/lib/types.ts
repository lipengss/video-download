export type Media = any;
export type HItem = any;
export interface QItem {
  id: number;
  media: Media | null;
  format: string | null;
  status: string;
  pct: number;
  filePath?: string;
  error?: string;
  isBtch?: boolean;
  _bvid?: string;
  _cid?: string;
}
